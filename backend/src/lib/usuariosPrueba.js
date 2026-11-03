// ============================================================
// Usuarios de prueba: se ocultan de los consolidados de actividades
// (tortas, listas de técnicos y totales) para no mezclar datos de ensayo
// con los reales. Siguen pudiendo entrar y trabajar con normalidad.
// ============================================================

const USUARIOS_DE_PRUEBA = ['tecnico.prueba'];

/** Condición SQL: la columna NO es un usuario de prueba. Los valores son constantes de este archivo. */
const sqlNoEsPrueba = (columna) =>
  `${columna} NOT IN (${USUARIOS_DE_PRUEBA.map((u) => `'${u.replace(/'/g, "''")}'`).join(', ')})`;

module.exports = { USUARIOS_DE_PRUEBA, sqlNoEsPrueba };
