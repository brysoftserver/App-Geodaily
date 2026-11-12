// ============================================================
// Firmas de la Visita 2 en las Actas de Entrega de Preparación del Terreno
// ============================================================
// Pone la firma del técnico y la del beneficiario de la Visita 2 en las
// Actas de Entrega (publicadas y borradores del servidor) de las actividades
// de ACTIVIDADES_FIRMAS_VISITA_2 que no las tengan. Solo campos vacíos: una
// firma ya puesta no se toca. Quita esas firmas de `faltantes`.
//
// - En las publicadas borra `pdf_path` si cambian (el PDF guardado ya no
//   sirve: no lleva las firmas) — igual que hace /sync.
// - Antes de escribir guarda los datos anteriores en
//   backups/firmas-visita2-actas-<fecha>.json.
// - Todo en una transacción.
//
// Por defecto SIMULA. Con --apply escribe.
//   node scripts/firmas-visita2-actas-preparacion.js [--apply]
// ============================================================

const fs = require('fs');
const path = require('path');

process.loadEnvFile(path.join(__dirname, '..', '.env'));
const APPLY = process.argv.includes('--apply');

const db = require('../src/database');
const { ACTIVIDADES_FIRMAS_VISITA_2, firmasVisita2, aplicarFirmasVisita2 } = require('../src/lib/firmasVisita2');

const aObjeto = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});
const SIN_FIRMAS = `NOT ((datos->>'firmaBeneficiario') LIKE 'data:image%' AND (datos->>'firmaTecnico') LIKE 'data:image%')`;

(async () => {
  const respaldo = { fecha: new Date().toISOString(), publicadas: [], borradores: [] };
  const cacheFirmas = new Map();
  const firmasDe = async (cedula) => {
    if (!cacheFirmas.has(cedula)) cacheFirmas.set(cedula, await firmasVisita2(cedula));
    return cacheFirmas.get(cedula);
  };
  const sinVisita2 = [];
  const cambios = [];

  for (const [tabla, clave] of [['otros_formatos', 'publicadas'], ['otros_formatos_borradores', 'borradores']]) {
    const filas = await db.queryAll(
      `SELECT t.id, t.beneficiario_cedula, t.datos, u.nombre AS tecnico
         FROM ${tabla} t LEFT JOIN usuarios u ON u.id = t.tecnico_id
        WHERE t.tipo = 'acta_entrega_individual'
          AND t.datos->>'actividadId' = ANY($1)
          AND ${SIN_FIRMAS.replace(/datos/g, 't.datos')}
        ORDER BY u.nombre, t.created_at`,
      [ACTIVIDADES_FIRMAS_VISITA_2]
    );
    for (const f of filas) {
      const datos = aObjeto(f.datos);
      const firmas = await firmasDe(f.beneficiario_cedula);
      if (!firmas) {
        sinVisita2.push(`${clave} ${f.id} (${f.tecnico || '?'}, ${datos.nombre || f.beneficiario_cedula})`);
        continue;
      }
      const r = aplicarFirmasVisita2(datos, firmas);
      if (!r.cambio) {
        sinVisita2.push(`${clave} ${f.id} (${f.tecnico || '?'}): la Visita 2 no tiene las firmas que faltan`);
        continue;
      }
      respaldo[clave].push({ id: f.id, datos });
      cambios.push({
        tabla, clave, id: f.id, datos: r.datos,
        resumen: `${clave.padEnd(10)} ${String(f.tecnico || '?').padEnd(28)} ${String(datos.nombre || f.beneficiario_cedula).padEnd(34)} ` +
          `benef:${!/^data:image/.test(datos.firmaBeneficiario || '') && /^data:image/.test(r.datos.firmaBeneficiario || '') ? 'SE PONE' : 'ya tenía/no hay'} ` +
          `téc:${!/^data:image/.test(datos.firmaTecnico || '') && /^data:image/.test(r.datos.firmaTecnico || '') ? 'SE PONE' : 'ya tenía/no hay'}`,
      });
    }
  }

  cambios.forEach((c) => console.log(c.resumen));
  console.log(`\n${cambios.length} acta(s) a completar.`);
  if (sinVisita2.length) console.log(`Sin cambios (${sinVisita2.length}):\n  ` + sinVisita2.join('\n  '));

  if (!APPLY) {
    console.log('\nSIMULACIÓN: no se escribió nada. Corre con --apply para guardar.');
    process.exit(0);
  }
  if (!cambios.length) process.exit(0);

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `firmas-visita2-actas-${respaldo.fecha.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(respaldo));
  console.log(`Respaldo: ${archivo}`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of cambios) {
      const extra = c.tabla === 'otros_formatos' ? ', pdf_path = NULL' : '';
      await client.query(`UPDATE ${c.tabla} SET datos = $2::jsonb, updated_at = NOW()${extra} WHERE id = $1`, [c.id, JSON.stringify(c.datos)]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`✔ ${cambios.length} acta(s) actualizadas.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
