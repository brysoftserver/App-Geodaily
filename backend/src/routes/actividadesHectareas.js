// ============================================================
// Actividades medidas en hectáreas (meta del proyecto: 750 ha cada una)
// ============================================================
// Las hectáreas de cada beneficiario salen de la visita que ya diligenció el
// técnico (ver DERIVADAS_DE_VISITA). La tabla actividad_hectareas (digitación
// manual) queda como respaldo para las actividades aún no derivadas.
// Los roles superiores ven el consolidado de todos los técnicos (solo lectura).
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { sqlCedulaNormalizada } = require('../lib/visitas');
const { sqlNoEsPrueba } = require('../lib/usuariosPrueba');

const router = express.Router();

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
const META_HECTAREAS = 750;
/** Tope por beneficiario: evita errores de digitación (ej. 25000 en vez de 2.5). */
const MAX_HECTAREAS_BENEFICIARIO = 1000;

/** Actividades que se miden en hectáreas (ids de src/data/actividades.ts del cliente). */
const ACTIVIDADES = new Set([
  'preparacion_terreno',
  'siembra_cacao',
  'siembra_platano',
  'siembra_forestales',
  'fertilizacion',
  'control_sanitario',
]);

/**
 * Actividades cuyas hectáreas NO se digitan: salen de una visita ya
 * diligenciada. Cada beneficiario con esa visita COMPLETADA (guardada en
 * `formularios`; los borradores viven aparte) cuenta `hectareas` fijas: es la
 * área que le corresponde por proyecto, el polígono medido solo es referencia.
 */
const DERIVADAS_DE_VISITA = {
  preparacion_terreno: { visita: 2, hectareas: 2.5 },
};

/**
 * CTE `v`: la visita técnica N completada más reciente de cada cédula. La
 * cédula de cada formulario se normaliza UNA vez aquí; con un LATERAL por
 * beneficiario se repetía la normalización ~200.000 veces (2,6 s por consulta).
 */
const cteVisita = (visita) => `
  WITH v AS (
    SELECT DISTINCT ON (ced) id, ced FROM (
      SELECT f.id, f.created_at,
             ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} AS ced
      FROM formularios f
      WHERE f.tipo = 'visita_tecnica'
        AND f.actividad_json->>'visita_numero' = '${Number(visita)}'
    ) x
    WHERE ced <> ''
    ORDER BY ced, created_at DESC
  )`;

/** Une, por beneficiario `b`, su visita de la CTE `v` (v.id; NULL si no la tiene). */
const joinVisita = `LEFT JOIN v ON v.ced = ${sqlCedulaNormalizada('b.cedula')}`;

const esSuperior = (user) => ROLES_SUPERIORES.includes(user?.rol);

/** Valida el parámetro :actividad. Responde 404 y devuelve false si no existe. */
function actividadValida(req, res) {
  if (!ACTIVIDADES.has(req.params.actividad)) {
    res.status(404).json({ estado: 'error', mensaje: 'Actividad no encontrada' });
    return false;
  }
  return true;
}

/**
 * Beneficiarios con su avance en la actividad. `tecnicoId` null = TODOS los
 * de técnicos activos (vista de la interventoría, sin filtro por técnico).
 * `tiene_suelo`: ya tiene el análisis de suelos subido (la interventoría los
 * ve primero).
 */
async function beneficiariosDeTecnico(tecnicoId, actividad) {
  const derivada = DERIVADAS_DE_VISITA[actividad];
  if (derivada) {
    const filtro = tecnicoId
      ? 'WHERE b.tecnico_asignado_id = $1'
      : `JOIN usuarios u ON u.id = b.tecnico_asignado_id AND u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}`;
    const filas = await db.queryAll(
      `${cteVisita(derivada.visita)}
       SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda, v.id AS formulario_id,
              EXISTS (SELECT 1 FROM analisis_suelos a WHERE a.beneficiario_item = b.item) AS tiene_suelo
       FROM beneficiarios b
       ${joinVisita}
       ${filtro}
       ORDER BY b.nombre_completo ASC`,
      tecnicoId ? [tecnicoId] : []
    );
    return filas.map((f) => ({ ...f, hectareas: f.formulario_id ? derivada.hectareas : 0 }));
  }
  return db.queryAll(
    `SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
            h.hectareas::float8 AS hectareas, NULL AS formulario_id
     FROM beneficiarios b
     LEFT JOIN actividad_hectareas h ON h.beneficiario_item = b.item AND h.actividad = $2
     WHERE b.tecnico_asignado_id = $1
     ORDER BY b.nombre_completo ASC`,
    [tecnicoId, actividad]
  );
}

