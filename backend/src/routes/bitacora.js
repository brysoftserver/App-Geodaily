// ============================================================
// Bitácora del Beneficiario (interventoría)
// ============================================================
// Vista consolidada de un beneficiario: datos personales, predio, ubicación,
// visitas realizadas y avance en cada actividad (análisis de suelos,
// preparación del terreno…). Solo lectura; la puede consultar cualquier rol.
//   GET /api/bitacora/beneficiarios        → lista (con conteos)
//   GET /api/bitacora/beneficiarios/:item  → ficha completa
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { sqlCedulaNormalizada, normalizarCedula } = require('../lib/visitas');
const { sqlNoEsPrueba } = require('../lib/usuariosPrueba');
const hectareas = require('./actividadesHectareas');
const evidencia = require('../lib/actividadesEvidencia');

const router = express.Router();

// Todos los roles actuales la consultan. Se lista explícito (y no "cualquier
// usuario autenticado") para que un rol nuevo NO gane acceso sin decidirlo aquí.
const ROLES_BITACORA = ['tecnico', 'coordinador', 'interventor', 'gerente', 'admin'];
const rolesBitacora = (req, res, next) => {
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
router.get('/beneficiarios', authenticateToken, rolesBitacora, async (_req, res) => {
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

// GET /api/bitacora/informe-general — datos de TODOS los beneficiarios para el
// PDF consolidado. Igual que los demás consolidados, deja fuera a los
// beneficiarios asignados a usuarios de prueba.
router.get('/informe-general', authenticateToken, rolesBitacora, async (_req, res) => {
  try {
    const benefs = await db.queryAll(
      `SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
              COALESCE(u.nombre, b.tecnico_asignado_nombre) AS tecnico
       FROM beneficiarios b
       LEFT JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE u.usuario IS NULL OR ${sqlNoEsPrueba('u.usuario')}
       ORDER BY COALESCE(u.nombre, b.tecnico_asignado_nombre, 'zzz'), b.nombre_completo`
    );

    // Una sola pasada por `formularios`: última fecha de cada visita por cédula.
    const visitasFilas = await db.queryAll(
      `SELECT ced, numero, MAX(created_at) AS fecha FROM (
         SELECT ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} AS ced,
                ${SQL_NUMERO_VISITA} AS numero, f.created_at
         FROM formularios f WHERE f.tipo IN ${TIPOS_VISITA}
       ) x WHERE ced <> '' GROUP BY ced, numero`
    );
    const suelosFilas = await db.queryAll('SELECT beneficiario_item, updated_at FROM analisis_suelos');
    const manuales = await db.queryAll('SELECT actividad, beneficiario_item, hectareas::float8 AS hectareas FROM actividad_hectareas');
    const fotosFilas = await db.queryAll(
      'SELECT actividad, beneficiario_item, momento, COUNT(*)::int AS n FROM actividad_evidencias GROUP BY 1, 2, 3'
    );
    const actasFilas = await db.queryAll(
      `SELECT o.beneficiario_cedula AS cedula, o.datos->>'actividadId' AS actividad, COUNT(*)::int AS n,
              COALESCE(SUM((SELECT COUNT(*) FROM otros_formatos_observaciones x
                            WHERE x.formato_id = o.id AND NOT x.resuelta)), 0)::int AS observaciones
       FROM otros_formatos o
       WHERE o.tipo = 'acta_entrega_individual' AND o.completo = TRUE AND o.datos->>'actividadId' IS NOT NULL
       GROUP BY 1, 2`
    );

    const visitasPorCed = new Map();
    for (const v of visitasFilas) {
      if (!visitasPorCed.has(v.ced)) visitasPorCed.set(v.ced, []);
      visitasPorCed.get(v.ced).push({ numero: v.numero ?? null, fecha: v.fecha });
    }
    const suelosPorItem = new Map(suelosFilas.map((r) => [r.beneficiario_item, r.updated_at]));

    const beneficiarios = benefs.map((b) => {
      const visitas = (visitasPorCed.get(normalizarCedula(b.cedula)) || []).sort(
        (x, y) => (x.numero ?? 99) - (y.numero ?? 99)
      );
      const enHectareas = [];
      for (const id of hectareas.ACTIVIDADES) {
        const derivada = hectareas.DERIVADAS_DE_VISITA[id];
        let ha = manuales.find((m) => m.actividad === id && m.beneficiario_item === b.item)?.hectareas ?? 0;
        if (derivada) ha = visitas.some((v) => v.numero === derivada.visita) ? derivada.hectareas : 0;
        const f = fotosFilas.filter((x) => x.actividad === id && x.beneficiario_item === b.item);
        const foto = (m) => f.find((x) => x.momento === m)?.n ?? 0;
        const a = actasFilas.find((x) => x.actividad === id && x.cedula === b.cedula);
        const fotos = { antes: foto('antes'), durante: foto('durante'), despues: foto('despues') };
        // Solo las que ya tienen algo (o la derivada de visita, que siempre se reporta).
        if (!derivada && !ha && !a && !(fotos.antes + fotos.durante + fotos.despues)) continue;
        enHectareas.push({ id, hectareas: ha, actas: a?.n ?? 0, observacionesPendientes: a?.observaciones ?? 0, fotos });
      }
      // Subactividades con acta + fotos (ej. 'siembra_platano.fertilizacion'): solo si ya tienen algo.
      for (const id of evidencia.CLAVES_SUBACTIVIDADES) {
        const f = fotosFilas.filter((x) => x.actividad === id && x.beneficiario_item === b.item);
        const foto = (m) => f.find((x) => x.momento === m)?.n ?? 0;
        const a = actasFilas.find((x) => x.actividad === id && x.cedula === b.cedula);
        const fotos = { antes: foto('antes'), durante: foto('durante'), despues: foto('despues') };
        if (!a && !(fotos.antes + fotos.durante + fotos.despues)) continue;
        enHectareas.push({ id, hectareas: 0, actas: a?.n ?? 0, observacionesPendientes: a?.observaciones ?? 0, fotos });
      }
      return {
        item: b.item,
        nombre: b.nombre_completo,
        cedula: b.cedula,
        corregimiento: b.corregimiento,
        vereda: b.vereda,
        tecnico: b.tecnico || null,
        visitas,
        suelos: suelosPorItem.has(b.item) ? { fecha: suelosPorItem.get(b.item) } : null,
        enHectareas,
      };
    });

    res.json({ estado: 'ok', generado: new Date().toISOString(), beneficiarios });
  } catch (error) {
    console.error('[Bitacora] Error en informe general:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al armar el informe general' });
  }
});

// GET /api/bitacora/beneficiarios/:item
router.get('/beneficiarios/:item', authenticateToken, rolesBitacora, async (req, res) => {
  try {
    const item = parseInt(req.params.item, 10);
    if (!Number.isInteger(item)) return res.status(400).json({ estado: 'error', mensaje: 'Beneficiario inválido' });

    const b = await db.queryOne('SELECT * FROM beneficiarios WHERE item = $1', [item]);
    if (!b) return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    const ced = normalizarCedula(b.cedula);

    // ─── Visitas realizadas (más recientes primero) ─────────
    const visitasFilas = await db.queryAll(
      `SELECT f.id, f.tipo, f.usuario_id, ${SQL_NUMERO_VISITA} AS numero, f.created_at, u.nombre AS tecnico
       FROM formularios f
       LEFT JOIN usuarios u ON u.id = f.usuario_id
       WHERE f.tipo IN ${TIPOS_VISITA}
         AND ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} = $1
       ORDER BY f.created_at DESC`,
      [ced]
    );
    // El técnico solo puede abrir SUS formularios (GET /api/formularios/:id lo
    // restringe); el resto de roles abre cualquiera. Se avisa a la pantalla para
    // no ofrecer un enlace que terminaría en "sin acceso".
    const esTecnico = req.user.rol === 'tecnico';
    const visitas = visitasFilas.map((v) => ({
      id: v.id,
      tipo: v.tipo,
      numero: v.numero ?? null,
      fecha: v.created_at,
      tecnico: v.tecnico || null,
      abrible: !esTecnico || v.usuario_id === req.user.id,
    }));
    // Panel de actividad y PDF de suelos: el técnico solo en sus beneficiarios.
    const detalleActividades = !esTecnico || b.tecnico_asignado_id === req.user.id;

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
    // Subactividades con acta + fotos: solo las que ya tienen registros.
    for (const id of evidencia.CLAVES_SUBACTIVIDADES) {
      const f = fotos.filter((x) => x.actividad === id);
      const a = actas.find((x) => x.actividad === id);
      const foto = (m) => f.find((x) => x.momento === m)?.n ?? 0;
      const n = { antes: foto('antes'), durante: foto('durante'), despues: foto('despues') };
      if (!a && !(n.antes + n.durante + n.despues)) continue;
      actividadesHa.push({ id, hectareas: 0, respaldadaPorVisita: null, actas: a?.n ?? 0, observacionesPendientes: a?.observaciones ?? 0, fotos: n });
    }

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
      detalleActividades,
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
