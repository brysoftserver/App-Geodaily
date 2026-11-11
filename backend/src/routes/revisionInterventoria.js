// ============================================================
// OK de la interventoría por registro de actividad
// ============================================================
//   GET    /api/revision-interventoria?actividad=X  → revisiones de la actividad
//   PUT    /api/revision-interventoria               { actividad, referencia } → marca OK
//   DELETE /api/revision-interventoria               { actividad, referencia } → quita OK
// Leer: cualquier rol autenticado. Marcar / quitar: admin e interventor.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { ACTIVIDADES, puedeRevisar, referenciaValida, quitarRevision } = require('../lib/revisionInterventoria');

const router = express.Router();

const aDto = (r) => ({
  referencia: r.referencia,
  revisadoPor: r.revisado_por_nombre || null,
  revisadoEn: r.revisado_en,
});

/** Valida { actividad, referencia } del body. Responde 400 y devuelve null si no son válidos. */
function datosValidos(req, res) {
  const actividad = String(req.body?.actividad || '');
  const referencia = String(req.body?.referencia ?? '');
  if (!ACTIVIDADES.has(actividad) || !referenciaValida(referencia)) {
    res.status(400).json({ estado: 'error', mensaje: 'Actividad o registro inválido' });
    return null;
  }
  return { actividad, referencia };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const actividad = String(req.query.actividad || '');
    if (!ACTIVIDADES.has(actividad)) return res.status(400).json({ estado: 'error', mensaje: 'Actividad inválida' });
    const filas = await db.queryAll(
      'SELECT referencia, revisado_por_nombre, revisado_en FROM revision_interventoria WHERE actividad = $1',
      [actividad]
    );
    res.json({ estado: 'ok', revisiones: filas.map(aDto) });
  } catch (error) {
    console.error('[RevisionInterventoria] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al consultar las revisiones' });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  try {
    if (!puedeRevisar(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo la interventoría o el administrador pueden revisar' });
    }
    const d = datosValidos(req, res);
    if (!d) return;
    const fila = await db.queryOne(
      `INSERT INTO revision_interventoria (actividad, referencia, revisado_por, revisado_por_nombre)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actividad, referencia) DO UPDATE SET
         revisado_por = EXCLUDED.revisado_por, revisado_por_nombre = EXCLUDED.revisado_por_nombre, revisado_en = NOW()
       RETURNING referencia, revisado_por_nombre, revisado_en`,
      [d.actividad, d.referencia, req.user.id, req.user.nombre || req.user.usuario || null]
    );
    res.json({ estado: 'ok', revision: aDto(fila) });
  } catch (error) {
    console.error('[RevisionInterventoria] Error al marcar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al marcar como revisado' });
  }
});

router.delete('/', authenticateToken, async (req, res) => {
  try {
    if (!puedeRevisar(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo la interventoría o el administrador pueden revisar' });
    }
    const d = datosValidos(req, res);
    if (!d) return;
    await quitarRevision(d.actividad, d.referencia);
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[RevisionInterventoria] Error al quitar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al quitar la revisión' });
  }
});

module.exports = router;
