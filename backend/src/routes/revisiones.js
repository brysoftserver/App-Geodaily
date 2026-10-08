// ============================================================
// Revisiones de Formularios — Flujo de retroalimentación jerárquico
// ============================================================
// Cuando el técnico finaliza un formulario, los roles superiores lo
// revisan y registran:
//   - tipo 'novedad'      → observación/corrección pendiente
//   - tipo 'visto_bueno'  → aprobación ("Todo OK")
// Junto con el visto bueno puede ir el formulario pequeño del rol
// (datos_formulario_json: concepto, observaciones, recomendaciones).
//
// JERARQUÍA DE CONTROL: el interventor solo puede revisar (y ver, ver
// forms.js) formularios que YA tienen visto bueno del coordinador.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { crearNotificacion } = require('./notificaciones');
const router = express.Router();

const ROLES_REVISORES = ['coordinador', 'interventor', 'gerente', 'admin'];

/** ¿El formulario tiene visto bueno de un rol dado? */
async function tieneVistoBueno(formularioId, rol) {
  const row = await db.queryOne(
    `SELECT id FROM revisiones_formulario
     WHERE formulario_id = $1 AND revisor_rol = $2 AND tipo = 'visto_bueno'
     ORDER BY created_at DESC LIMIT 1`,
    [formularioId, rol]
  );
  return !!row;
}

// GET /api/revisiones/resumen — Estado de revisión de TODOS los formularios
// (para pintar badges en listados sin pedir formulario por formulario).
// Devuelve: { estados: { [formulario_id]: { coordinador: 'ok'|'novedades'|null, interventor: ..., novedades_total: n } } }
// novedades_total = novedades PENDIENTES del rol (ver criterio abajo).
router.get('/resumen', authenticateToken, async (req, res) => {
  try {
    // Último movimiento por (formulario, rol) considerando SOLO novedad/visto
    // bueno (los checklists en línea/campo no afectan el estado). Si el último
    // movimiento del rol fue un visto bueno, el rol está en 'ok'; si fue una
    // novedad, está en 'novedades' (tiene observaciones sin cerrar).
    const ultimoPorRol = await db.queryAll(
      `SELECT DISTINCT ON (formulario_id, revisor_rol)
         formulario_id, revisor_rol, tipo
       FROM revisiones_formulario
       WHERE tipo IN ('novedad', 'visto_bueno')
       ORDER BY formulario_id, revisor_rol, created_at DESC, id DESC`
    );
    // Conteo de novedades PENDIENTES (sin corregir). Una novedad se considera
    // resuelta cuando el MISMO rol que la marcó la da por buena:
    //   1. el rol ya "dio OK" (su último movimiento fue un visto bueno) →
    //      se resuelven TODAS sus novedades de ese formulario; o
    //   2. existe un visto bueno posterior que la cubre: global (seccion NULL)
    //      o de la MISMA sección.
    // Es el mismo criterio que usa el detalle (src/utils/revisiones.ts →
    // estaNovedadResuelta), de modo que la tarjeta del listado y el detalle
    // siempre coinciden.
    const novedadesTotales = await db.queryAll(
      `WITH ultimo AS (
         SELECT DISTINCT ON (formulario_id, revisor_rol)
           formulario_id, revisor_rol, tipo
         FROM revisiones_formulario
         WHERE tipo IN ('novedad', 'visto_bueno')
         ORDER BY formulario_id, revisor_rol, created_at DESC, id DESC
       )
       SELECT n.formulario_id, COUNT(*)::int AS total
       FROM revisiones_formulario n
       JOIN ultimo u
         ON u.formulario_id = n.formulario_id
        AND u.revisor_rol = n.revisor_rol
       WHERE n.tipo = 'novedad'
         AND u.tipo <> 'visto_bueno'
         AND NOT EXISTS (
           SELECT 1 FROM revisiones_formulario vb
           WHERE vb.formulario_id = n.formulario_id
             AND vb.revisor_rol = n.revisor_rol
             AND vb.tipo = 'visto_bueno'
             AND (vb.seccion IS NULL OR vb.seccion = n.seccion)
             AND vb.created_at >= n.created_at
         )
       GROUP BY n.formulario_id`
    );

    const estados = {};
    const getEstado = (id) => {
      if (!estados[id]) {
        estados[id] = { coordinador: null, interventor: null, gerente: null, admin: null, novedades_total: 0 };
      }
      return estados[id];
    };
    for (const f of ultimoPorRol) {
      const e = getEstado(f.formulario_id);
      e[f.revisor_rol] = f.tipo === 'visto_bueno' ? 'ok' : 'novedades';
    }
    for (const n of novedadesTotales) {
      getEstado(n.formulario_id).novedades_total = n.total;
    }

    res.json({ estado: 'ok', estados });
  } catch (error) {
    console.error('[Revisiones] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener resumen de revisiones' });
  }
});

