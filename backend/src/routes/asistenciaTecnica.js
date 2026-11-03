// ============================================================
// Asistencia técnica durante el establecimiento del cultivo
// ============================================================
// La actividad ES el conjunto de visitas que hace cada técnico (Visita 1 =
// caracterización, Visita 2…12 = visitas técnicas). No tiene meta: aquí solo
// se consolida lo ya diligenciado.
//   · técnico → ve sus propias visitas.
//   · roles superiores → ven los técnicos y, al elegir uno, todas sus visitas.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { sqlNoEsPrueba } = require('../lib/usuariosPrueba');
const { sqlCedulaNormalizada } = require('../lib/visitas');

const router = express.Router();

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
const esSuperior = (user) => ROLES_SUPERIORES.includes(user?.rol);

/** Formularios que cuentan como visita (los dos tipos que maneja la app). */
const TIPOS_VISITA = `('caracterizacion', 'visita_tecnica')`;

/** Visitas de un técnico, más recientes primero. */
const visitasDeTecnico = (tecnicoId) =>
  db.queryAll(
    `SELECT f.id, f.tipo, f.created_at,
            CASE WHEN f.tipo = 'caracterizacion' THEN 1
                 ELSE NULLIF(f.actividad_json->>'visita_numero', '')::int END AS numero,
            f.beneficiario_json->>'nombre' AS nombre,
            f.beneficiario_json->>'cedula' AS cedula,
            f.beneficiario_json->>'vereda' AS vereda,
            f.beneficiario_json->>'corregimiento' AS corregimiento
     FROM formularios f
     WHERE f.usuario_id = $1 AND f.tipo IN ${TIPOS_VISITA}
     ORDER BY f.created_at DESC`,
    [tecnicoId]
  );

const aDto = (r) => ({
  id: r.id,
  tipo: r.tipo,
  numero: r.numero ?? null,
  nombre: r.nombre || 'Sin nombre',
  cedula: r.cedula || '',
  vereda: r.vereda || '',
  corregimiento: r.corregimiento || '',
  fecha: r.created_at,
});

// GET /api/asistencia-tecnica/resumen — superiores: técnicos con sus visitas
router.get('/resumen', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnicos = await db.queryAll(
      `SELECT u.usuario, u.nombre,
              COUNT(f.id)::int AS visitas,
              COUNT(DISTINCT ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")})::int AS beneficiarios
       FROM usuarios u
       LEFT JOIN formularios f ON f.usuario_id = u.id AND f.tipo IN ${TIPOS_VISITA}
       WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
       GROUP BY u.usuario, u.nombre
       ORDER BY u.nombre`
    );
    res.json({ estado: 'ok', total: tecnicos.reduce((s, t) => s + t.visitas, 0), tecnicos });
  } catch (error) {
    console.error('[AsistenciaTecnica] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al calcular el resumen' });
  }
});

// GET /api/asistencia-tecnica/mis-visitas — técnico
router.get('/mis-visitas', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo para técnicos' });
    }
    const filas = await visitasDeTecnico(req.user.id);
    res.json({ estado: 'ok', visitas: filas.map(aDto) });
  } catch (error) {
    console.error('[AsistenciaTecnica] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar visitas' });
  }
});

// GET /api/asistencia-tecnica/tecnico/:usuario — superiores
router.get('/tecnico/:usuario', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnico = await db.queryOne(
      "SELECT id, usuario, nombre FROM usuarios WHERE usuario = $1 AND rol = 'tecnico'",
      [String(req.params.usuario)]
    );
    if (!tecnico) return res.status(404).json({ estado: 'error', mensaje: 'Técnico no encontrado' });
    const filas = await visitasDeTecnico(tecnico.id);
    res.json({ estado: 'ok', tecnico, visitas: filas.map(aDto) });
  } catch (error) {
    console.error('[AsistenciaTecnica] Error listando técnico:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar visitas' });
  }
});

module.exports = router;
