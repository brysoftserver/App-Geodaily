// ============================================================
// Re-estampar la fecha de las fotos de un formulario (corrimiento de fechas)
// ============================================================
// Las fotos de evidencia llevan la fecha QUEMADA en píxeles (banda inferior
// semitransparente de 4 líneas). Si la fecha del formulario se corrige, hay que
// volver a estampar. Este script:
//   1. Respalda las fotos actuales en backups/<tag>/fotos (si no existen ya).
//   2. Descarga cada foto de MinIO y tapa la banda vieja con una banda OPACA
//      (misma geometría que watermark.js, así cubre exactamente la anterior).
//   3. Estampa fecha nueva + GPS de la foto (fotos_json) + municipio + clima
//      de Open-Meteo para la nueva fecha/hora.
//   4. Sobrescribe el objeto en MinIO y actualiza archivos.size_bytes y updated_at (cache-buster de la app: sin esto el celular sigue mostrando la foto vieja).
//
// Uso (desde backend/, con las variables del .env cargadas):
//   node scripts/reestampar-fecha-formulario.js --form <uuid> --fecha 26/10/2026 \
//        --hora 15:23 --municipio "Puerto Rico (Caquetá)" [--dry-run] [--out dir]
//   --dry-run  no sube nada; con --out guarda las vistas previas en esa carpeta
// ============================================================

const sharp = require('sharp');
const Minio = require('minio');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { interpretarCodigoClima, fetchConTimeout } = require('../src/routes/climate');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const DRY_RUN = process.argv.includes('--dry-run');
const FORM = arg('form');
const FECHA = arg('fecha');            // dd/mm/aaaa
const HORA = arg('hora', '12:00');     // hh:mm hora Colombia
// --horas "foto_a.jpg=14:49,foto_b.jpg=15:56": hora propia por foto (si no se da, vale --hora)
const HORAS = Object.fromEntries((arg('horas', '') || '').split(',').filter(Boolean).map((p) => p.split('=')));
const MUNICIPIO = arg('municipio', 'Puerto Rico (Caquetá)');
const OUT = arg('out');
const TZ = 'America/Bogota';

if (!FORM || !/^\d{2}\/\d{2}\/\d{4}$/.test(FECHA || '') || !/^\d{2}:\d{2}$/.test(HORA)) {
  console.error('Uso: --form <uuid> --fecha dd/mm/aaaa --hora hh:mm [--horas f=hh:mm,..] [--municipio ..] [--dry-run] [--out dir]');
  process.exit(1);
}
const [dd, mm, aaaa] = FECHA.split('/');
const FECHA_ISO = `${aaaa}-${mm}-${dd}T${HORA}:00-05:00`; // Colombia UTC-5 sin DST

const BUCKET = process.env.MINIO_BUCKET || 'geodaily-archivos';
const minio = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET,
});
const pool = new Pool({
  host: process.env.PG_HOST, port: process.env.PG_PORT, database: process.env.PG_DB,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});

