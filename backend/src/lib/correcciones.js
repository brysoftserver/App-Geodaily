// ============================================================
// GEODAILY — Correcciones del técnico sobre novedades pendientes
// ============================================================
// Problema que resuelve: cuando un revisor (coordinador/interventor)
// marcaba una novedad, el técnico la corregía (PATCH /respuesta o
// borrando evidencias), pero el revisor NO se enteraba: la novedad
// seguía "pendiente" hasta que él volviera a abrir el formulario por su
// cuenta. Caso real (nov-2026): 30 formularios de 5 técnicos corregidos
// y sin re-revisar desde septiembre.
//
// Ahora una novedad pendiente pasa a "corregida — por verificar" cuando
// existe una corrección EXPLÍCITA posterior a ella sobre el mismo
// formulario. El cierre formal sigue siendo el visto bueno del revisor:
// esto no resuelve la novedad, solo avisa que hay algo para verificar.
//
// Fuente: actividad_log (ya existente, con histórico desde septiembre),
// así que los formularios corregidos antes de este cambio quedan
// marcados sin migrar datos.
//
// Solo cuentan acciones explícitas de corrección. NO cuentan
// 'actualizar_formulario' (lo dispara cada re-sincronización automática
// del teléfono) ni subir_foto/subir_video (su log no registra a qué
// formulario pertenecen).
// ============================================================

const { calcularEstadoRevision } = require('./estadoRevision');

// 'marcar_novedad_corregida': el técnico avisa explícitamente que ya corrigió
// algo que no queda registrado como respuesta (ej. ajustar el polígono en el
// mapa o agregar fotos). Ver routes/novedadesCorregidas.js.
const ACCIONES_CORRECCION = ['corregir_respuesta', 'completar_respuesta', 'eliminar_evidencia', 'marcar_novedad_corregida'];

/** Roles cuyas acciones cuentan como corrección (el revisor no se corrige a sí mismo). */
const ROLES_CORRECTORES = ['tecnico', 'admin'];

/**
 * Lista SQL de acciones/roles lista para incrustar: son constantes del
 * propio módulo (nunca entrada del usuario), así que no hay inyección.
 */
const sqlLista = (valores) => valores.map((v) => `'${v}'`).join(', ');

/**
 * CTE reutilizable: última corrección por formulario.
 * Uso: `WITH ${CTE_CORRECCIONES} SELECT ... JOIN correcciones c ON c.formulario_id = ...`
 */
const CTE_CORRECCIONES = `correcciones AS (
  SELECT l.detalle_json->>'formulario_id' AS formulario_id,
         MAX(l.created_at) AS ultima_correccion
    FROM actividad_log l
    JOIN usuarios u ON u.id = l.usuario_id
   WHERE l.accion IN (${sqlLista(ACCIONES_CORRECCION)})
     AND u.rol IN (${sqlLista(ROLES_CORRECTORES)})
     AND l.detalle_json->>'formulario_id' IS NOT NULL
   GROUP BY 1
)`;

/** Índice para que el CTE no recorra todo actividad_log (database.js lo crea). */
// _v2: el índice parcial anterior no cubría 'marcar_novedad_corregida'.
const SQL_INDICE_CORRECCIONES =
  `CREATE INDEX IF NOT EXISTS idx_actividad_correcciones_v2
     ON actividad_log ((detalle_json->>'formulario_id'), created_at)
     WHERE accion IN (${sqlLista(ACCIONES_CORRECCION)})`;

/**
 * ¿La novedad tiene una corrección posterior? Recibe la fecha de la
 * novedad y la lista de correcciones ({ created_at }) del formulario.
 * Mismo criterio que el SQL de /resumen y que src/utils/revisiones.ts.
 */
function novedadEstaCorregida(novedadCreatedAt, correcciones) {
  const tNovedad = new Date(novedadCreatedAt).getTime();
  if (!Number.isFinite(tNovedad)) return false;
  return (correcciones || []).some((c) => new Date(c.created_at).getTime() > tNovedad);
}

/** Correcciones de un formulario (más antiguas primero), para el detalle. */
async function listarCorrecciones(db, formularioId) {
  return db.queryAll(
    `SELECT l.id, l.accion, l.usuario_id, u.nombre AS usuario_nombre,
            l.detalle_json->>'path' AS path, l.detalle_json->>'comentario' AS comentario, l.created_at
       FROM actividad_log l
       JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.accion IN (${sqlLista(ACCIONES_CORRECCION)})
        AND u.rol IN (${sqlLista(ROLES_CORRECTORES)})
        AND l.detalle_json->>'formulario_id' = $1
      ORDER BY l.created_at ASC`,
    [formularioId]
  );
}

/**
 * Revisores con novedades ABIERTAS en el formulario, según la regla única
 * de lib/estadoRevision.js: son a quienes hay que avisar cuando el técnico
 * corrige.
 */
async function revisoresConNovedadesPendientes(db, formularioId) {
  const revisiones = await db.queryAll(
    `SELECT id, revisor_id, revisor_rol, tipo, seccion, created_at
       FROM revisiones_formulario
      WHERE formulario_id = $1 AND tipo IN ('novedad', 'visto_bueno')`,
    [formularioId]
  );
  const { _porRol } = calcularEstadoRevision(revisiones);
  const ids = new Set();
  for (const rol of Object.keys(_porRol)) {
    for (const n of _porRol[rol].abiertas) if (n.revisor_id) ids.add(n.revisor_id);
  }
  return [...ids].map((revisor_id) => ({ revisor_id }));
}

/**
 * Avisa a los revisores con novedades pendientes que el técnico corrigió.
 * Anti-spam: si el revisor ya tiene un aviso SIN LEER de este formulario
 * no se crea otro (Deily hizo 5 correcciones en 2 minutos sobre un mismo
 * formulario: el coordinador debe recibir un aviso, no cinco).
 * Nunca lanza: un fallo aquí no debe tumbar la corrección del técnico.
 */
async function notificarCorreccion(db, crearNotificacion, { formularioId, autor }) {
  try {
    const revisores = await revisoresConNovedadesPendientes(db, formularioId);
    if (revisores.length === 0) return 0;

    const form = await db.queryOne(
      `SELECT beneficiario_json->>'nombre' AS beneficiario FROM formularios WHERE id = $1`,
      [formularioId]
    );
    const quien = autor?.nombre || autor?.usuario || 'El técnico';
    const deQuien = form?.beneficiario ? ` de ${form.beneficiario}` : '';

    let enviados = 0;
    for (const { revisor_id: revisorId } of revisores) {
      if (revisorId === autor?.id) continue;
      const yaAvisado = await db.queryOne(
        `SELECT id FROM notificaciones
          WHERE usuario_id = $1 AND formulario_id = $2
            AND tipo = 'correccion_formulario' AND leida = FALSE
          LIMIT 1`,
        [revisorId, formularioId]
      );
      if (yaAvisado) continue;
      await crearNotificacion(
        revisorId,
        'correccion_formulario',
        `Corrección por verificar${deQuien}`,
        `${quien} corrigió el formulario${deQuien} después de tus novedades. Ábrelo para verificar y dar el visto bueno.`,
        formularioId
      );
      enviados++;
    }
    return enviados;
  } catch (error) {
    console.error('[Correcciones] Error notificando corrección:', error.message);
    return 0;
  }
}

module.exports = {
  ACCIONES_CORRECCION,
  ROLES_CORRECTORES,
  CTE_CORRECCIONES,
  SQL_INDICE_CORRECCIONES,
  novedadEstaCorregida,
  listarCorrecciones,
  revisoresConNovedadesPendientes,
  notificarCorreccion,
};
