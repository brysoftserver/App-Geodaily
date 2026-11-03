/**
 * Respaldo completo de la tabla `mediciones` en backend/backups/ (JSON).
 * Solo LEE la base: no modifica nada. Úsalo antes de borrar mediciones.
 *
 * Uso: node scripts/respaldar-mediciones.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/database');

(async () => {
  const { rows } = await query('SELECT * FROM mediciones ORDER BY created_at');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(__dirname, '..', 'backups', `mediciones_respaldo_${stamp}.json`);
  fs.writeFileSync(destino, JSON.stringify({ generado: new Date().toISOString(), total: rows.length, mediciones: rows }, null, 2));

  // Verificación: se vuelve a leer el archivo y se compara el conteo.
  const leido = JSON.parse(fs.readFileSync(destino, 'utf8'));
  if (leido.mediciones.length !== rows.length) throw new Error('El respaldo no coincide con la base');
  console.log(`Respaldo OK: ${rows.length} mediciones → ${destino}`);
  await pool.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