// GET /api/revisiones/:formularioId — Historial de revisiones de un formulario
router.get('/:formularioId', authenticateToken, async (req, res) => {
  try {
    const revisiones = await db.queryAll(
      `SELECT id, formulario_id, revisor_id, revisor_nombre, revisor_rol, tipo, seccion, comentario, datos_formulario_json, created_at
       FROM revisiones_formulario
       WHERE formulario_id = $1
       ORDER BY created_at ASC`,
      [req.params.formularioId]
    );
    res.json({ estado: 'ok', revisiones });
  } catch (error) {
    console.error('[Revisiones] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar revisiones' });
  }
});

// POST /api/revisiones/:formularioId — Registrar novedad o visto bueno
// body: { tipo: 'novedad' | 'visto_bueno', comentario?, datos_formulario? }
router.post('/:formularioId', authenticateToken, async (req, res) => {
  try {
    const { rol, id: revisorId, nombre: revisorNombre } = req.user;
    if (!ROLES_REVISORES.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo los roles superiores pueden revisar formularios' });
    }

    const { tipo, comentario, datos_formulario, seccion } = req.body;
    // 'formulario_en_linea' / 'formulario_en_campo' = las dos listas de
    // verificación del rol (coordinador/interventor), independientes del
    // visto bueno — no afectan el estado de aprobación. Reemplazan al
    // antiguo 'formulario_rol' (concepto/observaciones/recomendaciones
    // libres), que se deja de aceptar en formularios nuevos pero cuyo
    // histórico ya guardado sigue siendo legible.
    const TIPOS_VALIDOS = ['novedad', 'visto_bueno', 'formulario_en_linea', 'formulario_en_campo'];
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ estado: 'error', mensaje: `tipo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` });
    }
    if (tipo === 'novedad' && !comentario?.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'La novedad requiere un comentario' });
    }
    if ((tipo === 'formulario_en_linea' || tipo === 'formulario_en_campo') && !datos_formulario) {
      return res.status(400).json({ estado: 'error', mensaje: 'Este formulario requiere datos_formulario' });
    }

    const formularioId = req.params.formularioId;
    const seccionLimpia = seccion?.trim() || null;

    // Jerarquía: el interventor solo revisa lo que el coordinador ya aprobó
    // (visto bueno FINAL, seccion=NULL — el que cierra la revisión completa).
    if (rol === 'interventor') {
      const okCoordinador = await tieneVistoBueno(formularioId, 'coordinador');
      if (!okCoordinador) {
        return res.status(409).json({
          estado: 'error',
          mensaje: 'Este formulario aún no tiene el visto bueno del coordinador — no puede ser revisado por interventoría.',
        });
      }
    }

    // Evitar vistos buenos FINALES duplicados del mismo rol (seccion=NULL).
    // Las marcas por sección sí pueden repetirse/actualizarse (el revisor
    // puede corregir su evaluación de una sección mientras revisa).
    if (!seccionLimpia && tipo === 'visto_bueno' && (await tieneVistoBueno(formularioId, rol))) {
      return res.status(409).json({ estado: 'error', mensaje: `Este formulario ya tiene el visto bueno de ${rol}` });
    }

    const fila = await db.queryOne(
      `INSERT INTO revisiones_formulario (formulario_id, revisor_id, revisor_nombre, revisor_rol, tipo, seccion, comentario, datos_formulario_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        formularioId,
        revisorId,
        revisorNombre || req.user.usuario || revisorId,
        rol,
        tipo,
        seccionLimpia,
        comentario?.trim() || null,
        datos_formulario ? JSON.stringify(datos_formulario) : null,
      ]
    );

    console.log(`[Revisiones] ${tipo} de ${rol} (${req.user.usuario}) sobre formulario ${formularioId}${seccionLimpia ? ` [${seccionLimpia}]` : ''}`);

    // Notificar cuando se marca una novedad: al técnico dueño del
    // formulario siempre, y si quien revisa es interventoría, también al
    // coordinador (su aprobación previa quedó cuestionada).
    if (tipo === 'novedad') {
      try {
        const form = await db.queryOne('SELECT usuario_id FROM formularios WHERE id = $1', [formularioId]);
        const tituloSeccion = seccionLimpia ? ` — ${seccionLimpia}` : '';
        if (form?.usuario_id) {
          await crearNotificacion(
            form.usuario_id,
            'novedad_formulario',
            `Novedad en tu formulario${tituloSeccion}`,
            comentario?.trim() || 'Un revisor marcó una novedad en tu formulario.',
            formularioId
          );
        }
        if (rol === 'interventor') {
          const ultimoCoordinador = await db.queryOne(
            `SELECT revisor_id FROM revisiones_formulario
             WHERE formulario_id = $1 AND revisor_rol = 'coordinador' AND tipo = 'visto_bueno'
             ORDER BY created_at DESC LIMIT 1`,
            [formularioId]
          );
          if (ultimoCoordinador?.revisor_id) {
            await crearNotificacion(
              ultimoCoordinador.revisor_id,
              'novedad_formulario',
              `Interventoría marcó una novedad${tituloSeccion}`,
              comentario?.trim() || 'Interventoría encontró una novedad en un formulario que ya aprobaste.',
              formularioId
            );
          }
        }
      } catch (err) {
        console.error('[Revisiones] Error notificando novedad:', err.message);
      }
    }

    const mensajes = {
      visto_bueno: 'Visto bueno registrado',
      novedad: 'Novedad registrada',
      formulario_en_linea: 'Formulario en línea guardado',
      formulario_en_campo: 'Formulario en campo guardado',
    };
    res.status(201).json({ estado: 'ok', mensaje: mensajes[tipo], id: fila.id });
  } catch (error) {
    console.error('[Revisiones] Error registrando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la revisión' });
  }
});

// POST /api/revisiones/:formularioId/evidencia — Evidencia final del
// revisor: fotos y videos propios (ya subidos a MinIO, aquí solo se
// referencian por archivo_id), firma dual (beneficiario + revisor,
// también referenciada por archivo_id) y una georeferencia puntual
// (captura única). Un registro por formulario+rol.
router.post('/:formularioId/evidencia', authenticateToken, async (req, res) => {
  try {
    const { rol, id: revisorId, nombre: revisorNombre } = req.user;
    if (!ROLES_REVISORES.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo los roles superiores pueden revisar formularios' });
    }
    const formularioId = req.params.formularioId;
    const { fotos, videos, firma_beneficiario, firma_revisor, geo_latitud, geo_longitud, geo_altitud, observaciones } = req.body;

    const fila = await db.queryOne(
      `INSERT INTO revision_evidencia_formulario
         (formulario_id, revisor_id, revisor_nombre, revisor_rol, fotos_json, videos_json, firma_beneficiario, firma_revisor, geo_latitud, geo_longitud, geo_altitud, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (formulario_id, revisor_rol) DO UPDATE SET
         fotos_json = EXCLUDED.fotos_json,
         videos_json = EXCLUDED.videos_json,
         firma_beneficiario = EXCLUDED.firma_beneficiario,
         firma_revisor = EXCLUDED.firma_revisor,
         geo_latitud = EXCLUDED.geo_latitud,
         geo_longitud = EXCLUDED.geo_longitud,
         geo_altitud = EXCLUDED.geo_altitud,
         observaciones = EXCLUDED.observaciones,
         updated_at = NOW()
       RETURNING id`,
      [
        formularioId,
        revisorId,
        revisorNombre || req.user.usuario || revisorId,
        rol,
        JSON.stringify(fotos || []),
        JSON.stringify(videos || []),
        firma_beneficiario || null,
        firma_revisor || null,
        geo_latitud ?? null,
        geo_longitud ?? null,
        geo_altitud ?? null,
        observaciones?.trim() || null,
      ]
    );

    console.log(`[Revisiones] Evidencia final de ${rol} (${req.user.usuario}) sobre formulario ${formularioId}`);
    res.status(201).json({ estado: 'ok', mensaje: 'Evidencia registrada', id: fila.id });
  } catch (error) {
    console.error('[Revisiones] Error registrando evidencia:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la evidencia' });
  }
});

// GET /api/revisiones/:formularioId/evidencia — Evidencia(s) final(es) registradas
router.get('/:formularioId/evidencia', authenticateToken, async (req, res) => {
  try {
    const evidencias = await db.queryAll(
      `SELECT id, formulario_id, revisor_id, revisor_nombre, revisor_rol, fotos_json, videos_json, firma_beneficiario, firma_revisor, geo_latitud, geo_longitud, geo_altitud, observaciones, created_at
       FROM revision_evidencia_formulario
       WHERE formulario_id = $1
       ORDER BY created_at ASC`,
      [req.params.formularioId]
    );
    res.json({ estado: 'ok', evidencias });
  } catch (error) {
    console.error('[Revisiones] Error listando evidencia:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener evidencia' });
  }
});

module.exports = router;
module.exports.tieneVistoBueno = tieneVistoBueno;
