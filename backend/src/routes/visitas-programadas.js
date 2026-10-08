// ============================================================
// Visitas Programadas Routes — Sync + CRUD de visitas planificadas
// Compartidas entre todo el equipo (técnico → roles superiores)
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/visitas-programadas/sync — Recibir visitas programadas del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { visitas } = req.body;
    if (!Array.isArray(visitas)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de visitas' });
    }

    let sincronizadas = 0;
    for (const v of visitas) {
      const numero = Number(v.actividad_numero);
      const cedula = (v.beneficiario_cedula || '').trim();

      if (cedula && Number.isInteger(numero) && numero >= 1 && numero <= 12) {
        const existente = await db.queryOne(
          `SELECT id FROM visitas_programadas
            WHERE beneficiario_cedula = $1 AND actividad_numero = $2 AND id <> $3 AND estado = 'pendiente'`,
          [cedula, numero, v.id || '']
        );

        if (existente) {
          return res.status(409).json({
            estado: 'error',
            mensaje: `Ya existe una programación pendiente para la Visita ${numero} del beneficiario ${cedula}`,
          });
        }

        const formularioExistente = await db.queryOne(
          `SELECT id FROM formularios
            WHERE beneficiario_json->>'cedula' = $1
              AND actividad_json->>'visita_numero' = $2`,
          [cedula, String(numero)]
        );

        if (formularioExistente) {
          return res.status(409).json({
            estado: 'error',
            mensaje: `La Visita ${numero} del beneficiario ${cedula} ya fue realizada y no puede programarse otra vez`,
          });
        }
      }

      const id = v.id || `visita-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
           estado = EXCLUDED.estado,
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
          v.estado || 'pendiente',
          v.beneficiario_cedula || null,
          v.beneficiario_nombre || null,
          v.actividad_numero ?? null,
          v.vereda || null,
          v.corregimiento || null,
          v.timestamp_dispositivo || new Date().toISOString(),
        ]
      );
      sincronizadas++;
    }

    console.log(`[VisitasProgramadas] ${sincronizadas} visita(s) sincronizada(s) por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} visita(s) sincronizada(s)`,
      sincronizadas,
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