async function clima(lat, lon, hora) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,weather_code` +
      `&start_date=${aaaa}-${mm}-${dd}&end_date=${aaaa}-${mm}-${dd}&timezone=${encodeURIComponent(TZ)}`;
    const r = await fetchConTimeout(url, {}, 8000);
    if (!r.ok) return null;
    const d = await r.json();
    const idx = parseInt(hora.slice(0, 2), 10);
    if (d.hourly?.temperature_2m?.[idx] == null) return null;
    return {
      t: d.hourly.temperature_2m[idx], h: d.hourly.relative_humidity_2m?.[idx],
      v: d.hourly.wind_speed_10m?.[idx], n: d.hourly.cloud_cover?.[idx],
      c: interpretarCodigoClima(d.hourly.weather_code?.[idx]).clima,
    };
  } catch (e) { console.warn('  sin clima:', e.message); return null; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function estamparOpaco(buffer, lineas, lineasViejas) {
  const rot = await sharp(buffer).rotate().toBuffer();
  const { width: ancho, height: alto } = await sharp(rot).metadata();
  const fontSize = Math.max(14, Math.round(ancho / 42));
  const lineHeight = Math.round(fontSize * 1.45);
  const padding = Math.round(fontSize * 0.8);
  const altoBanda = padding * 2 + lineHeight * Math.max(lineas.length, lineasViejas);
  const textos = lineas.map((l, i) =>
    `<text x="${padding}" y="${padding + lineHeight * i + fontSize}" font-family="DejaVu Sans, sans-serif" ` +
    `font-size="${fontSize}" fill="#FFFFFF">${esc(l)}</text>`).join('');
  const svg = Buffer.from(
    `<svg width="${ancho}" height="${altoBanda}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${ancho}" height="${altoBanda}" fill="#000000" fill-opacity="1"/>${textos}</svg>`);
  return sharp(rot).composite([{ input: svg, top: alto - altoBanda, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
}

(async () => {
  const f = (await pool.query('SELECT fotos_json FROM formularios WHERE id=$1', [FORM])).rows[0];
  if (!f) throw new Error('Formulario no encontrado');
  const mapa = new Map((f.fotos_json || []).filter((x) => x.tipo === 'foto').map((x) => [x.id, x]));
  const arch = (await pool.query(
    "SELECT id, minio_path, evidencia_local_id FROM archivos WHERE formulario_id=$1 AND tipo='foto' ORDER BY created_at", [FORM])).rows;
  console.log(`Fotos: ${arch.length}  → fecha nueva ${FECHA} ${HORA}${DRY_RUN ? '  [DRY-RUN]' : ''}`);

  const bk = path.join(__dirname, '..', 'backups', `fechas-${FORM}`, 'fotos');
  if (!DRY_RUN) fs.mkdirSync(bk, { recursive: true });
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const a of arch) {
    const base = a.minio_path.split('/').pop();
    const foto = mapa.get(a.evidencia_local_id);
    const c = foto?.coordenadas || {};
    const lat = parseFloat(c.latitud), lon = parseFloat(c.longitud), alt = parseFloat(c.altitud);
    // Sin GPS válido (null o 0,0) la marca original solo llevaba la línea de fecha.
    const hayGPS = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

    const bkFile = path.join(bk, base);
    let orig;
    if (!DRY_RUN && fs.existsSync(bkFile)) orig = fs.readFileSync(bkFile);   // original ya respaldado
    else {
      const chunks = [];
      for await (const ch of await minio.getObject(BUCKET, a.minio_path)) chunks.push(ch);
      orig = Buffer.concat(chunks);
      if (!DRY_RUN) fs.writeFileSync(bkFile, orig);
    }

    const hora = HORAS[base] || HORA;
    const lineas = [`GEODAILY · Evidencia · ${FECHA}, ${hora}`];
    if (hayGPS) {
      const cl = await clima(lat, lon, hora);
      lineas.push(`Lat ${lat.toFixed(6)}  Lon ${lon.toFixed(6)}` + (Number.isFinite(alt) ? `  Alt ${Math.round(alt)} m` : ''));
      lineas.push(MUNICIPIO);
      if (cl) lineas.push(`${Math.round(cl.t)}°C · Humedad ${Math.round(cl.h ?? 0)}% · Viento ${Math.round(cl.v ?? 0)} m/s · Nubosidad ${Math.round(cl.n ?? 0)}% · ${cl.c}`);
    }
    console.log(base, '\n  ', lineas.join(' | '));

    // La marca vieja tenía 4 líneas con GPS y 1 sin GPS: la banda nueva la cubre.
    const nuevo = await estamparOpaco(orig, lineas, hayGPS ? 4 : 1);
    if (OUT) fs.writeFileSync(path.join(OUT, base), nuevo);
    if (DRY_RUN) continue;
    await minio.putObject(BUCKET, a.minio_path, nuevo, nuevo.length, { 'Content-Type': 'image/jpeg' });
    await pool.query('UPDATE archivos SET size_bytes=$1, updated_at=NOW() WHERE id=$2', [nuevo.length, a.id]);
    console.log('   -> subida', nuevo.length, 'bytes');
  }
  await pool.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
