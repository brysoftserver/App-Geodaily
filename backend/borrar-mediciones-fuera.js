/**
 * Borra las mediciones cuyos vértices caen FUERA de Colombia.
 * - Hace respaldo JSON antes de borrar.
 * - Modo dry-run por defecto: `node borrar-mediciones-fuera.js`
 * - Para borrar de verdad: `node borrar-mediciones-fuera.js --apply`
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/database');

const COLOMBIA = { minLat: -4.3, maxLat: 13.5, minLng: -79.1, maxLng: -66.8 };
const CAQUETA = { minLat: -0.7, maxLat: 3.4, minLng: -76.4, maxLng: -71.0 };

const dentro = (b, lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

const APPLY = process.argv.includes('--apply');

(async () => {
  const rows = await db.queryAll(
    `SELECT * FROM mediciones ORDER BY created_at`
  );

  const aBorrar = [];
  for (const m of rows) {
    const pts = (m.metadata_json && m.metadata_json.puntos) || [];
    const todos = pts.length > 0
      ? pts.map((p) => ({ lat: Number(p.latitud), lng: Number(p.longitud) }))
      : [{ lat: Number(m.latitud), lng: Number(m.longitud) }];

    const validos = todos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validos.length === 0) continue; // sin coords: no se toca

    const algunoCol = validos.some((p) => dentro(COLOMBIA, p.lat, p.lng));
    const algunoCaq = validos.some((p) => dentro(CAQUETA, p.lat, p.lng));

    // Se borra si NINGÚN vértice está en Colombia, o si está en Colombia pero
    // fuera de Caquetá (el proyecto solo opera en Caquetá).
    if (!algunoCol || !algunoCaq) {
      aBorrar.push({ ...m, _motivo: !algunoCol ? 'fuera_de_colombia' : 'fuera_de_caqueta' });
    }
  }

  console.log(`Total mediciones: ${rows.length}`);
  console.log(`A borrar: ${aBorrar.length}`);
  for (const m of aBorrar) {
    console.log(`  ${m.id} | ${m.usuario_id} | ${m._motivo} | ${m.created_at.toISOString()}`);
  }

  if (aBorrar.length === 0) { console.log('Nada que borrar.'); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `mediciones_fuera_colombia_${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(aBorrar, null, 2));
  console.log(`\nRespaldo guardado en: ${backupFile}`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se borró nada. Ejecuta con --apply para borrar.');
    process.exit(0);
  }

  const ids = aBorrar.map((m) => m.id);
  const res = await db.query(`DELETE FROM mediciones WHERE id = ANY($1::text[])`, [ids]);
  console.log(`\n✅ Borradas ${res.rowCount} mediciones.`);

  const restantes = await db.queryOne(`SELECT COUNT(*)::int AS n FROM mediciones`);
  console.log(`Mediciones restantes: ${restantes.n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
