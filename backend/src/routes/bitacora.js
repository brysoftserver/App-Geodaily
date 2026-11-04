// ============================================================
// Bitácora del Beneficiario (interventoría)
// ============================================================
// Vista consolidada de un beneficiario: datos personales, predio, ubicación,
// visitas realizadas y avance en cada actividad (análisis de suelos,
// preparación del terreno…). Solo lectura; la consultan interventoría y admin.
//   GET /api/bitacora/beneficiarios        → lista (con conteos)
//   GET /api/bitacora/beneficiarios/:item  → ficha completa
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { sqlCedulaNormalizada, normalizarCedula } = require('../lib/visitas');
const hectareas = require('./actividadesHectareas');

const router = express.Router();

const ROLES_BITACORA = ['interventor', 'admin'];
const soloBitacora = (req, res, next) => {
  if (!ROLES_BITACORA.includes(req.user?.rol)) {
    return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
  }
  next();
};

/** Número de visita de un formulario como expresión SQL (null si no lo trae). */
const SQL_NUMERO_VISITA = `
  CASE WHEN f.tipo = 'caracterizacion' THEN 1
       WHEN f.actividad_json->>'visita_numero' ~ '^[0-9]+$' THEN (f.actividad_json->>'visita_numero')::int
       ELSE NULL END`;

const TIPOS_VISITA = `('caracterizacion', 'visita_tecnica')`;