const aDto = (r) => ({
  item: r.item,
  nombre: r.nombre_completo,
  cedula: r.cedula,
  corregimiento: r.corregimiento,
  vereda: r.vereda,
  hectareas: r.hectareas ?? 0,
  /** Visita que respalda las hectáreas (solo actividades derivadas de una visita). */
  formularioId: r.formulario_id ?? null,
  tieneSuelo: !!r.tiene_suelo,
});

// GET /api/actividades-hectareas/avance — cualquier rol: total por actividad
// (para las tarjetas de la lista de actividades).
router.get('/avance', authenticateToken, async (_req, res) => {
  try {
    const filas = await db.queryAll(
      `SELECT h.actividad, COALESCE(SUM(h.hectareas), 0)::float8 AS total
       FROM actividad_hectareas h
       JOIN beneficiarios b ON b.item = h.beneficiario_item
       JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
       GROUP BY h.actividad`
    );
    const avance = {};
    for (const f of filas) avance[f.actividad] = f.total;
    for (const [actividad, d] of Object.entries(DERIVADAS_DE_VISITA)) {
      const r = await db.queryOne(
        `${cteVisita(d.visita)}
         SELECT COUNT(v.id)::int AS completados
         FROM beneficiarios b
         JOIN usuarios u ON u.id = b.tecnico_asignado_id AND u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
         ${joinVisita}`
      );
      avance[actividad] = (r?.completados ?? 0) * d.hectareas;
    }
    res.json({ estado: 'ok', meta: META_HECTAREAS, avance });
  } catch (error) {
    console.error('[Hectareas] Error en avance:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al calcular el avance' });
  }
});

// GET /api/actividades-hectareas/:actividad/resumen — cualquier rol: avance por técnico
router.get('/:actividad/resumen', authenticateToken, async (req, res) => {
  try {
    if (!actividadValida(req, res)) return;
    const derivada = DERIVADAS_DE_VISITA[req.params.actividad];
    const tecnicos = derivada
      ? (
          await db.queryAll(
            `${cteVisita(derivada.visita)}
             SELECT u.usuario, u.nombre,
                    COUNT(b.item)::int AS asignados,
                    COUNT(v.id)::int AS completados
             FROM usuarios u
             LEFT JOIN beneficiarios b ON b.tecnico_asignado_id = u.id
             ${joinVisita}
             WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
             GROUP BY u.usuario, u.nombre
             ORDER BY u.nombre`
          )
        ).map((t) => ({ ...t, hectareas: t.completados * derivada.hectareas }))
      : await db.queryAll(
          `SELECT u.usuario, u.nombre,
                  COUNT(b.item)::int AS asignados,
                  COALESCE(SUM(h.hectareas), 0)::float8 AS hectareas
           FROM usuarios u
           LEFT JOIN beneficiarios b ON b.tecnico_asignado_id = u.id
           LEFT JOIN actividad_hectareas h ON h.beneficiario_item = b.item AND h.actividad = $1
           WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
           GROUP BY u.usuario, u.nombre
           ORDER BY u.nombre`,
          [req.params.actividad]
        );
    const total = tecnicos.reduce((s, t) => s + t.hectareas, 0);
    res.json({ estado: 'ok', meta: META_HECTAREAS, total, tecnicos });
  } catch (error) {
    console.error('[Hectareas] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al calcular el resumen' });
  }
});

