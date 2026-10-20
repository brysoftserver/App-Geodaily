// ============================================================
// Mediciones Routes — Sync + CRUD de mediciones de terreno
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/mediciones/sync — Recibir mediciones del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { mediciones } = req.body;
    if (!Array.isArray(mediciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de mediciones' });
    }

    let sincronizadas = 0;
    let omitidas = 0;
    let sinUsuario = 0;
    let fallidas = 0;
    for (const m of mediciones) {
      const id = m.id || `med-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Usuario inexistente: la FK `mediciones_usuario_id_fkey` rechazaba el
      // INSERT y tumbaba TODO el lote con un 500 → el dispositivo reintentaba
      // el mismo lote en cada ciclo para siempre (caso real: `tec-011`, un
      // usuario de prueba ya eliminado, seguía en el SQLite de un teléfono).
      // Se omite ESA medición y se sigue con las demás: es un registro
      // huérfano que ya no puede atribuirse a nadie.
      const usuarioIdMedicion = m.usuario_id || req.user.id;
      if (usuarioIdMedicion) {
        const usuarioExiste = await db.queryAll(
          'SELECT 1 FROM usuarios WHERE id = $1 LIMIT 1',
          [usuarioIdMedicion]
        );
        if (usuarioExiste.length === 0) {
          console.warn(
            `[Mediciones] Usuario ${usuarioIdMedicion} no existe en el servidor; ` +
            `se omite la medición ${id} (huérfana, no bloquea el lote)`
          );
          sinUsuario++;
          continue;
        }
      }

      // El formulario puede no existir todavía en el servidor (borrador local
      // que aún no se ha sincronizado). La FK `mediciones_formulario_id_fkey`
      // rechazaba el INSERT y tumbaba TODO el lote con un 500, dejando las
      // mediciones sin subir para siempre. Si el formulario no existe, se
      // guarda la medición sin vínculo (formulario_id = NULL) en vez de fallar.
      let formularioId = m.formulario_id || null;
      if (formularioId) {
        const existe = await db.queryAll(
          'SELECT 1 FROM formularios WHERE id = $1 LIMIT 1',
          [formularioId]
        );
        if (existe.length === 0) {
          console.warn(
            `[Mediciones] Formulario ${formularioId} no existe en el servidor; ` +
            `la medición ${id} se guarda sin vínculo de formulario`
          );
          formularioId = null;
          omitidas++;
        }
      }

      // Cada medición es independiente: antes un solo renglón inválido
      // devolvía 500 y TODO el lote volvía a reintentarse en cada ciclo de
      // sync (el teléfono nunca avanzaba).
      try {
        await db.query(
          `INSERT INTO mediciones (id, usuario_id, formulario_id, tipo_medicion, valor, unidad, latitud, longitud, metadata_json, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             valor = EXCLUDED.valor,
             formulario_id = EXCLUDED.formulario_id,
             metadata_json = EXCLUDED.metadata_json,
             timestamp = EXCLUDED.timestamp`,
          [
            id,
            usuarioIdMedicion,
            formularioId,
            m.tipo_medicion || m.tipo || 'general',
            m.valor || 0,
            m.unidad || '',
            m.latitud || null,
            m.longitud || null,
            JSON.stringify(m.metadata_json || m.datos || {}),
            m.timestamp || m.timestamp_dispositivo || new Date().toISOString(),
          ]
        );
        sincronizadas++;
      } catch (errMed) {
        console.warn(`[Mediciones] No se pudo guardar la medición ${id}:`, errMed.message);
        fallidas++;
      }
    }

    console.log(`[Mediciones] ${sincronizadas} mediciones sincronizadas por ${req.user.usuario}${omitidas ? ` (${omitidas} sin formulario en servidor)` : ''}${sinUsuario ? ` (${sinUsuario} de usuario inexistente)` : ''}${fallidas ? ` (${fallidas} con error)` : ''}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} mediciones sincronizadas`,
      sincronizadas,
      sinFormulario: omitidas,
      sinUsuario,
      fallidas,
    });
  } catch (error) {
    console.error('[Mediciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar mediciones' });
  }
});

// GET /api/mediciones — Obtener todas las mediciones
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rol, id: usuario_id } = req.user;
    let sql = `
      SELECT m.id, m.usuario_id, m.formulario_id, m.tipo_medicion, m.valor,
        m.unidad, m.latitud, m.longitud, m.metadata_json, m.timestamp, m.sincronizado, m.created_at,
        u.nombre AS usuario_nombre
      FROM mediciones m
      JOIN usuarios u ON u.id = m.usuario_id
    `;
    const params = [];

    if (rol === 'tecnico') {
      sql += ' WHERE m.usuario_id = $1';
      params.push(usuario_id);
    }

    sql += ' ORDER BY m.created_at DESC';

    const lista = await db.queryAll(sql, params);

    // Aplanar metadata_json: la app móvil guarda ahí el nombre, el área, el
    // perímetro, los puntos y la atribución (beneficiario/vereda). Antes se
    // devolvía el JSON crudo y el mapa general no podía dibujar el polígono
    // ni decir de quién era.
    const mediciones = lista.map((m) => {
      let meta = {};
      try {
        meta = typeof m.metadata_json === 'string' ? JSON.parse(m.metadata_json) : m.metadata_json || {};
      } catch {
        meta = {};
      }
      return {
        ...m,
        nombre: meta.nombre || null,
        area_hectareas: meta.area_hectareas ?? null,
        area_metros2: meta.area_metros2 ?? null,
        perimetro_metros: meta.perimetro_metros ?? null,
        puntos: Array.isArray(meta.puntos) ? meta.puntos : [],
        beneficiario_cedula: meta.beneficiario_cedula || null,
        beneficiario_nombre: meta.beneficiario_nombre || null,
        vereda: meta.vereda || null,
        corregimiento: meta.corregimiento || null,
        usuario_nombre: m.usuario_nombre || meta.usuario_nombre || null,
      };
    });

    res.json({
      estado: 'ok',
      total: mediciones.length,
      mediciones,
    });
  } catch (error) {
    console.error('[Mediciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener mediciones' });
  }
});

// DELETE /api/mediciones/:id — Solo admin puede eliminar
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar mediciones' });
    }

    const result = await db.remove('mediciones', 'id', req.params.id);
    if (!result) {
      return res.status(404).json({ estado: 'error', mensaje: 'Medición no encontrada' });
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'eliminar_medicion', JSON.stringify({ medicion_id: req.params.id })]
    );

    console.log(`[Mediciones] Eliminada: ${req.params.id} por admin ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Medición eliminada correctamente' });
  } catch (error) {
    console.error('[Mediciones] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar medición' });
  }
});

module.exports = router;
