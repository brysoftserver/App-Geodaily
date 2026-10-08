// ============================================================
// Draft Routes — Formularios incompletos sincronizados por usuario
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();
const MAX_DRAFT_BYTES = 15 * 1024 * 1024;

router.use(authenticateToken);

// GET /api/borradores — solo borradores del usuario autenticado
router.get('/', async (req, res) => {
  try {
    const borradores = await db.queryAll(
      `SELECT b.payload_json, b.updated_at
         FROM formularios_borradores b
        WHERE b.usuario_id = $1
          AND NOT EXISTS (SELECT 1 FROM formularios f WHERE f.id = b.id)
        ORDER BY b.updated_at DESC`,
      [req.user.id]
    );

    res.json({
      estado: 'ok',
      borradores: borradores.map((row) => ({
        ...row.payload_json,
        updated_at: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('[Borradores] Error listando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener borradores' });
  }
});

// PUT /api/borradores/:id — upsert protegido por usuario y versión
router.put('/:id', async (req, res) => {
  try {
    const borrador = req.body;
    if (!borrador || typeof borrador !== 'object' || Array.isArray(borrador) || borrador.id !== req.params.id) {
      return res.status(400).json({ estado: 'error', mensaje: 'El id del borrador no coincide' });
    }

    const bytes = Buffer.byteLength(JSON.stringify(borrador), 'utf8');
    if (bytes > MAX_DRAFT_BYTES) {
      return res.status(413).json({ estado: 'error', mensaje: 'El borrador supera el tamaño permitido' });
    }

    const id = String(borrador.id);
    const existenteFormulario = await db.queryOne('SELECT id FROM formularios WHERE id = $1', [id]);
    if (existenteFormulario) {
      await db.query('DELETE FROM formularios_borradores WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
      return res.status(409).json({ estado: 'completado', mensaje: 'El formulario ya fue completado' });
    }

    const fechaCliente = Date.parse(borrador.updated_at || '');
    const updatedAt = Number.isFinite(fechaCliente) ? new Date(fechaCliente).toISOString() : new Date().toISOString();
    const payload = {
      ...borrador,
      tecnico: { ...(borrador.tecnico || {}), usuario_id: req.user.id },
      updated_at: updatedAt,
    };

    const upsert = await db.query(
      `INSERT INTO formularios_borradores (id, usuario_id, payload_json, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         payload_json = EXCLUDED.payload_json,
         updated_at = EXCLUDED.updated_at
       WHERE formularios_borradores.usuario_id = EXCLUDED.usuario_id
         AND formularios_borradores.updated_at <= EXCLUDED.updated_at
       RETURNING id, updated_at`,
      [id, req.user.id, JSON.stringify(payload), updatedAt]
    );

    if (upsert.rowCount === 0) {
      const actual = await db.queryOne('SELECT usuario_id FROM formularios_borradores WHERE id = $1', [id]);
      if (actual && actual.usuario_id !== req.user.id) {
        return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para modificar este borrador' });
      }
      return res.status(409).json({ estado: 'desactualizado', mensaje: 'Existe una versión más reciente del borrador' });
    }

    res.json({ estado: 'ok', id, updated_at: upsert.rows[0].updated_at });
  } catch (error) {
    console.error('[Borradores] Error guardando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar borrador' });
  }
});

// DELETE /api/borradores/:id — solo el propietario
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM formularios_borradores WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[Borradores] Error eliminando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar borrador' });
  }
});

module.exports = router;