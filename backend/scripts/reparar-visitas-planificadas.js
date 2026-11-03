// ============================================================
// GEODAILY — Resolver visitas planificadas que ya tienen formulario
//
// Una visita planificada (cédula + número) debería pasar a 'realizada' cuando
// existe el formulario correspondiente. Hasta ahora el cruce solo ocurría al
// guardar el formulario y la caracterización nunca se cruzaba (no manda
// `visita_numero`). Este script marca como 'realizada' las planificadas
// 'pendiente' que ya tienen su formulario, con la misma regla del servidor
// (src/lib/visitas.js).
//
// Uso:
//   node scripts/reparar-visitas-planificadas.js           (simulación)
//   node scripts/reparar-visitas-planificadas.js --apply   (respalda y escribe)
//
// Solo cambia estado 'pendiente' → 'realizada'. Nunca borra filas. Antes de
// escribir guarda un respaldo CSV en backups/.
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/database');
const { sqlCedulaNormalizada, sqlFormularioEsVisita } = require('../src/lib/visitas');

const APLICAR = process.argv.includes('--apply');

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  const filas = await db.queryAll(
    `SELECT vp.id, vp.fecha, vp.titulo, vp.beneficiario_cedula, vp.beneficiario_nombre,
            vp.actividad_numero, vp.usuario_id, vp.estado,
            (SELECT f.id FROM formularios f
              WHERE ${sqlFormularioEsVisita(
                sqlCedulaNormalizada('vp.beneficiario_cedula'),
                'vp.actividad_numero',
                'vp.actividad_numero'
              )}
              ORDER BY f.created_at DESC LIMIT 1) AS formulario_id
       FROM visitas_programadas vp
      WHERE vp.estado = 'pendiente'
        AND vp.actividad_numero BETWEEN 1 AND 12
        AND ${sqlCedulaNormalizada('vp.beneficiario_cedula')} <> ''
      ORDER BY vp.fecha`
  );

  const porResolver = filas.filter((f) => f.formulario_id);
  console.log(`Planificadas pendientes: ${filas.length}`);
  console.log(`Con formulario ya hecho (se marcarían realizadas): ${porResolver.length}`);
  for (const f of porResolver) {
    const fecha = f.fecha instanceof Date ? f.fecha.toISOString().slice(0, 10) : String(f.fecha).slice(0, 10);
    console.log(`  ${fecha}  Visita ${f.actividad_numero}  ${f.beneficiario_nombre || f.beneficiario_cedula}  → formulario ${f.formulario_id}`);
  }

  if (!APLICAR) {
    console.log('\nSimulación: no se escribió nada. Use --apply para aplicar.');
    return;
  }
  if (porResolver.length === 0) {
    console.log('\nNada que aplicar.');
    return;
  }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `visitas_programadas-pre-reparacion-${Date.now()}.csv`);
  const encabezado = 'id,fecha,titulo,beneficiario_cedula,actividad_numero,usuario_id,estado,formulario_id\n';
  const cuerpo = porResolver
    .map((f) => [f.id, f.fecha, f.titulo, f.beneficiario_cedula, f.actividad_numero, f.usuario_id, f.estado, f.formulario_id].map(csv).join(','))
    .join('\n');
  fs.writeFileSync(archivo, encabezado + cuerpo + '\n');
  console.log(`\nRespaldo: ${archivo}`);

  const r = await db.query(
    `UPDATE visitas_programadas SET estado = 'realizada'
      WHERE estado = 'pendiente' AND id = ANY($1::varchar[])`,
    [porResolver.map((f) => f.id)]
  );
  console.log(`Marcadas como realizadas: ${r.rowCount}`);
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
