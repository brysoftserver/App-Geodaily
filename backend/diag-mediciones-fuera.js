/**
 * Diagnóstico: mediciones cuyos vértices caen fuera de Colombia / Caquetá.
 * NO borra nada. Solo reporta.
 */
require('dotenv').config();
const db = require('./src/database');

// Bounding boxes aproximadas
const COLOMBIA = { minLat: -4.3, maxLat: 13.5, minLng: -79.1, maxLng: -66.8 };
const CAQUETA = { minLat: -0.7, maxLat: 3.4, minLng: -76.4, maxLng: -71.0 };

const dentro = (b, lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

(async () => {
  const rows = await db.queryAll(
    `SELECT id, usuario_id, formulario_id, tipo_medicion, valor, unidad,
            latitud, longitud, metadata_json, timestamp, created_at
       FROM mediciones ORDER BY created_at`
  );

  const fueraColombia = [];
  const fueraCaqueta = [];
  const sinPuntos = [];

  for (const m of rows) {
    const pts = (m.metadata_json && m.metadata_json.puntos) || [];
    const todos = pts.length > 0
      ? pts.map((p) => ({ lat: Number(p.latitud), lng: Number(p.longitud) }))
      : [{ lat: Number(m.latitud), lng: Number(m.longitud) }];

    const validos = todos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validos.length === 0) { sinPuntos.push(m); continue; }

    const algunoCol = validos.some((p) => dentro(COLOMBIA, p.lat, p.lng));
    const algunoCaq = validos.some((p) => dentro(CAQUETA, p.lat, p.lng));

    if (!algunoCol) fueraColombia.push({ m, pts: validos });
    else if (!algunoCaq) fueraCaqueta.push({ m, pts: validos });
  }

  const resumen = (arr) => {
    const porUsuario = {};
    for (const { m } of arr) porUsuario[m.usuario_id] = (porUsuario[m.usuario_id] || 0) + 1;
    return porUsuario;
  };

  console.log('TOTAL mediciones:', rows.length);
  console.log('\n=== FUERA DE COLOMBIA:', fueraColombia.length, '===');
  console.log('por usuario:', JSON.stringify(resumen(fueraColombia), null, 2));
  for (const { m, pts } of fueraColombia) {
    console.log(`  ${m.id} | user=${m.usuario_id} | form=${m.formulario_id} | ${m.tipo_medicion} ${m.valor}${m.unidad || ''} | pts=${pts.length} | primer=${pts[0].lat.toFixed(4)},${pts[0].lng.toFixed(4)} | ${m.created_at.toISOString()}`);
  }

  console.log('\n=== DENTRO DE COLOMBIA PERO FUERA DE CAQUETA:', fueraCaqueta.length, '===');
  console.log('por usuario:', JSON.stringify(resumen(fueraCaqueta), null, 2));
  for (const { m, pts } of fueraCaqueta) {
    console.log(`  ${m.id} | user=${m.usuario_id} | form=${m.formulario_id} | ${m.tipo_medicion} ${m.valor}${m.unidad || ''} | pts=${pts.length} | primer=${pts[0].lat.toFixed(4)},${pts[0].lng.toFixed(4)} | ${m.created_at.toISOString()}`);
  }

  console.log('\n=== SIN COORDENADAS VALIDAS:', sinPuntos.length, '===');
  for (const m of sinPuntos) console.log(`  ${m.id} | user=${m.usuario_id} | ${m.created_at.toISOString()}`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
