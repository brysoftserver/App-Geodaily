// ============================================================
// Re-estampar marca de agua — Durbay Quezada Cortez
// ============================================================
// Corrige la línea de ubicación de "San Vicente del Caguán (Caquetá)"
// a "Puerto Rico (Caquetá)" + agrega la vereda "Palestina No. 2".
//
// Estrategia (Opción A): la marca está QUEMADA en píxeles. Se cubre la
// banda inferior vieja (4 líneas) con una banda nueva (5 líneas) que
// conserva fecha, GPS y clima, y corrige la ubicación.
//
// Uso:
//   node scripts/reestampar-marca-durbay.js --dry-run   (solo reporta)
//   node scripts/reestampar-marca-durbay.js             (aplica)
// ============================================================

const sharp = require('sharp');
const Minio = require('minio');
const { Pool } = require('pg');
const { interpretarCodigoClima, fetchConTimeout } = require('../src/routes/climate');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Clima a la hora exacta de captura (Open-Meteo histórico horario).
 * Réplica de la lógica de watermark.js (no exportada allí).
 */
async function obtenerClimaEnFecha(lat, lon, fechaISO) {
  try {
    const fecha = new Date(fechaISO);
    if (Number.isNaN(fecha.getTime())) return null;
    const edadDias = (Date.now() - fecha.getTime()) / (24 * 3600 * 1000);
    if (edadDias < 0 || edadDias > 88) return null;
    const fechaLocal = new Date(fecha.getTime() - 5 * 3600 * 1000);
    const dia = fechaLocal.toISOString().slice(0, 10);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${parseFloat(lat)}&longitude=${parseFloat(lon)}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,weather_code` +
      `&start_date=${dia}&end_date=${dia}&timezone=${encodeURIComponent(TZ)}`;
    const response = await fetchConTimeout(url, {}, 8000);
    if (!response.ok) return null;
    const data = await response.json();
    const horas = data.hourly?.time || [];
    if (horas.length === 0) return null;
    const horaLocal = parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(fecha),
      10
    );
    const idx = Math.min(Math.max(horaLocal, 0), horas.length - 1);
    const { clima } = interpretarCodigoClima(data.hourly.weather_code?.[idx]);
    return {
      temperatura: data.hourly.temperature_2m?.[idx],
      humedad: data.hourly.relative_humidity_2m?.[idx],
      viento: data.hourly.wind_speed_10m?.[idx],
      nubosidad: data.hourly.cloud_cover?.[idx],
      clima,
    };
  } catch (error) {
    console.warn('[Reestampar] Sin clima:', error.message);
    return null;
  }
}

const MUNICIPIO = 'Puerto Rico (Caquetá)';
const VEREDA = 'Vereda Palestina No. 2';
const TZ = 'America/Bogota';

const BUCKET = process.env.MINIO_BUCKET || 'geodaily-archivos';
const PREFIX = 'tecnicos/german.rojas/260_Durbay_Quezada_Cortez/Formulario_1/fotos/';

const minio = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET,
});

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

function formatearFecha(fechaISO) {
  try {
    const d = new Date(fechaISO);
    if (Number.isNaN(d.getTime())) throw new Error('fecha inválida');
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: TZ,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
}

function esc(texto) {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Re-estampa la banda inferior. Cubre la banda vieja (altoBandaVieja) con
 * una banda nueva calculada para `lineas`.
 */
async function reestampar(buffer, lineas, altoBandaVieja) {
  const imagenRotada = await sharp(buffer).rotate().toBuffer();
  const meta = await sharp(imagenRotada).metadata();
  const ancho = meta.width || 1000;
  const alto = meta.height || 1000;

  const fontSize = Math.max(14, Math.round(ancho / 42));
  const lineHeight = Math.round(fontSize * 1.45);
  const padding = Math.round(fontSize * 0.8);
  const bandaAlto = padding * 2 + lineHeight * lineas.length;

  // La banda nueva debe cubrir la vieja. Si la nueva es más baja, se
  // extiende hacia arriba para tapar completamente la anterior.
  const altoCubrir = Math.max(bandaAlto, altoBandaVieja);

  const textos = lineas
    .map((linea, i) =>
      `<text x="${padding}" y="${padding + lineHeight * i + fontSize}" ` +
      `font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" fill="#FFFFFF">${esc(linea)}</text>`
    )
    .join('');

  const svg = Buffer.from(
    `<svg width="${ancho}" height="${altoCubrir}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${ancho}" height="${altoCubrir}" fill="#000000" fill-opacity="0.55"/>` +
    textos +
    `</svg>`
  );

  return sharp(imagenRotada)
    .composite([{ input: svg, top: alto - altoCubrir, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function main() {
  // 1. Obtener fotos_json de ambos formularios para mapear id -> {coords, timestamp}
  const r = await pool.query(
    `SELECT id, fotos_json FROM formularios
     WHERE beneficiario_json->>'cedula' = '96360538' ORDER BY created_at`
  );
  const mapa = new Map();
  for (const row of r.rows) {
    for (const f of row.fotos_json || []) {
      if (f.tipo === 'foto') mapa.set(f.id, f);
    }
  }
  console.log('Fotos en fotos_json:', mapa.size);

  // 2. Listar objetos en MinIO
  const stream = minio.listObjectsV2(BUCKET, PREFIX, true);
  const objs = [];
  await new Promise((res, rej) => {
    stream.on('data', (o) => { if (o.name.endsWith('.jpg')) objs.push(o.name); });
    stream.on('end', res);
    stream.on('error', rej);
  });
  console.log('Fotos en MinIO:', objs.length);

  // 3. Mapear archivos (evidencia_local_id -> minio_path) para saber coords por archivo
  const ar = await pool.query(
    `SELECT evidencia_local_id, minio_path FROM archivos
     WHERE formulario_id IN ('c5ba6285-7a3d-4d47-a1b2-9fccab0e6cef','0445dba0-495c-4661-813c-9a3cfdb80512')
       AND tipo = 'foto'`
  );
  const porPath = new Map();
  for (const a of ar.rows) {
    const base = (a.minio_path || '').split('/').pop();
    porPath.set(base, a.evidencia_local_id);
  }

  let ok = 0, skip = 0;
  for (const name of objs) {
    const base = name.split('/').pop();
    const evId = porPath.get(base);
    const foto = evId ? mapa.get(evId) : null;
    if (!foto) { console.log('SKIP (sin datos):', base); skip++; continue; }

    const { latitud, longitud, altitud } = foto.coordenadas || {};
    const fechaISO = foto.timestamp;

    // Recalcular clima a la hora de captura
    const clima = await obtenerClimaEnFecha(latitud, longitud, fechaISO);

    const lineas = [`GEODAILY · Evidencia · ${formatearFecha(fechaISO)}`];
    let lineaGPS = `Lat ${parseFloat(latitud).toFixed(6)}  Lon ${parseFloat(longitud).toFixed(6)}`;
    if (Number.isFinite(parseFloat(altitud))) lineaGPS += `  Alt ${Math.round(parseFloat(altitud))} m`;
    lineas.push(lineaGPS);
    lineas.push(MUNICIPIO);
    lineas.push(VEREDA);
    if (clima && clima.temperatura != null) {
      lineas.push(
        `${Math.round(clima.temperatura)}°C · Humedad ${Math.round(clima.humedad ?? 0)}% · ` +
        `Viento ${Math.round(clima.viento ?? 0)} m/s · Nubosidad ${Math.round(clima.nubosidad ?? 0)}% · ${clima.clima}`
      );
    }

    console.log(`\n${base}`);
    console.log('  lineas:', JSON.stringify(lineas));

    if (DRY_RUN) { ok++; continue; }

    // Descargar
    const buf = await new Promise((res, rej) => {
      const chunks = [];
      minio.getObject(BUCKET, name, (err, s) => {
        if (err) return rej(err);
        s.on('data', (c) => chunks.push(c));
        s.on('end', () => res(Buffer.concat(chunks)));
        s.on('error', rej);
      });
    });

    // Alto de la banda vieja (4 líneas) según ancho de la imagen
    const meta = await sharp(buf).rotate().metadata();
    const ancho = meta.width || 1000;
    const fontSize = Math.max(14, Math.round(ancho / 42));
    const lineHeight = Math.round(fontSize * 1.45);
    const padding = Math.round(fontSize * 0.8);
    const altoBandaVieja = padding * 2 + lineHeight * 4;

    const nuevo = await reestampar(buf, lineas, altoBandaVieja);

    // Re-subir (sobrescribe)
    await minio.putObject(BUCKET, name, nuevo, nuevo.length, { 'Content-Type': 'image/jpeg' });
    console.log('  -> re-subida', nuevo.length, 'bytes');
    ok++;
  }

  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Procesadas: ${ok}, saltadas: ${skip}`);
  await pool.end();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
