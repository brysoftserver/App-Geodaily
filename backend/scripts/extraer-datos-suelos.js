// ============================================================
// GEODAILY — Lee (sin IA) los datos de los PDF de Análisis de Suelos ya
// subidos y los guarda en analisis_suelos.datos. Los PDF nuevos se leen
// solos al subirse; este script es para los anteriores o para releer todo
// si cambia el lector (lib/suelosPdf.js).
//
// Uso: node scripts/extraer-datos-suelos.js [--todos]
// ============================================================
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = require('../src/database');
const storage = require('../src/storage');
const { extraerDatosSuelos } = require('../src/lib/suelosPdf');

(async () => {
  const todos = process.argv.includes('--todos');
  const filas = await db.queryAll(
    `SELECT beneficiario_item, storage_key FROM analisis_suelos ${todos ? '' : 'WHERE datos IS NULL'} ORDER BY beneficiario_item`
  );
  const formatos = {};
  for (const f of filas) {
    const stream = await storage.getFileStream(f.storage_key);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const datos = await extraerDatosSuelos(Buffer.concat(chunks));
    formatos[datos.formato] = (formatos[datos.formato] || 0) + 1;
    if (datos.formato !== 'resumen') console.log(`  item ${f.beneficiario_item}: formato ${datos.formato}`);
    await db.query('UPDATE analisis_suelos SET datos = $1 WHERE beneficiario_item = $2', [JSON.stringify(datos), f.beneficiario_item]);
  }
  console.log(`Leídos ${filas.length} PDF:`, formatos);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
