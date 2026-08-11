const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'geodaily', user: 'geodaily_admin', password: process.env.PG_PASSWORD });

async function countRefs(id) {
  const tables = ['archivos','tracking','actividad_log','notificaciones','revisiones_formulario','revision_evidencia_formulario','visitas_programadas','formularios'];
  const out = {};
  for (const t of tables) {
    try {
      const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name LIKE '%usuario%'`, [t]);
      for (const c of cols.rows) {
        const r = await pool.query(`SELECT count(*) FROM "${t}" WHERE "${c.column_name}" = $1`, [id]);
        if (parseInt(r.rows[0].count) > 0) out[`${t}.${c.column_name}`] = r.rows[0].count;
      }
    } catch(e) {}
  }
  return out;
}

async function main() {
  console.log('=== Referencias a int-001 (interventor1) ===');
  console.log(await countRefs('int-001'));
  console.log('=== Referencias a int-008 (interventoria1) ===');
  console.log(await countRefs('int-008'));

  console.log('\n=== distinct usuario_id en tracking ===');
  const tr = await pool.query(`SELECT usuario_id, count(*) FROM tracking GROUP BY usuario_id ORDER BY count(*) DESC`);
  console.log(tr.rows);

  console.log('\n=== FK constraints que referencian usuarios.id ===');
  const fk = await pool.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'usuarios'
  `);
  console.log(fk.rows);

  await pool.end();
}
main().catch(e=>{console.error(e); process.exit(1);});
