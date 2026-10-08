// ============================================================
// GEODAILY — Reparar la atribución de formularios heredados
//
// Un formulario pertenece al técnico asignado HOY al beneficiario. Cuando el
// beneficiario se reasigna a otro técnico (PUT /api/beneficiarios/:item/asignacion)
// la reatribución de las visitas ya diligenciadas puede quedar sin aplicar:
//   - el formulario se subió por PRIMERA vez después de la reasignación (la
//     fila no existía y nació con el snapshot viejo del dispositivo), o
//   - MinIO falló y el bloque entero se saltó (el catch solo avisaba).
// Resultado: el técnico nuevo no ve la visita heredada y, si la abre, el
// backend le responde 403 al intentar corregir lo que pidió el interventor.
//
// POST /api/formularios/guardar ya no permite crear ese desfase y
// PATCH /api/formularios/:id/respuesta lo repara al vuelo cuando el técnico
// vigente corrige. Este script arregla lo que ya quedó mal y sube
// `updated_at` para que los teléfonos vuelvan a bajar la versión corregida
// en el próximo merge (el merge local descarta lo que no sea más nuevo).
//
// Uso:
//   node scripts/reparar-atribucion-formularios.js           (simulación)
//   node scripts/reparar-atribucion-formularios.js --apply   (escribe)
//
// Solo toca formularios cuya cédula identifique a UN único técnico asignado
// (las cédulas duplicadas con técnicos distintos quedan listadas como
// ambiguas, sin tocar: hay que resolverlas a mano).
// ============================================================

require('dotenv').config();
const db = require('../src/database');
const { resolverTecnicoVigente } = require('../src/lib/atribucion');

const APLICAR = process.argv.includes('--apply');

async function main() {
  const formularios = await db.queryAll(
    `SELECT f.id, f.tipo,
            f.usuario_id AS usuario_id,
            COALESCE(NULLIF(f.tecnico_json->>'usuario_id', ''), f.usuario_id) AS dueno_resuelto,
            f.tecnico_json,
            TRIM(f.beneficiario_json->>'cedula') AS cedula,
            f.updated_at
       FROM formularios f
      WHERE f.beneficiario_json->>'cedula' IS NOT NULL
        AND TRIM(f.beneficiario_json->>'cedula') <> ''
      ORDER BY f.updated_at DESC`
  );

  const cedulas = Array.from(new Set(formularios.map((f) => f.cedula).filter(Boolean)));
  const asignaciones = new Map();
  for (const cedula of cedulas) {
    const filas = await db.queryAll(
      `SELECT tecnico_asignado_id FROM beneficiarios
        WHERE TRIM(cedula) = TRIM($1) AND tecnico_asignado_id IS NOT NULL`,
      [cedula]
    );
    asignaciones.set(cedula, {
      tecnico: resolverTecnicoVigente(filas),
      candidatos: Array.from(
        new Set(filas.map((f) => f.tecnico_asignado_id).filter(Boolean))
      ),
    });
  }

  const aReparar = [];
  const ambiguos = [];
  const sinAsignar = [];

  for (const f of formularios) {
    const info = asignaciones.get(f.cedula);
    if (!info || info.candidatos.length === 0) {
      sinAsignar.push(f);
      continue;
    }
    if (!info.tecnico) {
      ambiguos.push({ ...f, candidatos: info.candidatos });
      continue;
    }
    if (info.tecnico !== f.dueno_resuelto) {
      aReparar.push({ ...f, tecnico_vigente: info.tecnico });
    }
  }

  console.log(`\nFormularios revisados: ${formularios.length}`);
  console.log(`  · con atribución desfasada: ${aReparar.length}`);
  console.log(`  · cédula ambigua (sin tocar): ${ambiguos.length}`);
  console.log(`  · beneficiario sin técnico asignado: ${sinAsignar.length}`);

  if (ambiguos.length > 0) {
    console.log('\n⚠️  Cédulas duplicadas con técnicos distintos (revisar a mano):');
    for (const a of ambiguos) {
      console.log(`   ${a.id} | cédula ${a.cedula} | dueño actual ${a.dueno_resuelto} | candidatos: ${a.candidatos.join(', ')}`);
    }
  }

  if (aReparar.length === 0) {
    console.log('\nNada que reparar. ✔');
    return;
  }

  console.log('\nSe reatribuirán a:');
  for (const r of aReparar) {
    console.log(`   ${r.id} | cédula ${r.cedula} | ${r.dueno_resuelto} → ${r.tecnico_vigente} | ${r.tipo}`);
  }

  if (!APLICAR) {
    console.log('\n(simulación — vuelve a ejecutar con --apply para escribir)\n');
    return;
  }

  let reparados = 0;
  for (const r of aReparar) {
    const tecnico = await db.queryOne(
      'SELECT nombre, cedula, telefono, email FROM usuarios WHERE id = $1',
      [r.tecnico_vigente]
    );
    if (!tecnico) {
      console.warn(`   ⚠️ Técnico ${r.tecnico_vigente} no existe en usuarios — se omite ${r.id}`);
      continue;
    }
    const snapshot = JSON.stringify({
      usuario_id: r.tecnico_vigente,
      nombre: tecnico.nombre || '',
      cedula: tecnico.cedula || '',
      telefono: tecnico.telefono || '',
      email: tecnico.email || '',
    });

    await db.query(
      `UPDATE formularios
          SET usuario_id = $1, tecnico_json = $2::jsonb, updated_at = NOW()
        WHERE id = $3`,
      [r.tecnico_vigente, snapshot, r.id]
    );

    // La caracterización guarda una tercera copia del técnico dentro de las
    // respuestas — se mantiene sincronizada con las otras dos.
    if (r.tipo === 'caracterizacion') {
      await db.query(
        `UPDATE formularios
            SET caracterizacion_nueva_json = jsonb_set(
                  jsonb_set(caracterizacion_nueva_json, '{tecnico_responsable}', to_jsonb($1::text)),
                  '{tecnico_cedula}', to_jsonb($2::text)
                )
          WHERE id = $3 AND caracterizacion_nueva_json IS NOT NULL`,
        [tecnico.nombre || '', tecnico.cedula || '', r.id]
      );
    }
    reparados++;
    console.log(`   ✔ ${r.id} → ${r.tecnico_vigente}`);
  }

  console.log(`\nReparados: ${reparados}/${aReparar.length}\n`);
}

main()
  .then(() => db.pool.end())
  .catch((error) => {
    console.error('Error reparando atribuciones:', error);
    process.exit(1);
  });
