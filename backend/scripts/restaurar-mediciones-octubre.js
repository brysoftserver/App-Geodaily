/**
 * Restaura las mediciones (polígonos) reales desde los backups JSON.
 *
 * Criterio del usuario (2026-10-18):
 *   - Solo son reales los polígonos con created_at >= 2026-10-01 (hora Colombia).
 *   - Los anteriores se descartan definitivamente.
 *   - Se descartan además los trazados con coordenadas fuera del municipio
 *     (Puerto Rico, Caquetá ≈ lat 1.0–3.0, lon -76.5 – -73.5), que son pruebas.
 *
 * Uso:
 *   node scripts/restaurar-mediciones-octubre.js --dry-run
 *   node scripts/restaurar-mediciones-octubre.js --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/database');

const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const FILES = [
  'mediciones_borradas_2026-10-18T03-47-14-160Z.json',
  'mediciones_limpieza_por_fecha_2026-10-18T04-05-01-289Z.json',
  'mediciones_pre_corte_2026-10-18T04-05-43-126Z.json',
  'mediciones_post_corte_2026-10-18T04-05-55-108Z.json',
];

const CORTE = new Date('2026-10-01T00:00:00-05:00');
const BBOX = { latMin: 1.0, latMax: 3.0, lonMin: -76.5, lonMax: -73.5 };

const APPLY = process.argv.includes('--apply');

function cargarTodas() {
  const all = new Map();
  for (const f of FILES) {
    const p = path.join(BACKUPS_DIR, f);
    if (!fs.existsSync(p)) {
      console.warn(`[skip] no existe: ${f}`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(d) ? d : d.mediciones || [];
    for (const m of arr) {
      if (!all.has(m.id)) all.set(m.id, { ...m, _src: f });
    }
  }
  return [...all.values()];
}

function parseMeta(m) {
  let md = m.metadata_json;
  if (typeof md === 'string') {
    try {
      md = JSON.parse(md);
    } catch {
      md = {};
    }
  }
  return md && typeof md === 'object' ? md : {};
}

function fueraDeBbox(puntos) {
  if (!Array.isArray(puntos) || puntos.length === 0) return false;
  return puntos.some(
    (p) =>
      typeof p.latitud !== 'number' ||
      typeof p.longitud !== 'number' ||
      p.latitud < BBOX.latMin ||
      p.latitud > BBOX.latMax ||
      p.longitud < BBOX.lonMin ||
      p.longitud > BBOX.lonMax
  );
}

(async () => {
  const todas = cargarTodas();
  console.log(`Backups: ${todas.length} mediciones únicas`);

  const restaurar = [];
  const descartadas = { fecha: 0, bbox: 0, sinPuntos: 0 };

  for (const m of todas) {
    const fecha = new Date(m.created_at);
    if (!(fecha >= CORTE)) {
      descartadas.fecha++;
      continue;
    }
    const md = parseMeta(m);
    const puntos = Array.isArray(md.puntos) ? md.puntos : [];
    if (puntos.length < 3) {
      descartadas.sinPuntos++;
      continue;
    }
    if (fueraDeBbox(puntos)) {
      descartadas.bbox++;
      continue;
    }
    restaurar.push({ m, md, puntos });
  }

  console.log(`  -> a restaurar: ${restaurar.length}`);
  console.log(`  -> descartadas por fecha (< 2026-10-01): ${descartadas.fecha}`);
  console.log(`  -> descartadas por coordenadas fuera del municipio: ${descartadas.bbox}`);
  console.log(`  -> descartadas por tener < 3 puntos: ${descartadas.sinPuntos}`);

  const porUsuario = {};
  for (const { m } of restaurar) porUsuario[m.usuario_id] = (porUsuario[m.usuario_id] || 0) + 1;
  console.log('  -> por usuario:', JSON.stringify(porUsuario));

  if (!APPLY) {
    console.log('\n[dry-run] No se escribió nada. Usa --apply para restaurar.');
    await pool.end();
    return;
  }

  // Backup de seguridad del estado actual antes de escribir
  const actual = await query('SELECT * FROM mediciones');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUPS_DIR, `mediciones_pre_restauracion_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ mediciones: actual.rows }, null, 2));
  console.log(`\nBackup del estado actual: ${backupPath} (${actual.rows.length} filas)`);

  let insertadas = 0;
  let omitidas = 0;

  for (const { m, md, puntos } of restaurar) {
    const lats = puntos.map((p) => p.latitud);
    const lons = puntos.map((p) => p.longitud);
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const lon = lons.reduce((a, b) => a + b, 0) / lons.length;

    const metadata = {
      ...md,
      puntos,
      area_hectareas: md.area_hectareas ?? null,
      perimetro_metros: md.perimetro_metros ?? null,
      nombre: md.nombre ?? null,
      beneficiario_cedula: md.beneficiario_cedula ?? null,
      beneficiario_nombre: md.beneficiario_nombre ?? null,
      vereda: md.vereda ?? null,
      corregimiento: md.corregimiento ?? null,
      usuario_nombre: md.usuario_nombre ?? null,
      restaurado: true,
      restaurado_at: new Date().toISOString(),
    };

    const res = await query(
      `INSERT INTO mediciones
         (id, usuario_id, formulario_id, tipo_medicion, valor, unidad,
          latitud, longitud, metadata_json, timestamp, sincronizado, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        m.id,
        m.usuario_id,
        m.formulario_id ?? null,
        m.tipo_medicion || 'poligono',
        m.valor ?? md.area_hectareas ?? 0,
        m.unidad || 'ha',
        m.latitud ?? lat,
        m.longitud ?? lon,
        JSON.stringify(metadata),
        m.timestamp || m.created_at,
        true,
        m.created_at,
      ]
    );
    if (res.rowCount > 0) insertadas++;
    else omitidas++;
  }

  console.log(`\nInsertadas: ${insertadas} | Omitidas (ya existían): ${omitidas}`);
  const total = await query('SELECT count(*)::int c FROM mediciones');
  console.log(`Total en tabla: ${total.rows[0].c}`);
  await pool.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
