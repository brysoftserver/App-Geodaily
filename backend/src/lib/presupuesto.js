// ============================================================
// GEODAILY — Presupuesto de tiempo para datos externos (best-effort)
// ============================================================
// Regla de oro: un dato EXTERNO y DECORATIVO (clima desde Open-Meteo,
// nombre del lugar desde Nominatim) NUNCA puede retrasar ni impedir el
// guardado de algo que el técnico ya capturó (una foto, una evidencia).
//
// Problema real reportado: al tomar una foto, la marca de agua esperaba a
// que respondieran Nominatim y Open-Meteo ANTES de subir la imagen. Con
// internet lento (o caído) esa espera se alargaba hasta ~13 s por foto y
// la subida terminaba expirando en el celular — la foto nunca quedaba
// registrada en el servidor ("se demora mucho o nunca se guarda la foto").
//
// Solución de menor impacto: darle a esos datos un PRESUPUESTO de tiempo.
// Si llegan dentro del presupuesto, se usan como siempre; si no, se
// ignoran y el trabajo sigue con lo que sí es imprescindible (fecha + GPS).
//
// El módulo es puro (sin dependencias) para poder probarlo aislado.

/**
 * Espera `promesa` como máximo `ms` milisegundos.
 *
 * - Si la promesa se resuelve antes del límite → devuelve su valor.
 * - Si rechaza → devuelve `respaldo` (nunca propaga el error).
 * - Si no termina a tiempo → devuelve `respaldo` sin esperar más.
 *
 * La promesa original NO se cancela (cada `fetch` ya tiene su propio
 * AbortController); simplemente se deja de esperar. Cualquier rechazo
 * posterior se consume aquí para no generar un unhandled rejection.
 *
 * @template T
 * @param {Promise<T>|T} promesa
 * @param {number} ms
 * @param {T|null} [respaldo=null]
 * @returns {Promise<T|null>}
 */
function conPresupuesto(promesa, ms, respaldo = null) {
  return new Promise((resolve) => {
    let resuelto = false;
    const terminar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      resolve(valor);
    };

    const limite = Math.max(0, Number(ms) || 0);
    const temporizador = setTimeout(() => terminar(respaldo), limite);

    Promise.resolve(promesa).then(
      (valor) => {
        clearTimeout(temporizador);
        terminar(valor);
      },
      () => {
        clearTimeout(temporizador);
        terminar(respaldo);
      }
    );
  });
}

module.exports = { conPresupuesto };