// GET /api/bitacora/beneficiarios
router.get('/beneficiarios', authenticateToken, soloBitacora, async (_req, res) => {
  try {
    // Una sola pasada por `formularios`: la cédula se normaliza UNA vez por fila.
    const filas = await db.queryAll(
      `WITH visitas AS (
         SELECT ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} AS ced,
                COUNT(DISTINCT COALESCE(${SQL_NUMERO_VISITA}, -1))::int AS n
         FROM formularios f
         WHERE f.tipo IN ${TIPOS_VISITA}
         GROUP BY 1
       )
       SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
              b.tecnico_asignado_nombre AS tecnico,
              COALESCE(v.n, 0) AS visitas,
              (a.beneficiario_item IS NOT NULL) AS suelos
       FROM beneficiarios b
       LEFT JOIN visitas v ON v.ced = ${sqlCedulaNormalizada('b.cedula')}
       LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item
       ORDER BY b.nombre_completo ASC`
    );
    res.json({
      estado: 'ok',
      beneficiarios: filas.map((f) => ({
        item: f.item,
        nombre: f.nombre_completo,
        cedula: f.cedula,
        corregimiento: f.corregimiento,
        vereda: f.vereda,
        tecnico: f.tecnico || null,
        visitas: f.visitas,
        suelos: !!f.suelos,
      })),
    });
  } catch (error) {
    console.error('[Bitacora] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// GET /api/bitacora/beneficiarios/:item
router.get('/beneficiarios/:item', authenticateToken, soloBitacora, async (req, res) => {
  try {
    const item = parseInt(req.params.item, 10);
    if (!Number.isInteger(item)) return res.status(400).json({ estado: 'error', mensaje: 'Beneficiario inválido' });

    const b = await db.queryOne('SELECT * FROM beneficiarios WHERE item = $1', [item]);
    if (!b) return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    const ced = normalizarCedula(b.cedula);

    // ─── Visitas realizadas (más recientes primero) ─────────
    const visitasFilas = await db.queryAll(
      `SELECT f.id, f.tipo, ${SQL_NUMERO_VISITA} AS numero, f.created_at, u.nombre AS tecnico
       FROM formularios f
       LEFT JOIN usuarios u ON u.id = f.usuario_id
       WHERE f.tipo IN ${TIPOS_VISITA}
         AND ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} = $1
       ORDER BY f.created_at DESC`,
      [ced]
    );
    const visitas = visitasFilas.map((v) => ({
      id: v.id,
      tipo: v.tipo,
      numero: v.numero ?? null,
      fecha: v.created_at,
      tecnico: v.tecnico || null,
    }));

    // GPS capturado en la caracterización (Visita 1), si existe.
    const car = await db.queryOne(
      `SELECT f.coordenadas_json
       FROM formularios f
       WHERE f.tipo = 'caracterizacion'
         AND ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} = $1
         AND f.coordenadas_json IS NOT NULL
       ORDER BY f.created_at DESC LIMIT 1`,
      [ced]
    );
    const gps = car?.coordenadas_json;

    // ─── Actividades ────────────────────────────────────────
    const suelos = await db.queryOne(
      'SELECT nombre_archivo, updated_at FROM analisis_suelos WHERE beneficiario_item = $1',
      [item]
    );

    const hectareasManuales = await db.queryAll(
      'SELECT actividad, hectareas::float8 AS hectareas FROM actividad_hectareas WHERE beneficiario_item = $1',
      [item]
    );
    const fotos = await db.queryAll(
      `SELECT actividad, momento, COUNT(*)::int AS n
       FROM actividad_evidencias WHERE beneficiario_item = $1 GROUP BY 1, 2`,
      [item]
    );
    const actas = await db.queryAll(
      `SELECT o.datos->>'actividadId' AS actividad, COUNT(*)::int AS n,
              COALESCE(SUM((SELECT COUNT(*) FROM otros_formatos_observaciones x
                            WHERE x.formato_id = o.id AND NOT x.resuelta)), 0)::int AS observaciones
       FROM otros_formatos o
       WHERE o.tipo = 'acta_entrega_individual' AND o.completo = TRUE
         AND o.beneficiario_cedula = $1 AND o.datos->>'actividadId' IS NOT NULL
       GROUP BY 1`,
      [b.cedula]
    );

    const actividadesHa = [...hectareas.ACTIVIDADES].map((id) => {
      const derivada = hectareas.DERIVADAS_DE_VISITA[id];
      let ha = hectareasManuales.find((h) => h.actividad === id)?.hectareas ?? 0;
      let respaldadaPorVisita = null;
      if (derivada) {
        const v = visitas.find((x) => x.numero === derivada.visita);
        respaldadaPorVisita = derivada.visita;
        ha = v ? derivada.hectareas : 0;
      }
      const f = fotos.filter((x) => x.actividad === id);
      const a = actas.find((x) => x.actividad === id);
      const foto = (m) => f.find((x) => x.momento === m)?.n ?? 0;
      return {
        id,
        hectareas: ha,
        respaldadaPorVisita,
        actas: a?.n ?? 0,
        observacionesPendientes: a?.observaciones ?? 0,
        fotos: { antes: foto('antes'), durante: foto('durante'), despues: foto('despues') },
      };
    });

    res.json({
      estado: 'ok',
      beneficiario: {
        item: b.item,
        nombre: b.nombre_completo,
        cedula: b.cedula,
        telefono: b.telefono || null,
        correo: b.correo_electronico || null,
        departamento: b.departamento || null,
        municipio: b.municipio || null,
        corregimiento: b.corregimiento,
        vereda: b.vereda,
        tecnico: b.tecnico_asignado_nombre || null,
      },
      predio: {
        nombre: b.nombre_predio && b.nombre_predio !== '---' ? b.nombre_predio : null,
        area: b.area_predio != null ? Number(b.area_predio) : null,
        calidad: b.calidad_predio || null,
      },
      ubicacion: {
        registrada: b.latitud != null && b.longitud != null ? { latitud: Number(b.latitud), longitud: Number(b.longitud) } : null,
        gpsVisita1: gps && gps.latitud != null && gps.longitud != null
          ? { latitud: Number(gps.latitud), longitud: Number(gps.longitud), precision: gps.precision_gps ?? null, lugar: gps.lugar ?? null }
          : null,
      },
      visitas,
      actividades: {
        analisisSuelos: suelos ? { subido: true, nombreArchivo: suelos.nombre_archivo, fecha: suelos.updated_at } : { subido: false },
        enHectareas: actividadesHa,
      },
    });
  } catch (error) {
    console.error('[Bitacora] Error en ficha:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cargar la bitácora del beneficiario' });
  }
});

module.exports = router;
