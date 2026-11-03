// ============================================================
// GEODAILY — Regla que cruza un formulario con su visita planificada
//
// Una visita planificada se identifica por (cédula, número de visita):
//   - caracterización → visita 1 (siempre; el cliente no manda número)
//   - visita técnica  → `actividad.visita_numero`
//   - otros tipos     → `actividad.visita_numero` si viene válido
// Debe coincidir con `numeroVisitaDe` de src/utils/llaveVisita.ts.
// ============================================================

const MAX_VISITA = 12;

/** Cédula comparable: solo letras y dígitos, en mayúsculas ("1.234 567" → "1234567"). */
function normalizarCedula(cedula) {
  return String(cedula ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

/** Número de visita (1..12) que representa un formulario, o null si no aplica. */
function numeroVisitaFormulario(tipo, visitaNumero) {
  if (tipo === 'caracterizacion') return 1;
  const n = Number(visitaNumero);
  return Number.isInteger(n) && n >= 1 && n <= MAX_VISITA ? n : null;
}

/** Misma normalización de `normalizarCedula`, pero como expresión SQL. */
const sqlCedulaNormalizada = (columna) =>
  `regexp_replace(upper(COALESCE(${columna}, '')), '[^0-9A-Z]', '', 'g')`;

/**
 * Condición SQL (sobre la tabla `formularios`) de "este formulario representa
 * la visita N de esa cédula". Usa $c = cédula normalizada, $n = número
 * (entero) y $t = número como texto.
 */
const sqlFormularioEsVisita = (c, n, t) =>
  `${sqlCedulaNormalizada("beneficiario_json->>'cedula'")} = ${c}
   AND (
     (tipo = 'caracterizacion' AND ${n}::int = 1)
     OR (tipo <> 'caracterizacion' AND actividad_json->>'visita_numero' = ${t}::text)
   )`;

/**
 * CTE `v`: el formulario de caracterización (Visita 1) más reciente de cada
 * cédula. Se normaliza la cédula UNA vez por formulario; unirlo con un LATERAL
 * por beneficiario era ~200× más lento.
 */
const sqlCteCaracterizacion = () => `
  WITH v AS (
    SELECT DISTINCT ON (ced) id, ced FROM (
      SELECT f.id, f.created_at, ${sqlCedulaNormalizada("f.beneficiario_json->>'cedula'")} AS ced
      FROM formularios f
      WHERE f.tipo = 'caracterizacion'
    ) x
    WHERE ced <> ''
    ORDER BY ced, created_at DESC
  )`;

module.exports = {
  sqlCteCaracterizacion,
  MAX_VISITA,
  normalizarCedula,
  numeroVisitaFormulario,
  sqlCedulaNormalizada,
  sqlFormularioEsVisita,
};
