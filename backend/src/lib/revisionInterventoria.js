// ============================================================
// "Revisado por interventoría" — el OK sobre un registro de una actividad
// ============================================================
// Una fila en revision_interventoria = revisado; sin fila = pendiente.
// `referencia` identifica el registro dentro de la actividad (y su
// subactividad, cuando la hay):
//   analisis_suelos              → item del beneficiario
//   preparacion_terreno          → item del beneficiario
//   asistencia_tecnica           → id del formulario (visita)
//   fortalecimiento_capacidades  → "ecas:{eca}:{grupo}:{seccion}"
//   siembra_platano              → "{subactividad}:{id del registro}"
// Si el registro se elimina (o se reemplaza el PDF de suelos), la fila se
// borra y vuelve a quedar pendiente hasta que la interventoría lo revise.
// Solo admin e interventor marcan / quitan el OK.
// ============================================================

const db = require('../database');

const ROLES_REVISAN = ['admin', 'interventor'];

const ACTIVIDADES = new Set([
  'analisis_suelos',
  'preparacion_terreno',
  'siembra_cacao',
  'siembra_platano',
  'siembra_forestales',
  'biofactorias',
  'fortalecimiento_capacidades',
  'fertilizacion',
  'control_sanitario',
  'asistencia_tecnica',
]);

const puedeRevisar = (user) => ROLES_REVISAN.includes(user?.rol);

const referenciaValida = (r) => /^[A-Za-z0-9_:.-]{1,150}$/.test(String(r ?? ''));

/** Quita el OK de un registro (no falla si no lo tenía). `ejecutor`: db o un client de transacción. */
async function quitarRevision(actividad, referencia, ejecutor = db) {
  try {
    await ejecutor.query('DELETE FROM revision_interventoria WHERE actividad = $1 AND referencia = $2', [
      actividad,
      String(referencia),
    ]);
  } catch (err) {
    // Nunca bloquea el borrado del registro.
    console.warn('[RevisionInterventoria] No se pudo quitar', actividad, referencia, err.message);
  }
}

module.exports = { ACTIVIDADES, ROLES_REVISAN, puedeRevisar, referenciaValida, quitarRevision };
