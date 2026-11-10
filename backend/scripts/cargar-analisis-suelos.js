// ============================================================
// GEODAILY — Carga masiva de resultados de Análisis de Suelos
// ============================================================
// Lee una carpeta organizada como:
//   <raiz>/<NOMBRE BENEFICIARIO>/<NOMBRE> - <CODIGO>.pdf
// empareja cada carpeta con un beneficiario (por nombre normalizado; si no
// hay coincidencia exacta, por similitud de palabras con umbral alto) y deja
// el PDF exactamente como lo haría la subida desde la app:
//   · MinIO: tecnicos/{usuario}/AnalisisSuelos/{item}.pdf
//   · Tabla analisis_suelos (un registro por beneficiario)
//
// Los beneficiarios que YA tienen un PDF cargado se omiten, salvo --reemplazar.
// Modo simulación por defecto; --confirmar para subir de verdad.
//
// Uso:
//   node scripts/cargar-analisis-suelos.js --dir "<ruta>" [--confirmar] [--reemplazar]
// ============================================================

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const db = require('../src/database');
const storage = require('../src/storage');

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const ROOT = dirIdx !== -1 ? args[dirIdx + 1] : null;
const CONFIRMAR = args.includes('--confirmar');
const REEMPLAZAR = args.includes('--reemplazar');
if (!ROOT || !fs.existsSync(ROOT)) {
  console.error('Uso: node scripts/cargar-analisis-suelos.js --dir "<ruta>" [--confirmar] [--reemplazar]');
  process.exit(1);
}

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

/** Distancia de edición (para tolerar errores de tipeo: Fuestes/Fuentes). */
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const tokenIgual = (x, y) =>
  x === y ||
  (x.length === 1 && y.startsWith(x)) || // inicial: "M" ↔ "MONTEALEGRE"
  (x.length >= 4 && y.length >= 4 && lev(x, y) <= 2);

/** Puntaje: fracción de palabras de la carpeta presentes en el nombre del beneficiario. */
function puntaje(carpeta, nombre) {
  const t = tokens(carpeta);
  const bt = tokens(nombre);
  const comunes = t.filter((x) => bt.some((y) => tokenIgual(x, y))).length;
  return { comunes, frac: comunes / t.length };
}

function emparejar(carpeta, bens) {
  const exactos = bens.filter((b) => norm(b.nombre_completo) === norm(carpeta));
  if (exactos.length === 1) return { b: exactos[0], tipo: 'exacto' };
  if (exactos.length > 1) return { error: `ambiguo (${exactos.map((b) => b.item).join(', ')})` };
  const cands = bens
    .map((b) => ({ b, ...puntaje(carpeta, b.nombre_completo) }))
    .filter((c) => c.comunes >= 2)
    .sort((a, b) => b.frac - a.frac || b.comunes - a.comunes);
  if (!cands.length) return { error: 'sin coincidencia' };
  // Debe cubrir casi toda la carpeta y no empatar con otro candidato.
  if (cands[0].frac < 0.75) return { error: `dudoso: ${cands[0].b.nombre_completo} (${cands[0].frac.toFixed(2)})` };
  if (cands[1] && cands[1].frac === cands[0].frac) return { error: `empate: ${cands[0].b.item}/${cands[1].b.item}` };
  return { b: cands[0].b, tipo: 'aprox' };
}

(async () => {
  const bens = await db.queryAll(
    `SELECT b.item, b.nombre_completo, b.tecnico_asignado_id, u.usuario, u.rol,
            (a.beneficiario_item IS NOT NULL) AS ya_tiene
     FROM beneficiarios b
     JOIN usuarios u ON u.id = b.tecnico_asignado_id AND u.rol = 'tecnico'
     LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item`
  );

  const usados = new Map();
  const res = { subidos: [], omitidos: [], errores: [] };
  if (CONFIRMAR) await storage.ensureBucket();

  for (const carpeta of fs.readdirSync(ROOT).sort()) {
    const dir = path.join(ROOT, carpeta);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pdfs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (pdfs.length !== 1) {
      res.errores.push(`${carpeta}: ${pdfs.length} PDF en la carpeta`);
      continue;
    }
    const m = emparejar(carpeta, bens);
    if (m.error) {
      res.errores.push(`${carpeta}: ${m.error}`);
      continue;
    }
    const { b } = m;
    if (usados.has(b.item)) {
      res.errores.push(`${carpeta}: el beneficiario ${b.item} ya fue usado por "${usados.get(b.item)}"`);
      continue;
    }
    usados.set(b.item, carpeta);
    const linea = `${carpeta} → [${b.item}] ${b.nombre_completo} (${b.usuario})${m.tipo === 'aprox' ? ' ~aprox' : ''}`;
    if (b.ya_tiene && !REEMPLAZAR) {
      res.omitidos.push(`${linea} — ya tiene PDF`);
      continue;
    }
    const archivo = path.join(dir, pdfs[0]);
    const buf = fs.readFileSync(archivo);
    if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
      res.errores.push(`${carpeta}: no es un PDF válido`);
      continue;
    }
    if (CONFIRMAR) {
      const key = `${storage.getUserBasePath('tecnico', b.usuario)}/AnalisisSuelos/${b.item}.pdf`;
      await storage.minioClient.putObject(storage.CONFIG.bucket, key, buf, null, { 'Content-Type': 'application/pdf' });
      await db.query(
        `INSERT INTO analisis_suelos (beneficiario_item, tecnico_id, storage_key, nombre_archivo, tamano, subido_por)
         VALUES ($1, $2, $3, $4, $5, 'carga-masiva')
         ON CONFLICT (beneficiario_item) DO UPDATE SET
           tecnico_id = EXCLUDED.tecnico_id, storage_key = EXCLUDED.storage_key,
           nombre_archivo = EXCLUDED.nombre_archivo, tamano = EXCLUDED.tamano,
           subido_por = EXCLUDED.subido_por, resumen_ia = NULL, updated_at = NOW()`,
        [b.item, b.tecnico_asignado_id, key, pdfs[0].slice(0, 255), buf.length]
      );
    }
    res.subidos.push(linea);
  }

  console.log(`\n${CONFIRMAR ? 'SUBIDOS' : 'SE SUBIRÍAN'} (${res.subidos.length}):`);
  res.subidos.forEach((l) => console.log('  ' + l));
  console.log(`\nOMITIDOS (${res.omitidos.length}):`);
  res.omitidos.forEach((l) => console.log('  ' + l));
  console.log(`\nERRORES (${res.errores.length}):`);
  res.errores.forEach((l) => console.log('  ' + l));
  if (!CONFIRMAR) console.log('\n(Simulación: no se subió nada. Usa --confirmar.)');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
