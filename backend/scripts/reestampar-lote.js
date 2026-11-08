// ============================================================
// Re-estampar fecha en LOTE (fotos + fecha del formulario)
// ============================================================
// Para cada formulario de la lista:
//   1. Respalda las fotos originales (backups/fechas-<id>/fotos).
//   2. Lee con OCR (varias preparaciones de imagen) la hora, el nº de líneas y
//      el municipio de la marca vieja de cada foto, para CONSERVARLOS y cubrir
//      exactamente la banda vieja. Las fotos SIN marca no se tocan.
//   3. Estampa fecha nueva + GPS (fotos_json → columnas de archivos) +
//      municipio ORIGINAL + clima Open-Meteo de la fecha/hora nuevas, con
//      banda OPACA.
//   4. VERIFICA con OCR que la marca nueva dice la fecha esperada y que no
//      quedó texto viejo sobre la banda.
//   5. Solo si TODAS las fotos del formulario pasan: sube a MinIO, actualiza
//      archivos (size_bytes, updated_at = cache-buster de la app) y cambia la
//      fecha del formulario igual que el botón "Cambiar fecha" de la app
//      (created_at conservando la hora de Colombia + campo `fecha`).
//
// Por defecto SIMULA (no escribe nada en MinIO ni en la BD). Con --apply aplica.
//
// Uso (desde backend/, con el .env cargado):
//   node scripts/reestampar-lote.js --lista lista.json --tmp <dir> [--out <dir>] [--solo <prefijo-id>] [--apply]
//   lista.json = [{"id":"<uuid o prefijo>","fecha":"dd/mm/aaaa"}, ...]
// ============================================================

const sharp = require('sharp');
const Minio = require('minio');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { interpretarCodigoClima, fetchConTimeout } = require('../src/routes/climate');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const LISTA = arg('lista');
const TMP = arg('tmp');
const OUT = arg('out');
const SOLO = arg('solo');
const TZ = 'America/Bogota';
if (!LISTA || !TMP) { console.error('Uso: --lista lista.json --tmp <dir> [--out dir] [--solo prefijo] [--apply]'); process.exit(1); }
fs.mkdirSync(TMP, { recursive: true });
if (OUT) fs.mkdirSync(OUT, { recursive: true });

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

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// ---------- geometría (idéntica a watermark.js) ----------
const geo = (ancho) => {
  const fontSize = Math.max(14, Math.round(ancho / 42));
  return { fontSize, lh: Math.round(fontSize * 1.45), pad: Math.round(fontSize * 0.8) };
};

