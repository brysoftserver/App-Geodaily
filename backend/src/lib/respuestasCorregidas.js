// ============================================================
// GEODAILY — Proteger respuestas completadas/corregidas en el servidor
// ============================================================
// Problema (nov-2026, auditoría caso Jonathan Molano): «✎ Completar» y
// «Corregir» (PATCH /api/formularios/:id/respuesta) escriben en el
// servidor, pero la copia local del teléfono seguía con el valor viejo.
// Si después el teléfono re-sincronizaba esa copia (POST /guardar), el
// UPDATE escribía caracterizacion_nueva_json COMPLETO con la copia vieja y
// la respuesta completada desaparecía sin dejar rastro.
//
// Regla: una respuesta completada/corregida en el servidor DESPUÉS de la
// última modificación de la copia que llega (su updated_at) se conserva.
// Si la copia es más nueva que la corrección, gana la copia (el técnico
// editó después, a propósito). Todo lo demás de la copia se guarda igual.
// ============================================================

const ACCIONES_RESPUESTA = ['completar_respuesta', 'corregir_respuesta'];

// ── Ítems Sí/No del acompañamiento técnico (preguntas 1, 4, 5 y 6) ──────
// La respuesta visible son dos booleanos `<item>_si` / `<item>_no`; la
// observación `<item>_obs` es aparte. La app los edita con la ruta VIRTUAL
// `acompaniamiento.<item>` y valor «Sí»/«No». Antes la app mandaba la
// observación en su lugar y el PATCH respondía 409 «ya está completa» /
// «está vacía» (caso Segundo Alfonso y Edinson Salinas, nov-2026).
const ITEMS_ACOMPANAMIENTO_SINO = ['actividades_realizadas', 'capacitacion', 'seguimiento', 'entresacado'];
const RUTAS_SINO = ITEMS_ACOMPANAMIENTO_SINO.map((i) => `acompaniamiento.${i}`);

const esRutaSiNo = (path) => RUTAS_SINO.includes(path);

/** 'Sí' | 'No' | '' según las casillas guardadas. */
function leerSiNo(encuesta, path) {
  const [seccion, item] = path.split('.');
  const bloque = (encuesta && encuesta[seccion]) || {};
  if (bloque[`${item}_si`] === true) return 'Sí';
  if (bloque[`${item}_no`] === true) return 'No';
  return '';
}

/** true (Sí) | false (No) | null (valor no válido). Acepta Sí/Si/No sin importar mayúsculas. */
function normalizarSiNo(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'sí' || v === 'si') return true;
  if (v === 'no') return false;
  return null;
}

/** Escribe la respuesta Sí/No en las dos casillas (sin mutar la encuesta). */
function escribirSiNo(encuesta, path, esSi) {
  const [seccion, item] = path.split('.');
  const bloque = encuesta[seccion] && typeof encuesta[seccion] === 'object' ? encuesta[seccion] : {};
  return { ...encuesta, [seccion]: { ...bloque, [`${item}_si`]: esSi, [`${item}_no`]: !esSi } };
}

const t = (fecha) => {
  const v = new Date(fecha).getTime();
  return Number.isFinite(v) ? v : 0;
};

const leer = (obj, partes) => {
  let cur = obj;
  for (const p of partes) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
};

const vacio = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * @param {object|null} entrante   caracterizacion_nueva que manda el teléfono
 * @param {object|null} servidor   caracterizacion_nueva_json actual en BD
 * @param {Array<{accion, path, created_at}>} correcciones  de actividad_log
 * @param {string|Date|null} updatedAtEntrante  updated_at de la copia
 * @returns {{ caracterizacion: object|null, conservados: string[] }}
 *   No muta los objetos recibidos.
 */
function conservarRespuestasCorregidas(entrante, servidor, correcciones, updatedAtEntrante) {
  if (!entrante || typeof entrante !== 'object' || !servidor || typeof servidor !== 'object') {
    return { caracterizacion: entrante, conservados: [] };
  }
  const tCopia = t(updatedAtEntrante);

  // Última corrección por ruta.
  const ultimaPorRuta = new Map();
  for (const c of correcciones || []) {
    if (!ACCIONES_RESPUESTA.includes(c.accion) || typeof c.path !== 'string' || !c.path) continue;
    ultimaPorRuta.set(c.path, Math.max(ultimaPorRuta.get(c.path) || 0, t(c.created_at)));
  }

  let resultado = entrante;
  const conservados = [];
  for (const [path, tCorreccion] of ultimaPorRuta) {
    // Copia sin fecha: no se sabe si es vieja, se protege lo corregido.
    if (tCopia && tCopia >= tCorreccion) continue;
    if (esRutaSiNo(path)) {
      const enServidor = leerSiNo(servidor, path);
      if (!enServidor || leerSiNo(resultado, path) === enServidor) continue;
      if (resultado === entrante) resultado = { ...entrante };
      resultado = escribirSiNo(resultado, path, enServidor === 'Sí');
      conservados.push(path);
      continue;
    }
    const partes = path.split('.');
    if (partes.length < 1 || partes.length > 2) continue;
    const valorServidor = leer(servidor, partes);
    if (vacio(valorServidor)) continue;
    if (leer(resultado, partes) === valorServidor) continue;

    if (resultado === entrante) resultado = { ...entrante };
    if (partes.length === 1) {
      resultado[partes[0]] = valorServidor;
    } else {
      const [seccion, campo] = partes;
      const actual = resultado[seccion] && typeof resultado[seccion] === 'object' ? resultado[seccion] : {};
      resultado[seccion] = { ...actual, [campo]: valorServidor };
    }
    conservados.push(path);
  }
  return { caracterizacion: resultado, conservados };
}

module.exports = {
  conservarRespuestasCorregidas,
  ACCIONES_RESPUESTA,
  RUTAS_SINO,
  esRutaSiNo,
  leerSiNo,
  normalizarSiNo,
  escribirSiNo,
};
