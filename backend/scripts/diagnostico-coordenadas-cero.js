// ============================================================
// DIAGNÓSTICO (SOLO LECTURA) — Formularios de Encuesta Social con
// coordenadas_json en {0,0} por el bug del placeholder de apertura
// ============================================================
// Antes del fix, si el GPS automático al abrir el formulario no lograba
// señal, se guardaba coordenadas_json = {latitud:0, longitud:0} en vez de
// dejarlo vacío. Este script busca esos casos y verifica si la pregunta 20
// (caracterizacion_finca.latitud/longitud, dentro de caracterizacion_nueva_json)
// tiene un valor real con el que se podría rellenar — sin tocar nada todavía.
//
// Uso: node scripts/diagnostico-coordenadas-cero.js
// ============================================================

require('dotenv').config();
const db = require('../src/database');

async function main() {
  const rows = await db.queryAll(
    `SELECT
        f.id,
        f.tipo,
        f.created_at,
        f.coordenadas_json,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'latitud' AS q20_lat,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'longitud' AS q20_lon,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'altitud' AS q20_alt,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'precision_gps' AS q20_precision
      FROM formularios f
      WHERE f.tipo = 'caracterizacion'
        AND f.caracterizacion_nueva_json IS NOT NULL
      ORDER BY f.created_at`
  );

  console.log(`\nTotal formularios de Encuesta Social revisados: ${rows.length}\n`);

  const enCero = [];
  const sinCoordenadas = [];
  const conDatoBueno = [];

  for (const row of rows) {
    const c = row.coordenadas_json;
    const lat = c?.latitud;
    const lon = c?.longitud;
    const esCero = c && Number(lat) === 0 && Number(lon) === 0;
    const faltante = !c || lat == null || lon == null;

    if (esCero || faltante) {
      const tieneQ20 = row.q20_lat && row.q20_lon && Number(row.q20_lat) !== 0 && Number(row.q20_lon) !== 0;
      (esCero ? enCero : sinCoordenadas).push({ ...row, tieneQ20 });
    } else {
      conDatoBueno.push(row);
    }
  }

  console.log(`✅ Con coordenadas válidas ya: ${conDatoBueno.length}`);
  console.log(`⚠️  Con placeholder {0,0} exacto: ${enCero.length}`);
  console.log(`❓ Sin coordenadas_json en absoluto (null/vacío): ${sinCoordenadas.length}\n`);

  const fixable = [...enCero, ...sinCoordenadas].filter((r) => r.tieneQ20);
  const noFixable = [...enCero, ...sinCoordenadas].filter((r) => !r.tieneQ20);

  console.log(`--- RECUPERABLES con la pregunta 20 (candidatos a corregir): ${fixable.length} ---`);
  for (const r of fixable) {
    console.log(`  ${r.id} | ${r.created_at?.toISOString?.() || r.created_at} | Q20 -> lat=${r.q20_lat} lon=${r.q20_lon}`);
  }

  console.log(`\n--- NO RECUPERABLES (la pregunta 20 tampoco tiene coordenada real): ${noFixable.length} ---`);
  for (const r of noFixable) {
    console.log(`  ${r.id} | ${r.created_at?.toISOString?.() || r.created_at} | requiere revisión manual`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error en diagnóstico:', err);
  process.exit(1);
});