// ---------- OCR ----------
let ocrSeq = 0;
function ocrPng(png, psm = '7') {
  const f = path.join(TMP, `ocr_${process.pid}_${ocrSeq++}.png`);
  fs.writeFileSync(f, png);
  try {
    return execFileSync('tesseract', [f, 'stdout', '--psm', psm], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; } finally { try { fs.unlinkSync(f); } catch { /* */ } }
}

/** Texto OCR de la línea `i` de una banda de `n` líneas; `variante` cambia el preprocesado. */
async function ocrLinea(rot, ancho, alto, n, i, variante = 0) {
  const { lh, pad } = geo(ancho);
  const top = alto - (pad * 2 + lh * n) + pad + lh * i - Math.round(lh * 0.1);
  if (top < 0) return '';
  let img = sharp(rot)
    .extract({ left: 0, top, width: ancho, height: Math.min(Math.round(lh * 1.2), alto - top) })
    .grayscale();
  if (variante === 0) img = img.normalise();
  else if (variante === 1) img = img.threshold(235).negate();
  else img = img.threshold(210).negate();
  return ocrPng(await img.resize({ width: 1800 }).png().toBuffer());
}
const VARIANTES = [0, 1, 2];

/** Prueba las variantes de OCR hasta que `valida(texto)` devuelva algo. */
async function leer(rot, ancho, alto, n, i, valida) {
  for (const v of VARIANTES) {
    const t = await ocrLinea(rot, ancho, alto, n, i, v);
    const r = valida(t);
    if (r) return { r, texto: t };
  }
  return null;
}

const RE_FECHA = /(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{1,2})[:.](\d{2})/;
const validaFecha = (t) => {
  const m = t.match(RE_FECHA);
  if (!m || !/GEO|Evid/i.test(t)) return null;
  const hh = parseInt(m[4], 10), mi = parseInt(m[5], 10);
  if (hh > 23 || mi > 59) return null;
  return { fecha: `${m[1]}/${m[2]}/${m[3]}`, hora: `${String(hh).padStart(2, '0')}:${m[5]}` };
};
const validaGPS = (t) => {
  const m = t.match(/Lat\s*(-?\d{1,2}\.\d{6})\s*Lon\s*(-?\d{2}\.\d{6})(?:\s*Alt\s*(-?\d+)\s*m)?/);
  return m ? { lat: Math.abs(parseFloat(m[1])), lon: parseFloat(m[2]), alt: m[3] != null ? parseInt(m[3], 10) : null } : null;
};

const MUNICIPIOS = ['Florencia', 'Albania', 'Belén de los Andaquíes', 'Cartagena del Chairá', 'Curillo', 'El Doncello', 'El Paujil', 'La Montañita',
  'Milán', 'Morelia', 'Puerto Rico', 'San José del Fragua', 'San Vicente del Caguán', 'Solano', 'Solita', 'Valparaíso'];
const validaMunicipio = (t) => {
  const base = norm(t.split('(')[0]);
  if (base.length < 4) return null;
  let best = null;
  for (const m of MUNICIPIOS) {
    const nm = norm(m);
    const d = lev(base, nm);
    if (d <= Math.max(2, Math.floor(nm.length * 0.2)) && (!best || d < best.d)) best = { m, d };
  }
  return best ? best.m : null;
};

/** ¿Hay una banda semitransparente de n líneas abajo? (salto de luminosidad en su borde superior) */
async function razonBanda(rot, ancho, alto, n) {
  const { lh, pad } = geo(ancho);
  const top = alto - (pad * 2 + lh * n);
  if (top < 14) return 1;
  const media = async (t, h) => (await sharp(rot).extract({ left: 0, top: t, width: ancho, height: h }).grayscale().stats()).channels[0].mean;
  const arriba = await media(top - 12, 8);
  const abajo = await media(top + 4, 8);
  return arriba > 5 ? abajo / arriba : 1;
}

/** Detecta nº de líneas, fecha y hora de la marca vieja. null = no legible. 'SIN_MARCA' = foto sin marca. */
async function detectarMarca(rot, ancho, alto) {
  for (const n of [4, 3, 1, 2, 5]) {
    const x = await leer(rot, ancho, alto, n, 0, validaFecha);
    if (x) return { n, ...x.r };
  }
  const razones = await Promise.all([4, 3, 1].map((n) => razonBanda(rot, ancho, alto, n)));
  if (Math.min(...razones) > 0.85) return 'SIN_MARCA';
  return null;
}

// ---------- clima (con caché y reintentos) ----------
const cacheClima = new Map();
async function clima(lat, lon, fecha, hora) {
  const [dd, mm, aaaa] = fecha.split('/');
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${fecha}|${hora.slice(0, 2)}`;
  if (cacheClima.has(key)) return cacheClima.get(key);
  let res = null;
  for (let intento = 0; intento < 3 && !res; intento++) {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,weather_code` +
        `&start_date=${aaaa}-${mm}-${dd}&end_date=${aaaa}-${mm}-${dd}&timezone=${encodeURIComponent(TZ)}`;
      const r = await fetchConTimeout(url, {}, 8000);
      if (!r.ok) continue;
      const d = await r.json();
      const idx = parseInt(hora.slice(0, 2), 10);
      if (d.hourly?.temperature_2m?.[idx] == null) continue;
      res = {
        t: d.hourly.temperature_2m[idx], h: d.hourly.relative_humidity_2m?.[idx],
        v: d.hourly.wind_speed_10m?.[idx], n: d.hourly.cloud_cover?.[idx],
        c: interpretarCodigoClima(d.hourly.weather_code?.[idx]).clima,
      };
    } catch { /* reintenta */ }
  }
  if (res) cacheClima.set(key, res);
  return res;
}

