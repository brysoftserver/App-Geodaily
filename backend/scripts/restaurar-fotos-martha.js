// ============================================================
// Restaurar las 5 fotos de la Visita 1 de Martha Xiomara Morales (b75dc2d4)
// ============================================================
// Incidente: el 2026-11-11 el borrado de b05be7b5 (duplicado) arrastró las
// fotos de b75dc2d4 porque su metadata_json.formulario_id seguía diciendo
// b05be7b5. Este script:
//   1. Respalda el estado actual (formulario, archivos, tombstone, listado
//      MinIO) y una copia de las fotos originales en
//      backups/restauracion-martha-<fecha>/.
//   2. Sube a MinIO las 5 fotos originales desde
//      backups/fechas-b75dc2d4-.../fotos (mismas rutas de antes).
//   3. Recrea sus filas en `archivos` (mismos id y evidencia_local_id),
//      vinculadas SOLO a b75dc2d4 (columna y metadata_json).
//   4. Asegura el tombstone de b05be7b5 en formularios_eliminados.
// La fecha 26/10/2026 se estampa después con reestampar-lote.js.
//
// Por defecto SIMULA. Con --apply escribe.
//   node scripts/restaurar-fotos-martha.js [--apply]
// ============================================================

const fs = require('fs');
const path = require('path');
process.loadEnvFile(path.join(__dirname, '..', '.env'));
const Minio = require('minio');
const db = require('../src/database');

const APPLY = process.argv.includes('--apply');
const KEEP = 'b75dc2d4-f8e3-47a8-bf24-79174b3f9604';
const DROP = 'b05be7b5-f569-4912-99ec-39d5f7031326';
const BK = path.join(__dirname, '..', 'backups');
const ORIG_DIR = path.join(BK, `fechas-${KEEP}`, 'fotos');
const UNION = path.join(BK, 'union-20261106', 'f-b05be7b5.json');
const BUCKET = process.env.MINIO_BUCKET || 'geodaily-archivos';
const minio = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET,
});

const existe = async (p) => { try { await minio.statObject(BUCKET, p); return true; } catch { return false; } };
const listar = (pref) => new Promise((res, rej) => {
  const out = []; const s = minio.listObjectsV2(BUCKET, pref, true);
  s.on('data', (o) => out.push({ name: o.name, size: o.size, lastModified: o.lastModified })); s.on('end', () => res(out)); s.on('error', rej);
});

