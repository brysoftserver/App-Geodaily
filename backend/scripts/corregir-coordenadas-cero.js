// ============================================================
// CORRECCIÓN — Backfill de coordenadas_json para formularios con el
// placeholder {0,0} del bug de captura al abrir el formulario
// ============================================================
// Mismo criterio que diagnostico-coordenadas-cero.js: formularios tipo
// 'caracterizacion' cuyo coordenadas_json es exactamente {latitud:0,
// longitud:0} (o está vacío), y que SÍ tienen una coordenada real en la
// pregunta 20 (caracterizacion_nueva_json.caracterizacion_finca.latitud/
// longitud) con la que rellenar.
//
// Solo actualiza la columna coordenadas_json, y solo de esos formularios
// puntuales — no toca nada más (ni otras columnas, ni otros formularios,
// ni archivos en MinIO). Preserva el campo "lugar" si ya existía.
//
// Por defecto corre en modo VISTA PREVIA (no escribe nada). Para aplicar
// los cambios de verdad:
//   node scripts/corregir-coordenadas-cero.js --apply
// ============================================================

require('dotenv').config();
const db = require('../src/database');

async function main() {
  const aplicar = process.argv.includes('--apply');

  const rows = await db.queryAll(
    `SELECT
        f.id,
        f.coordenadas_json,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'latitud' AS q20_lat,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'longitud' AS q20_lon,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'altitud' AS q20_alt,
        f.caracterizacion_nueva_json->'caracterizacion_finca'->>'precision_gps' AS q20_precision
      FROM formularios f
      WHERE f.tipo = 'caracterizacion'
        AND f.caracterizacion_nueva_json IS NOT NULL`
  );

  const candidatos = rows.filter((row) => {
    const c = row.coordenadas_json;
    const lat = c?.latitud;
    const lon = c?.longitud;
    const esCero = c && Number(lat) === 0 && Number(lon) === 0;
    const faltante = !c || lat == null || lon == null;
    const tieneQ20 = row.q20_lat && row.q20_lon && Number(row.q20_lat) !== 0 && Number(row.q20_lon) !== 0;
    return (esCero || faltante) && tieneQ20;
  });

  console.log(`${aplicar ? 'APLICANDO' : 'VISTA PREVIA (sin escribir — usa --apply para aplicar)'}`);
  console.log(`Formularios candidatos a corregir: ${candidatos.length}\n`);

  let corregidos = 0;
  for (const row of candidatos) {
    const nuevoCoordenadas = {
      ...(row.coordenadas_json || {}), // preserva "lugar" u otro campo que ya existiera
      latitud: Number(row.q20_lat),
      longitud: Number(row.q20_lon),
      ...(row.q20_alt ? { altitud: Number(row.q20_alt) } : {}),
      ...(row.q20_precision ? { precision_gps: Number(row.q20_precision) } : {}),
    };

    console.log(`${row.id}`);
    console.log(`   antes:   ${JSON.stringify(row.coordenadas_json)}`);
    console.log(`   después: ${JSON.stringify(nuevoCoordenadas)}`);

    if (aplicar) {
      // WHERE doble-verifica el estado actual antes de escribir, por si
      // algo cambió entre la lectura y este punto (evita pisar un dato
      // distinto al que se revisó).
      const resultado = await db.query(
        `UPDATE formularios
           SET coordenadas_json = $1::jsonb
         WHERE id = $2
           AND (coordenadas_json IS NULL OR coordenadas_json = $3::jsonb)`,
        [JSON.stringify(nuevoCoordenadas), row.id, JSON.stringify(row.coordenadas_json)]
      );
      if (resultado.rowCount === 1) {
        corregidos++;
        console.log('   ✅ actualizado');
      } else {
        console.log('   ⚠️  no se actualizó (el dato cambió desde el diagnóstico — revisar manualmente)');
      }
    }
    console.log('');
  }

  if (aplicar) {
    console.log(`\nTotal corregidos: ${corregidos} de ${candidatos.length}`);
  } else {
    console.log('\nNada se escribió todavía. Corre con --apply para aplicar estos cambios.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error en corrección:', err);
  process.exit(1);
});
