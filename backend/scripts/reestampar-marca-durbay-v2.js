// ============================================================
// Re-estampar marca de agua v2 — Durbay Quezada Cortez
// ============================================================
// CORRECCIÓN del intento anterior: la banda nueva usaba fill-opacity 0.55,
// por lo que el texto viejo "San Vicente del Caguán (Caquetá)" se
// TRANSPARENTABA a través de la banda nueva.
//
// Esta versión:
//   1. Parte de las fotos ORIGINALES del backup (no de las ya re-estampadas).
//   2. Usa una banda COMPLETAMENTE OPACA (fill-opacity 1.0) para tapar
//      definitivamente el texto viejo.
//   3. Mantiene el mismo estilo visual (texto blanco, DejaVu Sans).
//
// Uso:
//   node scripts/reestampar-marca-durbay-v2.js --dry-run   (solo reporta)
//   node scripts/reestampar-marca-durbay-v2.js             (aplica)
// ============================================================

const sharp = require('sharp');
const Minio = require('minio');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { interpretarCodigoClima, fetchConTimeout } = require('../src/routes/climate');

const DRY_RUN = process.argv.includes('--dry-run');

const MUNICIPIO = 'Puerto Rico (Caquetá)';
const VEREDA = 'Vereda Palestina No. 2';
const TZ = 'America/Bogota';

const BUCKET = process.env.MINIO_BUCKET || 'geodaily-archivos';
const PREFIX = 'tecnicos/german.rojas/260_Durbay_Quezada_Cortez/Formulario_1/fotos/';
const BACKUP_DIR = '/opt/App-movil/backend/backups/durbay-20261005/fotos';

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
    console.warn('[Reestampar v2] Sin clima:', error.message);
    return null;
  }
}

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
 * Re-estampa la banda inferior con una banda OPACA.
 * @param {Buffer} bufferOriginal - foto ORIGINAL (con marca vieja)
 * @param {string[]} lineas - líneas nuevas
 * @param {number} altoBandaVieja - alto de la banda vieja a cubrir
 */
async function reestampar(bufferOriginal, lineas, altoBandaVieja) {
  const imagenRotada = await sharp(bufferOriginal).rotate().toBuffer();
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

  // ⚠️ CLAVE: fill-opacity="1" (OPACO) para tapar el texto viejo.
  const svg = Buffer.from(
    `<svg width="${ancho}" height="${altoCubrir}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${ancho}" height="${altoCubrir}" fill="#000000" fill-opacity="1"/>` +
    textos +
    `</svg>`
  );

  return sharp(imagenRotada)
    .composite([{ input: svg, top: alto - altoCubrir, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function main() {
  // 1. Mapear fotos_json (id -> {coords, timestamp}) del formulario principal
  const r = await pool.query(
    `SELECT id, fotos_json FROM formularios
     WHERE id = '0445dba0-495c-4661-813c-9a3cfdb80512'`
  );
  const mapa = new Map();
  for (const row of r.rows) {
    for (const f of row.fotos_json || []) {
      if (f.tipo === 'foto') mapa.set(f.id, f);
    }
  }
  console.log('Fotos en fotos_json:', mapa.size);

  // 2. Mapear archivos (evidencia_local_id -> minio_path basename)
  const ar = await pool.query(
    `SELECT evidencia_local_id, minio_path FROM archivos
     WHERE formulario_id = '0445dba0-495c-4661-813c-9a3cfdb80512' AND tipo = 'foto'`
  );
  const porPath = new Map();
  for (const a of ar.rows) {
    const base = (a.minio_path || '').split('/').pop();
    porPath.set(base, a.evidencia_local_id);
  }
  console.log('Archivos foto en BD:', ar.rows.length);

  // 3. Recorrer las fotos del BACKUP (originales)
  const archivos = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.jpg'));
  console.log('Fotos en backup:', archivos.length);

  let ok = 0, skip = 0;
  for (const base of archivos) {
    const evId = porPath.get(base);
    const foto = evId ? mapa.get(evId) : null;
    if (!foto) { console.log('SKIP (sin datos):', base); skip++; continue; }

    const { latitud, longitud, altitud } = foto.coordenadas || {};
    const fechaISO = foto.timestamp;

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

    // Leer del BACKUP (original)
    const buf = fs.readFileSync(path.join(BACKUP_DIR, base));

    // Alto de la banda vieja (4 líneas) según ancho de la imagen
    const meta = await sharp(buf).rotate().metadata();
    const ancho = meta.width || 1000;
    const fontSize = Math.max(14, Math.round(ancho / 42));
    const lineHeight = Math.round(fontSize * 1.45);
    const padding = Math.round(fontSize * 0.8);
    const altoBandaVieja = padding * 2 + lineHeight * 4;

    const nuevo = await reestampar(buf, lineas, altoBandaVieja);

    // Re-subir (sobrescribe)
    const minioPath = PREFIX + base;
    await minio.putObject(BUCKET, minioPath, nuevo, nuevo.length, { 'Content-Type': 'image/jpeg' });
    console.log('  -> re-subida', nuevo.length, 'bytes a', minioPath);
    ok++;
  }

  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Procesadas: ${ok}, saltadas: ${skip}`);
  await pool.end();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