// GET /api/actividades-hectareas/:actividad/mis-beneficiarios — técnico
router.get('/:actividad/mis-beneficiarios', authenticateToken, async (req, res) => {
  try {
    if (!actividadValida(req, res)) return;
    if (req.user.rol !== 'tecnico') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo para técnicos' });
    }
    const filas = await beneficiariosDeTecnico(req.user.id, req.params.actividad);
    res.json({ estado: 'ok', beneficiarios: filas.map(aDto) });
  } catch (error) {
    console.error('[Hectareas] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// GET /api/actividades-hectareas/:actividad/todos — superiores: TODOS los
// beneficiarios con la actividad hecha (sin filtro por técnico), primero los
// que tienen análisis de suelos.
router.get('/:actividad/todos', authenticateToken, async (req, res) => {
  try {
    if (!actividadValida(req, res)) return;
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    if (!DERIVADAS_DE_VISITA[req.params.actividad]) {
      return res.status(404).json({ estado: 'error', mensaje: 'Actividad sin vista consolidada' });
    }
    // Solo los que ya tienen la actividad hecha (visita completada); los demás no se muestran.
    const filas = (await beneficiariosDeTecnico(null, req.params.actividad)).filter((f) => f.formulario_id);
    filas.sort((a, b) => Number(!!b.tiene_suelo) - Number(!!a.tiene_suelo)); // estable: conserva el orden alfabético
    res.json({ estado: 'ok', beneficiarios: filas.map(aDto) });
  } catch (error) {
    console.error('[Hectareas] Error listando todos:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// GET /api/actividades-hectareas/:actividad/tecnico/:usuario — superiores
router.get('/:actividad/tecnico/:usuario', authenticateToken, async (req, res) => {
  try {
    if (!actividadValida(req, res)) return;
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnico = await db.queryOne(
      "SELECT id, usuario, nombre FROM usuarios WHERE usuario = $1 AND rol = 'tecnico'",
      [String(req.params.usuario)]
    );
    if (!tecnico) return res.status(404).json({ estado: 'error', mensaje: 'Técnico no encontrado' });
    const filas = await beneficiariosDeTecnico(tecnico.id, req.params.actividad);
    res.json({ estado: 'ok', tecnico, beneficiarios: filas.map(aDto) });
  } catch (error) {
    console.error('[Hectareas] Error listando técnico:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// PUT /api/actividades-hectareas/:actividad/:item — técnico dueño del beneficiario
// body: { hectareas: number | null }  (null o 0 = borrar el registro)
router.put('/:actividad/:item', authenticateToken, async (req, res) => {
  try {
    if (!actividadValida(req, res)) return;
    if (DERIVADAS_DE_VISITA[req.params.actividad]) {
      return res.status(409).json({
        estado: 'error',
        mensaje: `Estas hectáreas se calculan de la Visita Técnica ${DERIVADAS_DE_VISITA[req.params.actividad].visita}; no se digitan.`,
      });
    }
    if (req.user.rol !== 'tecnico') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico registra hectáreas' });
    }
    const item = parseInt(req.params.item, 10);
    if (!Number.isInteger(item)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Beneficiario inválido' });
    }
    const b = await db.queryOne('SELECT item, tecnico_asignado_id FROM beneficiarios WHERE item = $1', [item]);
    if (!b) return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    if (b.tecnico_asignado_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'Este beneficiario no está asignado a ti' });
    }

    const crudo = req.body?.hectareas;
    if (crudo === null || crudo === undefined || crudo === '' || Number(crudo) === 0) {
      await db.query('DELETE FROM actividad_hectareas WHERE actividad = $1 AND beneficiario_item = $2', [req.params.actividad, item]);
      return res.json({ estado: 'ok', hectareas: 0 });
    }
    const hectareas = Math.round(Number(crudo) * 100) / 100;
    if (!Number.isFinite(hectareas) || hectareas < 0 || hectareas > MAX_HECTAREAS_BENEFICIARIO) {
      return res.status(400).json({
        estado: 'error',
        mensaje: `Las hectáreas deben estar entre 0 y ${MAX_HECTAREAS_BENEFICIARIO}`,
      });
    }
    await db.query(
      `INSERT INTO actividad_hectareas (actividad, beneficiario_item, hectareas, tecnico_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actividad, beneficiario_item) DO UPDATE SET
         hectareas = EXCLUDED.hectareas, tecnico_id = EXCLUDED.tecnico_id, updated_at = NOW()`,
      [req.params.actividad, item, hectareas, req.user.id]
    );
    res.json({ estado: 'ok', hectareas });
  } catch (error) {
    console.error('[Hectareas] Error al guardar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar las hectáreas' });
  }
});

// Para la Bitácora del Beneficiario (mismas reglas de hectáreas y actividades).
router.ACTIVIDADES = ACTIVIDADES;
router.DERIVADAS_DE_VISITA = DERIVADAS_DE_VISITA;

module.exports = router;
