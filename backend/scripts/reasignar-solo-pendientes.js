// ============================================================
// Reasignar los beneficiarios de un técnico a otro en modo «solo pendientes»
// ============================================================
// Lo ya diligenciado y firmado por el técnico de origen se queda a su nombre
// (autoría fija, solo lectura para el nuevo); los borradores pasan al nuevo.
// Usa exactamente la misma función que el panel (lib/reasignacionSoloPendientes.js).
//
// Por defecto SIMULA (cada beneficiario se hace en una transacción que se
// deshace). Con --apply escribe.
//
//   node scripts/reasignar-solo-pendientes.js --de tec-006 --a tec-013 [--item 123] [--apply]
//
// Antes de --apply: node scripts/respaldo-tecnico.js <de> <carpeta>
// Después:          node scripts/respaldo-tecnico.js <de> <carpeta> --verificar
// ============================================================

const path = require('path');
const { Pool } = require('pg');
const { reasignarSoloPendientes } = require('../src/lib/reasignacionSoloPendientes');

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : null;
};
const DE = arg('--de');
const A = arg('--a');
const ITEM = arg('--item') ? parseInt(arg('--item'), 10) : null;
const APPLY = process.argv.includes('--apply');

if (!DE || !A || DE === A) {
  console.error('Uso: node scripts/reasignar-solo-pendientes.js --de <tecnico_id> --a <tecnico_id> [--item N] [--apply]');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PG_HOST, port: process.env.PG_PORT, database: process.env.PG_DB,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});

(async () => {
  try {
    const destino = (await pool.query('SELECT id, nombre, rol, activo FROM usuarios WHERE id = $1', [A])).rows[0];
    const origen = (await pool.query('SELECT id, nombre FROM usuarios WHERE id = $1', [DE])).rows[0];
    if (!destino || !origen) throw new Error('Técnico de origen o destino no encontrado');
    if (!destino.activo) throw new Error(`${destino.nombre} está inactivo`);

    const items = (await pool.query(
      `SELECT item, nombre_completo FROM beneficiarios
        WHERE tecnico_asignado_id = $1 ${ITEM ? 'AND item = $2' : ''}
        ORDER BY item`,
      ITEM ? [DE, ITEM] : [DE]
    )).rows;

    console.log(`${APPLY ? 'APLICANDO' : 'SIMULACIÓN'}: ${items.length} beneficiario(s) de ${origen.nombre} → ${destino.nombre}\n`);
    let formularios = 0;
    let borradores = 0;
    for (const { item } of items) {
      const r = await reasignarSoloPendientes(pool, {
        item, tecnicoId: destino.id, tecnicoNombre: destino.nombre, simular: !APPLY,
      });
      formularios += r.formulariosConservados;
      borradores += r.borradoresTrasladados;
      console.log(`  item ${String(item).padStart(4)}  ${r.beneficiario.padEnd(45)} formularios conservados: ${r.formulariosConservados}  borradores trasladados: ${r.borradoresTrasladados}`);
    }
    console.log(`\nTotal: ${formularios} formulario(s) conservados a nombre de ${origen.nombre}, ${borradores} borrador(es) trasladados.`);
    if (!APPLY) console.log('Nada se escribió. Para aplicar: agregar --apply');
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