(async () => {
  const union = JSON.parse(fs.readFileSync(UNION, 'utf8'));
  const fotos = union.a.filter((a) => a.tipo === 'foto');
  const form = (await db.query('SELECT * FROM formularios WHERE id=$1', [KEEP])).rows[0];
  if (!form) throw new Error('No existe el formulario ' + KEEP);
  const coords = new Map((form.fotos_json || []).map((x) => [x.id, x.coordenadas || {}]));

  // ---- validaciones ----
  const plan = [];
  for (const a of fotos) {
    const local = path.join(ORIG_DIR, a.filename);
    if (!fs.existsSync(local)) throw new Error('Falta original en respaldo: ' + local);
    const buf = fs.readFileSync(local);
    const filaId = (await db.query('SELECT formulario_id FROM archivos WHERE id=$1', [a.id])).rows[0];
    const filaEv = (await db.query('SELECT id, formulario_id FROM archivos WHERE usuario_id=$1 AND evidencia_local_id=$2', [form.usuario_id, a.evidencia_local_id])).rows[0];
    const c = coords.get(a.evidencia_local_id) || {};
    plan.push({ a, buf, enMinio: await existe(a.minio_path), filaId, filaEv, c });
  }
  console.log(`Formulario ${KEEP} (${form.beneficiario_json?.nombre}) — usuario ${form.usuario_id}`);
  for (const p of plan) {
    console.log(`  ${p.a.filename}  ${p.buf.length} B  enMinIO=${p.enMinio}  filaPorId=${p.filaId ? p.filaId.formulario_id : '-'}  filaPorEvidencia=${p.filaEv ? p.filaEv.id : '-'}  gps=${p.c.latitud ?? p.a.latitud},${p.c.longitud ?? p.a.longitud}`);
  }
  const conflictos = plan.filter((p) => p.filaId || p.filaEv);
  if (conflictos.length) throw new Error(`Ya hay ${conflictos.length} fila(s) en archivos para estas fotos; no se toca nada.`);
  const tomb = (await db.query('SELECT * FROM formularios_eliminados WHERE id=$1', [DROP])).rows[0];
  console.log('  tombstone b05be7b5:', tomb ? `sí (${tomb.eliminado_por}, ${tomb.eliminado_at.toISOString()})` : 'NO');

  if (!APPLY) { console.log('\nSIMULACIÓN: no se escribió nada. Use --apply.'); process.exit(0); }

  // ---- 1. respaldo ----
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BK, `restauracion-martha-${stamp}`);
  fs.mkdirSync(path.join(dir, 'fotos-originales'), { recursive: true });
  const archivos = (await db.query('SELECT * FROM archivos WHERE formulario_id=$1 OR metadata_json->>\'formulario_id\' IN ($1,$2)', [KEEP, DROP])).rows;
  const minioAntes = await listar('tecnicos/deily.torres/336_Martha_Xiomara_Morales/');
  fs.writeFileSync(path.join(dir, 'estado-antes.json'), JSON.stringify({ fecha: new Date().toISOString(), formulario: form, archivos, tombstone: tomb || null, minio: minioAntes }, null, 1));
  for (const p of plan) fs.writeFileSync(path.join(dir, 'fotos-originales', p.a.filename), p.buf);
  console.log('Respaldo en', dir);

  // ---- 2. MinIO ----
  for (const p of plan) {
    await minio.putObject(BUCKET, p.a.minio_path, p.buf, p.buf.length, { 'Content-Type': 'image/jpeg' });
  }
  console.log('Subidas a MinIO:', plan.length);

  // ---- 3 y 4. BD ----
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      const lat = Number.isFinite(parseFloat(p.c.latitud)) ? p.c.latitud : p.a.latitud;
      const lon = Number.isFinite(parseFloat(p.c.longitud)) ? p.c.longitud : p.a.longitud;
      const alt = Number.isFinite(parseFloat(p.c.altitud)) ? p.c.altitud : null;
      await client.query(
        `INSERT INTO archivos (id, usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket,
                               latitud, longitud, altitud, metadata_json, evidencia_local_id, created_at, updated_at)
         VALUES ($1,$2,$3,'foto',$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
        [p.a.id, form.usuario_id, KEEP, p.a.filename, p.a.mimetype || 'image/jpeg', p.buf.length, p.a.minio_path, BUCKET,
          lat, lon, alt,
          JSON.stringify({ formulario_id: KEEP, tipo_formulario: 'caracterizacion', restaurado: 'incidente 2026-11-11, respaldo fechas-b75dc2d4' }),
          p.a.evidencia_local_id, p.a.created_at]
      );
    }
    await client.query(
      `INSERT INTO formularios_eliminados (id, eliminado_por) VALUES ($1, 'adm-001') ON CONFLICT (id) DO NOTHING`, [DROP]);
    await client.query('UPDATE formularios SET updated_at=NOW() WHERE id=$1', [KEEP]);
    await client.query('INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1,$2,$3)',
      ['adm-001', 'restaurar_evidencias', JSON.stringify({ formulario_id: KEEP, archivos: plan.map((p) => p.a.id), motivo: 'borrado accidental 2026-11-11 al eliminar b05be7b5' })]);
    await client.query('COMMIT');
    console.log('Filas recreadas en archivos:', plan.length);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR BD (rollback). Los objetos ya subidos a MinIO quedan sin fila:', e.message);
    process.exit(1);
  } finally { client.release(); }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
