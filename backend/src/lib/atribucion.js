// ============================================================
// GEODAILY — Atribución de formularios (lógica pura, sin BD)
//
// REGLA DE ORO
// Un formulario pertenece al técnico que tiene asignado HOY el beneficiario.
// Tanto `formularios.usuario_id` como el snapshot `tecnico_json.usuario_id`
// son copias estáticas tomadas por el dispositivo cuando guardó la visita,
// así que se quedan viejas en cuanto alguien reasigna el beneficiario desde
// el panel (PUT /api/beneficiarios/:item/asignacion).
//
// Cuando la copia vieja llega tarde (el teléfono del técnico anterior estuvo
// semanas sin señal, o el formulario se sube por primera vez DESPUÉS de la
// reasignación y nace con el snapshot viejo), el formulario queda a nombre de
// quien ya no responde por la visita:
//   - al técnico nuevo no le aparece la visita,
//   - y si la abre desde una notificación, el backend le responde
//     403 «Solo puedes completar tus propios formularios» al corregirla.
// Ese es el error que reportaron los técnicos reasignados.
//
// Este módulo concentra las dos decisiones de atribución para que se puedan
// probar sin base de datos (ver __tests__/atribucion.test.js).
// ============================================================

/**
 * Técnico vigente de un beneficiario a partir de sus filas en `beneficiarios`.
 *
 * La cédula es la llave que une formularios y beneficiarios, y está
 * duplicada en algunos casos (la misma persona registrada dos veces, con
 * técnicos distintos). Con dos técnicos posibles el dato es ambiguo y
 * devolver uno "al azar" reasignaría formularios a la fuerza, así que se
 * devuelve null y quien llama mantiene el comportamiento previo.
 *
 * @param {Array<{tecnico_asignado_id?: string|null}>} filas
 * @returns {string|null} id del técnico, o null si no hay uno solo
 */
const resolverTecnicoVigente = (filas) => {
  const ids = new Set(
    (filas || []).map((f) => (f ? f.tecnico_asignado_id : null)).filter(Boolean)
  );
  return ids.size === 1 ? Array.from(ids)[0] : null;
};

/**
 * Reescribe el `usuario_id` dentro de un snapshot `tecnico_json` conservando
 * el resto de los datos del dispositivo (nombre, cédula, teléfono, email).
 *
 * @param {string|object|null} snapshot
 * @param {string} usuarioId
 * @returns {string} JSON listo para usarse como bind de una columna jsonb
 */
const snapshotConDueno = (snapshot, usuarioId) => {
  let base = {};
  if (snapshot && typeof snapshot === 'object') {
    base = snapshot;
  } else if (typeof snapshot === 'string' && snapshot.trim()) {
    try {
      const parsed = JSON.parse(snapshot);
      if (parsed && typeof parsed === 'object') base = parsed;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, usuario_id: usuarioId });
};

/**
 * Decide con qué dueño se guarda un formulario que llega de un dispositivo.
 *
 * Prioridad:
 *   1. El técnico asignado hoy al beneficiario (dato vivo, manda sobre
 *      cualquier snapshot del dispositivo).
 *   2. Si el beneficiario no se puede resolver (sin cédula, cédula ambigua
 *      con dos técnicos), la atribución que ya tenga la fila en el servidor —
 *      nunca se pisa con la copia de un dispositivo, para no deshacer una
 *      reasignación.
 *   3. El responsable que nombra el propio dispositivo: es el caso de un
 *      supervisor/interventor que levanta la visita "a nombre de" un técnico,
 *      y también el de la primera subida de una visita propia. Antes esta
 *      rama guardaba al que sube (la sesión), así que un segundo supervisor
 *      sincronizando el mismo formulario se quedaba con la visita.
 *   4. Si el dispositivo tampoco nombra a nadie, quien sube.
 *
 * `usarSnapshotDelPayload` indica si el snapshot que trae el dispositivo ya
 * nombra al dueño correcto (se conserva tal cual, con sus datos más
 * completos); si no, quien llama debe reconstruirlo con `usuarioId`.
 *
 * @returns {{usuarioId: string, usarSnapshotDelPayload: boolean}}
 */
const resolverAtribucionFormulario = ({
  tecnicoVigente = null,
  tecnicoDelSnapshot = null,
  usuarioSolicitante,
  usuarioExistente = null,
}) => {
  const usuarioId =
    tecnicoVigente || usuarioExistente || tecnicoDelSnapshot || usuarioSolicitante;

  return {
    usuarioId,
    usarSnapshotDelPayload: !!tecnicoDelSnapshot && tecnicoDelSnapshot === usuarioId,
  };
};

/**
 * ¿Puede este técnico completar/corregir la respuesta de un formulario que no
 * está a su nombre?
 *
 * Sí, cuando el formulario quedó con la atribución vieja pero el beneficiario
 * está asignado HOY a él y esa asignación es inequívoca.
 *
 * @returns {boolean}
 */
const esTecnicoVigenteDelFormulario = ({
  usuarioSolicitante,
  duenoDelFormulario,
  tecnicoVigente = null,
}) =>
  !!usuarioSolicitante &&
  duenoDelFormulario !== usuarioSolicitante &&
  !!tecnicoVigente &&
  tecnicoVigente === usuarioSolicitante;

module.exports = {
  resolverTecnicoVigente,
  snapshotConDueno,
  resolverAtribucionFormulario,
  esTecnicoVigenteDelFormulario,
};