// ---------- estampado ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function estamparOpaco(rot, ancho, alto, lineas, lineasViejas) {
  const { fontSize, lh, pad } = geo(ancho);
  const altoBanda = pad * 2 + lh * Math.max(lineas.length, lineasViejas);
  const textos = lineas.map((l, i) =>
    `<text x="${pad}" y="${pad + lh * i + fontSize}" font-family="DejaVu Sans, sans-serif" ` +
    `font-size="${fontSize}" fill="#FFFFFF">${esc(l)}</text>`).join('');
  const svg = Buffer.from(
    `<svg width="${ancho}" height="${altoBanda}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${ancho}" height="${altoBanda}" fill="#000000" fill-opacity="1"/>${textos}</svg>`);
  const buf = await sharp(rot).composite([{ input: svg, top: alto - altoBanda, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
  return { buf, altoBanda };
}

/** Verifica la foto nueva: fecha/hora esperadas en la banda y sin texto viejo encima. */
async function verificar(buf, esperado, nBanda) {
  const rot = await sharp(buf).toBuffer();
  const { width: ancho, height: alto } = await sharp(rot).metadata();
  const { lh, pad } = geo(ancho);
  const x = await leer(rot, ancho, alto, nBanda, 0, validaFecha);
  const leido = x ? `${x.r.fecha} ${x.r.hora}` : 'NO LEIDO';
  if (leido !== esperado) return { ok: false, motivo: `fecha leída "${leido}" ≠ esperada "${esperado}"` };
  const bandaAlto = pad * 2 + lh * nBanda;
  const top = alto - bandaAlto - Math.round(lh * 2.2);
  if (top > 0) {
    const png = await sharp(rot).extract({ left: 0, top, width: ancho, height: Math.round(lh * 2.1) })
      .grayscale().normalise().resize({ width: 1800 }).png().toBuffer();
    const r = ocrPng(png, '6');
    if (/GEODAILY|Evidencia|Humedad|Nubosidad|Viento|Lat\s?\d|Lon\s?-?\d/i.test(r)) {
      return { ok: false, motivo: `posible texto viejo sobre la banda: <${r.replace(/\s+/g, ' ')}>` };
    }
  }
  return { ok: true };
}

async function descargar(ruta) {
  const chunks = [];
  for await (const ch of await minio.getObject(BUCKET, ruta)) chunks.push(ch);
  return Buffer.concat(chunks);
}

const gpsValido = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

// ---------- por formulario ----------
async function procesarFormulario(item, dirBackups) {
  const filas = (await pool.query(
    `SELECT id, tipo, fotos_json, created_at, updated_at, caracterizacion_nueva_json,
            beneficiario_json->>'nombre' AS nombre
       FROM formularios WHERE id::text LIKE $1`, [item.id + '%'])).rows;
  if (filas.length !== 1) return { id: item.id, estado: 'ERROR', motivo: `${filas.length} formularios para el prefijo` };
  const f = filas[0];
  const rep = { id: f.id, nombre: f.nombre, tipo: f.tipo, fecha: item.fecha, fotos: [], estado: 'OK', avisos: [] };
  const mapa = new Map((f.fotos_json || []).filter((x) => x.tipo === 'foto').map((x) => [x.id, x]));
  const arch = (await pool.query(
    "SELECT id, minio_path, evidencia_local_id, latitud, longitud, altitud FROM archivos WHERE formulario_id=$1 AND tipo='foto' ORDER BY created_at", [f.id])).rows;
  if (!arch.length) return { ...rep, estado: 'SIN FOTOS' };

  const bk = path.join(dirBackups, `fechas-${f.id}`, 'fotos');
  fs.mkdirSync(bk, { recursive: true });
  const nuevos = [];

  for (const a of arch) {
    const base = a.minio_path.split('/').pop();
    const info = { archivo: base };
    const fallo = (msg) => { info.error = msg; rep.fotos.push(info); rep.estado = 'REVISAR'; };
    const bkFile = path.join(bk, base);
    let orig;
    if (fs.existsSync(bkFile)) orig = fs.readFileSync(bkFile);
    else { orig = await descargar(a.minio_path); fs.writeFileSync(bkFile, orig); }

    const rot = await sharp(orig).rotate().toBuffer();
    const { width: ancho, height: alto } = await sharp(rot).metadata();
    const marca = await detectarMarca(rot, ancho, alto);
    if (marca === 'SIN_MARCA') { info.sinMarca = true; rep.fotos.push(info); continue; }
    if (!marca) { fallo('no se pudo leer la marca vieja'); continue; }
    info.vieja = `${marca.fecha} ${marca.hora}`; info.nLineas = marca.n;
    if (marca.n === 2 || marca.n === 5) { fallo(`formato de ${marca.n} líneas no previsto`); continue; }

    const lineas = [`GEODAILY · Evidencia · ${item.fecha}, ${marca.hora}`];
    if (marca.n >= 3) {
      // coordenadas: fotos_json → columnas de archivos
      const cj = mapa.get(a.evidencia_local_id)?.coordenadas || {};
      let lat = parseFloat(cj.latitud), lon = parseFloat(cj.longitud), alt = parseFloat(cj.altitud);
      let origen = 'fotos_json';
      if (!gpsValido(lat, lon)) {
        lat = parseFloat(a.latitud); lon = parseFloat(a.longitud); alt = parseFloat(a.altitud); origen = 'archivos';
      }
      // GPS impreso en la marca vieja. El OCR puede equivocarse en un dígito, así que se prueban
      // todas las variantes y se acepta si ALGUNA coincide con las coordenadas de la base.
      let g = null;
      for (const v of VARIANTES) {
        const p = validaGPS(await ocrLinea(rot, ancho, alto, marca.n, 1, v));
        if (!p) continue;
        if (!g) g = { r: p };
        if (gpsValido(lat, lon) && Math.abs(p.lat - Math.abs(lat)) <= 0.01 && Math.abs(p.lon - lon) <= 0.01) { g = { r: p }; break; }
      }
      if (!gpsValido(lat, lon)) {
        // último recurso: lo que dice la propia marca vieja (solo si se leyó claro)
        if (g) { lat = g.r.lat; lon = g.r.lon; alt = g.r.alt ?? NaN; origen = 'OCR de la marca'; rep.avisos.push(`${base}: coordenadas tomadas de la marca vieja (OCR)`); }
        else { fallo('la marca vieja tiene GPS pero no hay coordenadas en la base de datos ni se leen en la foto'); continue; }
      } else if (g && (Math.abs(g.r.lat - Math.abs(lat)) > 0.01 || Math.abs(g.r.lon - lon) > 0.01)) {
        fallo(`coordenadas de la marca vieja (${g.r.lat}, ${g.r.lon}) distintas a las de la base (${lat}, ${lon})`); continue;
      }
      info.gps = origen;
      lineas.push(`Lat ${lat.toFixed(6)}  Lon ${lon.toFixed(6)}` + (Number.isFinite(alt) ? `  Alt ${Math.round(alt)} m` : ''));
      // Formato de 3 líneas SIN municipio: fecha, GPS y clima (la 3ª línea es el clima)
      const l3Clima = marca.n === 3 && !!(await leer(rot, ancho, alto, 3, 2, (t) => (/Humedad|Nubosidad|Viento/i.test(t) ? true : null)));
      if (!l3Clima) {
        // municipio: se CONSERVA el de la marca vieja
        const mu = await leer(rot, ancho, alto, marca.n, 2, validaMunicipio);
        if (!mu) { fallo('no se pudo leer el municipio de la marca vieja'); continue; }
        info.municipio = mu.r;
        if (mu.r !== 'Puerto Rico') rep.avisos.push(`${base}: la marca vieja decía ${mu.r} (se conserva)`);
        lineas.push(`${mu.r} (Caquetá)`);
      } else info.sinMunicipio = true;
      if (marca.n === 4 || l3Clima) {
        const cl = await clima(lat, lon, item.fecha, marca.hora);
        if (cl) lineas.push(`${Math.round(cl.t)}°C · Humedad ${Math.round(cl.h ?? 0)}% · Viento ${Math.round(cl.v ?? 0)} m/s · Nubosidad ${Math.round(cl.n ?? 0)}% · ${cl.c}`);
        else rep.avisos.push(`${base}: sin clima de Open-Meteo, la marca sale sin línea de clima`);
      }
    }
    const { buf, altoBanda } = await estamparOpaco(rot, ancho, alto, lineas, marca.n);
    const nBanda = Math.max(lineas.length, marca.n);
    const v = await verificar(buf, `${item.fecha} ${marca.hora}`, nBanda);
    info.nueva = `${item.fecha} ${marca.hora}`; info.lineas = lineas.length;
    if (!v.ok) { fallo(v.motivo); continue; }
    info.verificada = true; rep.fotos.push(info);
    nuevos.push({ a, buf, altoBanda, base });
  }

  if (OUT && nuevos.length) {
    const tiles = [];
    for (const n of nuevos) {
      const m = await sharp(n.buf).metadata();
      tiles.push(await sharp(n.buf).extract({ left: 0, top: Math.max(0, m.height - n.altoBanda - 40), width: m.width, height: Math.min(m.height, n.altoBanda + 40) })
        .resize({ width: 700 }).toBuffer());
    }
    const mt = await Promise.all(tiles.map((t) => sharp(t).metadata()));
    let y = 0;
    await sharp({ create: { width: 700, height: mt.reduce((s, q) => s + q.height + 6, 0), channels: 3, background: '#fff' } })
      .composite(tiles.map((t, i) => { const o = { input: t, top: y, left: 0 }; y += mt[i].height + 6; return o; }))
      .jpeg().toFile(path.join(OUT, `hoja_${f.id.slice(0, 8)}.jpg`));
  }

  if (rep.estado !== 'OK') return rep;   // alguna foto falló: NO se cambia nada de este formulario
  if (!APPLY) return rep;

  // ---- aplicar ----
  for (const n of nuevos) {
    await minio.putObject(BUCKET, n.a.minio_path, n.buf, n.buf.length, { 'Content-Type': 'image/jpeg' });
  }
  const [dd, mm, aaaa] = item.fecha.split('/');
  const iso = `${aaaa}-${mm}-${dd}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const n of nuevos) {
      await client.query('UPDATE archivos SET size_bytes=$1, updated_at=NOW() WHERE id=$2', [n.buf.length, n.a.id]);
    }
    // Misma idea que PATCH /api/formularios/:id/fecha (botón "Cambiar fecha"): cambia el DÍA
    // conservando la hora de Colombia. OJO: formularios.created_at es `timestamp WITHOUT time zone`
    // (hora UTC), así que hay que pasar por 'UTC' → 'America/Bogota' y volver; la consulta del
    // endpoint asume timestamptz y desplaza +10 h.
    const row = (await client.query(
      `UPDATE formularios
          SET created_at = (($1::date + ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::time)
                              AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC',
              updated_at = NOW()
        WHERE id = $2 RETURNING caracterizacion_nueva_json, created_at`, [iso, f.id])).rows[0];
    const enc = row.caracterizacion_nueva_json;
    if (enc && typeof enc === 'object' && String(enc.fecha || '').trim() !== '') {
      await client.query('UPDATE formularios SET caracterizacion_nueva_json=$1 WHERE id=$2',
        [JSON.stringify({ ...enc, fecha: `${dd}/${mm}/${aaaa}` }), f.id]);
    }
    await client.query('COMMIT');
    rep.created_at_nuevo = row.created_at;
  } catch (e) {
    await client.query('ROLLBACK');
    rep.estado = 'ERROR BD'; rep.motivo = e.message;
  } finally { client.release(); }
  rep.antes = { created_at: f.created_at, updated_at: f.updated_at, fecha: f.caracterizacion_nueva_json?.fecha ?? null };
  return rep;
}

(async () => {
  let lista = JSON.parse(fs.readFileSync(LISTA, 'utf8'));
  if (SOLO) lista = lista.filter((x) => x.id.startsWith(SOLO));
  const dirBackups = path.join(__dirname, '..', 'backups');
  console.log(`${APPLY ? 'APLICANDO' : 'SIMULACIÓN'} — ${lista.length} formulario(s)`);
  const informe = [];
  for (const item of lista) {
    const r = await procesarFormulario(item, dirBackups);
    informe.push(r);
    const fotos = r.fotos || [];
    const nOk = fotos.filter((x) => x.verificada).length;
    const nSin = fotos.filter((x) => x.sinMarca).length;
    console.log(`${r.estado.padEnd(8)} ${String(r.id).slice(0, 8)} ${String(r.nombre || '').padEnd(34)} → ${item.fecha}  verificadas ${nOk}/${fotos.length}${nSin ? `  (sin marca: ${nSin})` : ''}`);
    for (const x of fotos) if (x.error) console.log(`     ✗ ${x.archivo}: ${x.error}`);
    for (const a of r.avisos || []) console.log(`     ! ${a}`);
    if (r.motivo) console.log(`     ✗ ${r.motivo}`);
  }
  const nombre = path.join(dirBackups, `informe-lote-${APPLY ? 'aplicado' : 'simulacion'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(nombre, JSON.stringify(informe, null, 1));
  console.log('\nInforme:', nombre);
  await pool.end();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
