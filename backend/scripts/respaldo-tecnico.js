// ============================================================
// Foto (respaldo) de todo lo que pertenece a un técnico, y verificación
// ============================================================
// Se usa antes de reasignar los beneficiarios de un técnico a otro en modo
// «solo pendientes»: lo ya diligenciado (formularios, firmas, archivos) debe
// quedar EXACTAMENTE igual. Solo lee, nunca escribe en la BD.
//
//   node scripts/respaldo-tecnico.js <tecnico_id> <carpeta>
//       Guarda <carpeta>/foto-<tecnico_id>.json con las filas completas
//       (sirve para restaurar) y una huella md5 por fila.
//
//   node scripts/respaldo-tecnico.js <tecnico_id> <carpeta> --verificar
//       Vuelve a tomar la foto y la compara con la guardada: lista cada fila
//       que cambió, desapareció o apareció.
//
// Formularios: los del técnico (columna o snapshot) Y los de las cédulas de
// sus beneficiarios — así una reasignación que los reescribiera se detecta
// aunque ya no estén a su nombre.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const [tecnicoId, carpeta] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFICAR = process.argv.includes('--verificar');
if (!tecnicoId || !carpeta) {
  console.error('Uso: node scripts/respaldo-tecnico.js <tecnico_id> <carpeta> [--verificar]');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PG_HOST, port: process.env.PG_PORT, database: process.env.PG_DB,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});

const huella = (fila) => crypto.createHash('md5').update(JSON.stringify(fila)).digest('hex');

const tomarFoto = async () => {
  const beneficiarios = (await pool.query(
    `SELECT * FROM beneficiarios WHERE tecnico_asignado_id = $1 ORDER BY item`, [tecnicoId]
  )).rows;
  const cedulas = beneficiarios
    .map((b) => (b.cedula || '').replace(/[^0-9A-Za-z]/g, ''))
    .filter(Boolean);

  const formularios = (await pool.query(
    `SELECT * FROM formularios
      WHERE usuario_id = $1
         OR tecnico_json->>'usuario_id' = $1
         OR regexp_replace(COALESCE(beneficiario_json->>'cedula', ''), '[^0-9A-Za-z]', '', 'g') = ANY($2::text[])
      ORDER BY id`,
    [tecnicoId, cedulas]
  )).rows;
  const formIds = formularios.map((f) => f.id);

  const borradores = (await pool.query(
    `SELECT * FROM formularios_borradores
      WHERE usuario_id = $1
         OR regexp_replace(COALESCE(payload_json->'beneficiario'->>'cedula', ''), '[^0-9A-Za-z]', '', 'g') = ANY($2::text[])
      ORDER BY id`,
    [tecnicoId, cedulas]
  )).rows;

  const archivos = (await pool.query(
    `SELECT * FROM archivos
      WHERE usuario_id = $1
         OR formulario_id = ANY($2::text[])
         OR metadata_json->>'formulario_id' = ANY($2::text[])
      ORDER BY id`,
    [tecnicoId, formIds]
  )).rows;

  const mediciones = (await pool.query(
    `SELECT * FROM mediciones WHERE usuario_id = $1 ORDER BY id`, [tecnicoId]
  )).rows;
  const visitasProgramadas = (await pool.query(
    `SELECT * FROM visitas_programadas WHERE usuario_id = $1 ORDER BY id`, [tecnicoId]
  )).rows;

  return { beneficiarios, formularios, borradores, archivos, mediciones, visitasProgramadas };
};

const llave = (tabla, fila) => (tabla === 'beneficiarios' ? String(fila.item) : String(fila.id));

(async () => {
  const archivoFoto = path.join(carpeta, `foto-${tecnicoId}.json`);
  try {
    const foto = await tomarFoto();

    if (!VERIFICAR) {
      fs.mkdirSync(carpeta, { recursive: true });
      const huellas = {};
      for (const [tabla, filas] of Object.entries(foto)) {
        huellas[tabla] = Object.fromEntries(filas.map((f) => [llave(tabla, f), huella(f)]));
      }
      fs.writeFileSync(
        archivoFoto,
        JSON.stringify({ fecha: new Date().toISOString(), tecnicoId, huellas, filas: foto }, null, 1)
      );
      console.log(`Foto guardada en ${archivoFoto}`);
      for (const [tabla, filas] of Object.entries(foto)) console.log(`  ${tabla}: ${filas.length}`);
      return;
    }

    // Campo por campo contra las filas guardadas. Las columnas que no
    // existían cuando se tomó la foto (p. ej. una migración posterior) se
    // ignoran; se ignoran también las que se pasen con --ignorar a,b,c
    // (ej. el `autoria_fija` / `tecnico_asignado_id` que cambia a propósito).
    const ignorar = new Set(
      (process.argv[process.argv.indexOf('--ignorar') + 1] || '')
        .split(',')
        .filter((c) => process.argv.includes('--ignorar') && c)
    );
    const guardada = JSON.parse(fs.readFileSync(archivoFoto, 'utf8'));
    const normal = (v) => JSON.stringify(v === undefined ? null : JSON.parse(JSON.stringify(v)));
    let diferencias = 0;
    for (const [tabla, filas] of Object.entries(foto)) {
      const antes = new Map((guardada.filas[tabla] || []).map((f) => [llave(tabla, f), f]));
      const ahora = new Map(filas.map((f) => [llave(tabla, f), f]));
      for (const [id, filaAntes] of antes) {
        const filaAhora = ahora.get(id);
        if (!filaAhora) { console.log(`  ✗ ${tabla} ${id}: ya no está`); diferencias++; continue; }
        const campos = Object.keys(filaAntes).filter(
          (c) => !ignorar.has(c) && normal(filaAntes[c]) !== normal(filaAhora[c])
        );
        if (campos.length) { console.log(`  ✎ ${tabla} ${id}: cambió ${campos.join(', ')}`); diferencias++; }
      }
      for (const id of ahora.keys()) {
        if (!antes.has(id)) { console.log(`  + ${tabla} ${id}: nuevo`); diferencias++; }
      }
    }
    console.log(diferencias ? `${diferencias} diferencia(s) contra la foto del ${guardada.fecha}` : `Sin cambios desde ${guardada.fecha}`);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
