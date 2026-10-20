// Diagnóstico: mediciones con vértices fuera de Colombia.
// Uso: cd backend && set -a && . ./.env && set +a && node diag-coords-fuera.js
const db = require('./src/database');

const B = { minLat: -5, maxLat: 14, minLng: -82, maxLng: -66 };
const ok = (p) => p && p.latitud >= B.minLat && p.latitud <= B.maxLat && p.longitud >= B.minLng && p.longitud <= B.maxLng;

(async () => {
  const rows = await db.queryAll(
    "SELECT id, usuario_id, tipo_medicion, metadata_json, created_at FROM mediciones WHERE metadata_json IS NOT NULL ORDER BY created_at DESC"
  );
  const bad = [];
  for (const m of rows) {
    const pts = (m.metadata_json && m.metadata_json.puntos) || [];
    const fuera = pts.filter((p) => !ok(p));
    if (fuera.length) bad.push({ m, n: pts.length, fuera });
  }
  console.log('mediciones con vertices fuera de Colombia:', bad.length);
  for (const b of bad) {
    console.log(
      b.m.id,
      b.m.usuario_id,
      b.m.tipo_medicion,
      b.fuera.length + '/' + b.n,
      JSON.stringify(b.fuera[0]),
      b.m.created_at
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
