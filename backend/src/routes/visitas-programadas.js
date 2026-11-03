// ============================================================
// Visitas Programadas Routes — Sync + CRUD de visitas planificadas
// Compartidas entre todo el equipo (técnico → roles superiores)
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { normalizarCedula, sqlCedulaNormalizada, sqlFormularioEsVisita } = require('../lib/visitas');
const router = express.Router();

// POST /api/visitas-programadas/sync — Recibir visitas programadas del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { visitas } = req.body;
    if (!Array.isArray(visitas)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de visitas' });
    }

    let sincronizadas = 0;
    const resultados = [];
    for (const v of visitas) {
      const id = v.id || `visita-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const numero = Number(v.actividad_numero);
        const cedula = (v.beneficiario_cedula || '').trim();
        const cedulaNorm = normalizarCedula(cedula);
        let estadoFinal = v.estado || 'pendiente';

        if (cedulaNorm && Number.isInteger(numero) && numero >= 1 && numero <= 12) {
          const existente = await db.queryOne(
            `SELECT id, usuario_id, titulo, ubicacion, fecha, estado
             FROM visitas_programadas
            WHERE ${sqlCedulaNormalizada('beneficiario_cedula')} = $1 AND actividad_numero = $2 AND id <> $3 AND estado = 'pendiente'`,
            [cedulaNorm, numero, id]
          );

          if (existente) {
            const mismaProgramacion =
              String(existente.usuario_id) === String(v.usuario_id || req.user.id) &&
              existente.titulo === (v.titulo || '') &&
              existente.ubicacion === (v.ubicacion || '') &&
              String(existente.fecha).slice(0, 10) === String(v.fecha).slice(0, 10) &&
              existente.estado === (v.estado || 'pendiente');

            resultados.push({
              id,
              estado: mismaProgramacion ? 'ya_representada' : 'conflicto',
              mensaje: mismaProgramacion
                ? 'La misma programación ya está guardada en el servidor'
                : `Ya existe otra programación pendiente para la Visita ${numero}`,
            });
            continue;
          }

          // Si el formulario de esa visita ya existe, la planificación se
          // guarda directamente como realizada (antes se rechazaba y la
          // visita quedaba pendiente en el celular para siempre).
          const formularioExistente = await db.queryOne(
            `SELECT id FROM formularios WHERE ${sqlFormularioEsVisita('$1', '$2', '$3')}`,
            [cedulaNorm, numero, String(numero)]
          );

          if (formularioExistente && estadoFinal === 'pendiente') {
            estadoFinal = 'realizada';
          }
        }

        await db.query(
          `INSERT INTO visitas_programadas (
          id, usuario_id, titulo, ubicacion, fecha, estado,
          beneficiario_cedula, beneficiario_nombre, actividad_numero, vereda, corregimiento,
          timestamp_dispositivo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           titulo = EXCLUDED.titulo,
           ubicacion = EXCLUDED.ubicacion,
           fecha = EXCLUDED.fecha,
           estado = CASE
             WHEN visitas_programadas.estado = 'realizada' AND EXCLUDED.estado = 'pendiente'
             THEN 'realizada'
             ELSE EXCLUDED.estado
           END,
           beneficiario_cedula = EXCLUDED.beneficiario_cedula,
           beneficiario_nombre = EXCLUDED.beneficiario_nombre,
           actividad_numero = EXCLUDED.actividad_numero,
           vereda = EXCLUDED.vereda,
           corregimiento = EXCLUDED.corregimiento`,
          [
            id,
            v.usuario_id || req.user.id,
            v.titulo || '',
            v.ubicacion || '',
            v.fecha,
            estadoFinal,
            v.beneficiario_cedula || null,
            v.beneficiario_nombre || null,
            v.actividad_numero ?? null,
            v.vereda || null,
            v.corregimiento || null,
            v.timestamp_dispositivo || new Date().toISOString(),
          ]
        );
        sincronizadas++;
        resultados.push({ id, estado: 'sincronizada' });
      } catch (error) {
        console.error(`[VisitasProgramadas] Error sincronizando visita ${id}:`, error.message);
        resultados.push({ id, estado: 'error', mensaje: 'No se pudo guardar esta visita en el servidor' });
      }
    }

    const representadas = resultados.filter(r => r.estado === 'ya_representada').length;
    const conflictos = resultados.filter(r => r.estado === 'conflicto').length;
    const errores = resultados.filter(r => r.estado === 'error').length;
    for (const resultado of resultados) {
      if (resultado.estado !== 'sincronizada') {
        console.warn(`[VisitasProgramadas] ${resultado.estado} en visita ${resultado.id}: ${resultado.mensaje}`);
      }
    }
    console.log(`[VisitasProgramadas] ${sincronizadas} visita(s) sincronizada(s), ${representadas} ya representada(s), ${conflictos} conflicto(s), ${errores} error(es) por ${req.user.usuario}`);
    res.json({
      estado: conflictos || errores ? 'parcial' : 'ok',
      mensaje: `${sincronizadas} visita(s) sincronizada(s), ${representadas} ya representada(s), ${conflictos} conflicto(s), ${errores} error(es)`,
      sincronizadas: sincronizadas + representadas,
      resultados,
    });
  } catch (error) {
    console.error('[VisitasProgramadas] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar visitas programadas' });
  }
});

// GET /api/visitas-programadas — Listar. El calendario es universal: todos
// los roles, incluido técnico, ven TODAS las visitas planificadas por
// cualquier técnico — no solo las propias.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const sql = `
      SELECT vp.id, vp.usuario_id, vp.titulo, vp.ubicacion, vp.fecha, vp.estado,
        vp.beneficiario_cedula, vp.beneficiario_nombre, vp.actividad_numero, vp.vereda, vp.corregimiento,
        vp.created_at, u.nombre AS usuario_nombre
      FROM visitas_programadas vp
      JOIN usuarios u ON u.id = vp.usuario_id
      ORDER BY vp.fecha ASC
    `;

    const lista = await db.queryAll(sql, []);

    res.json({
      estado: 'ok',
      total: lista.length,
      visitas: lista,
    });
  } catch (error) {
    console.error('[VisitasProgramadas] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener visitas programadas' });
  }
});

// DELETE /api/visitas-programadas/:id — El dueño o un admin puede eliminar
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const existente = await db.queryOne('SELECT usuario_id FROM visitas_programadas WHERE id = $1', [req.params.id]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Visita programada no encontrada' });
    }
    if (req.user.rol !== 'admin' && existente.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    await db.remove('visitas_programadas', 'id', req.params.id);

    console.log(`[VisitasProgramadas] Eliminada: ${req.params.id} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Visita programada eliminada correctamente' });
  } catch (error) {
    console.error('[VisitasProgramadas] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar visita programada' });
  }
});

module.exports = router;
