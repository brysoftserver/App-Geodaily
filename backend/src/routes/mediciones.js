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

    // Mediciones que un administrador ya eliminó: se descartan para que no
    // "resuciten" desde un celular que aún las tenga pendientes. Cuentan como
    // atendidas (el celular las marca sincronizadas y deja de reenviarlas).
    const idsRecibidos = mediciones.map((m) => m.id).filter(Boolean);
    const tumbas = new Set(
      idsRecibidos.length
        ? (await db.queryAll('SELECT id FROM mediciones_eliminadas WHERE id = ANY($1)', [idsRecibidos])).map((t) => t.id)
        : []
    );

    let sincronizadas = 0;
    let eliminadas = 0;
    let omitidas = 0;
    let sinUsuario = 0;
    let fallidas = 0;
    for (const m of mediciones) {
      if (m.id && tumbas.has(m.id)) {
        eliminadas++;
        continue;
      }
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

    console.log(`[Mediciones] ${sincronizadas} mediciones sincronizadas por ${req.user.usuario}${omitidas ? ` (${omitidas} sin formulario en servidor)` : ''}${sinUsuario ? ` (${sinUsuario} de usuario inexistente)` : ''}${eliminadas ? ` (${eliminadas} ya eliminadas por un admin, descartadas)` : ''}${fallidas ? ` (${fallidas} con error)` : ''}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} mediciones sincronizadas`,
      sincronizadas,
      sinFormulario: omitidas,
      sinUsuario,
      eliminadas,
      fallidas,
    });
  } catch (error) {
    console.error('[Mediciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar mediciones' });
  }
});

// Ids de polígono referenciados en una actividad de visita (formato actual
// `mediciones_historial` y los anteriores `medicion_historial[_2]`, también
// dentro de visita_datos — por eso el comodín `$.**`).
const RUTAS_IDS = [
  'strict $.**.mediciones_historial[*].id',
  'strict $.**.medicion_historial.id',
  'strict $.**.medicion_historial_2.id',
];
const idsDe = (col) => RUTAS_IDS.map((r) => `SELECT jsonb_path_query(${col}, '${r}') #>> '{}' AS v`).join(' UNION ');

/**
 * Mapa id de medición → visitas donde se usó. `visitas` = formularios
 * completados; `borradores` = visitas guardadas en el servidor sin enviar.
 */
async function usosEnVisitas() {
  const visitas = new Map();
  const borradores = new Map();
  const agregar = (mapa, id, uso) => {
    if (!id) return;
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(uso);
  };
  const filasVisitas = await db.queryAll(
    `SELECT DISTINCT f.id AS formulario_id, ids.v AS medicion_id, f.created_at,
            f.beneficiario_json->>'nombre' AS beneficiario_nombre,
            f.beneficiario_json->>'cedula' AS beneficiario_cedula,
            u.nombre AS tecnico_nombre
       FROM formularios f
       LEFT JOIN usuarios u ON u.id = f.usuario_id
       CROSS JOIN LATERAL (${idsDe('f.actividad_json')}) ids
      WHERE f.tipo = 'visita_tecnica'`
  );
  filasVisitas.forEach((r) => agregar(visitas, r.medicion_id, {
    formulario_id: r.formulario_id,
    beneficiario_nombre: r.beneficiario_nombre || null,
    beneficiario_cedula: r.beneficiario_cedula || null,
    tecnico_nombre: r.tecnico_nombre || null,
    fecha: r.created_at,
  }));
  const filasBorradores = await db.queryAll(
    `SELECT DISTINCT b.id AS borrador_id, ids.v AS medicion_id, b.updated_at,
            b.payload_json#>>'{beneficiario,nombre}' AS beneficiario_nombre,
            b.payload_json#>>'{beneficiario,cedula}' AS beneficiario_cedula,
            u.nombre AS tecnico_nombre
       FROM formularios_borradores b
       LEFT JOIN usuarios u ON u.id = b.usuario_id
       CROSS JOIN LATERAL (${idsDe('b.payload_json')}) ids
      WHERE b.payload_json->>'tipo' = 'visita_tecnica'`
  );
  filasBorradores.forEach((r) => agregar(borradores, r.medicion_id, {
    borrador_id: r.borrador_id,
    beneficiario_nombre: r.beneficiario_nombre || null,
    beneficiario_cedula: r.beneficiario_cedula || null,
    tecnico_nombre: r.tecnico_nombre || null,
    fecha: r.updated_at,
  }));
  return { visitas, borradores };
}

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

    // Uso en la Visita 2: la visita guarda una COPIA del polígono (con el
    // mismo id) en actividad_json; el mapa necesita saber cuáles se usaron
    // para que el admin pueda limpiar los que sobran sin borrar uno usado.
    const usos = await usosEnVisitas();

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
        // 'visita' = en una Visita 2 completada · 'borrador' = elegido en una
        // visita aún sin enviar · null = no usado en ninguna visita.
        uso_visita: usos.visitas.has(m.id) ? 'visita' : usos.borradores.has(m.id) ? 'borrador' : null,
        visitas_uso: usos.visitas.get(m.id) || usos.borradores.get(m.id) || [],
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

    // Deja constancia de que este id se borró a propósito: POST /sync la revisa
    // para no recrearla si algún celular todavía la tiene.
    await db.query(
      `INSERT INTO mediciones_eliminadas (id, eliminado_por)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET eliminado_por = $2, eliminado_at = NOW()`,
      [req.params.id, req.user.id]
    );

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
