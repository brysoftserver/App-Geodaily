// ============================================================
// DIAGNÓSTICO (SOLO LECTURA) — Fotos/videos con minio_path desfasado
// ============================================================
// No hace ningún UPDATE/DELETE/INSERT ni llama a MinIO. Solo lee de
// Postgres, recalcula con las mismas funciones de src/storage.js cuál
// DEBERÍA ser la ruta correcta, y compara contra la ruta guardada.
//
// Uso: node scripts/diagnostico-fotos-desfase.js
// Uso (un técnico puntual): node scripts/diagnostico-fotos-desfase.js jmorales
// ============================================================

require('dotenv').config();
const db = require('../src/database');
const storage = require('../src/storage');

async function main() {
  const filtroUsuario = process.argv[2] || null;

  const params = [];
  let where = `a.tipo IN ('foto', 'video')`;
  if (filtroUsuario) {
    params.push(filtroUsuario);
    where += ` AND u.usuario = $${params.length}`;
  }

  const rows = await db.queryAll(
    `SELECT
        a.id,
        a.formulario_id,
        a.usuario_id,
        a.tipo,
        a.filename,
        a.minio_path,
        a.created_at,
        COALESCE(a.metadata_json->>'beneficiario_cedula', f.beneficiario_json->>'cedula') AS cedula,
        f.tipo AS tipo_formulario,
        u.usuario AS username,
        u.rol AS rol
      FROM archivos a
      LEFT JOIN formularios f ON f.id = a.formulario_id
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${where}
      ORDER BY u.usuario, a.formulario_id, a.created_at`,
    params
  );

  console.log(`\nTotal de archivos foto/video revisados: ${rows.length}\n`);

  const sinDatos = [];
  const mal = [];
  const ok = [];

  for (const row of rows) {
    if (!row.username || !row.rol) {
      sinDatos.push({ ...row, motivo: 'usuario no resuelto' });
      continue;
    }
    if (!row.cedula) {
      sinDatos.push({ ...row, motivo: 'sin cédula de beneficiario (huérfana real, no vinculada a ningún formulario con beneficiario)' });
      continue;
    }

    const benef = await db.queryOne(
      'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
      [row.cedula.trim()]
    );
    if (!benef) {
      sinDatos.push({ ...row, motivo: `cédula ${row.cedula} no encontrada en tabla beneficiarios` });
      continue;
    }

    const carpetaTipo = row.tipo === 'video' ? 'videos' : 'fotos';
    const rutaEsperada = storage.getBeneficiaryFilePath(
      row.rol,
      row.username,
      benef.item,
      benef.nombre_completo,
      row.tipo_formulario,
      carpetaTipo,
      row.filename
    );

    if (rutaEsperada === row.minio_path) {
      ok.push(row);
    } else {
      mal.push({
        ...row,
        beneficiario_item: benef.item,
        beneficiario_nombre: benef.nombre_completo,
        ruta_actual: row.minio_path,
        ruta_esperada: rutaEsperada,
      });
    }
  }

  console.log(`✅ Bien ubicados: ${ok.length}`);
  console.log(`⚠️  Mal ubicados (candidatos a reubicar):  ${mal.length}`);
  console.log(`❓ Sin datos suficientes para determinar:  ${sinDatos.length}\n`);

  if (mal.length > 0) {
    console.log('--- MAL UBICADOS ---');
    for (const m of mal) {
      console.log(
        `[${m.tipo}] archivo ${m.id} | usuario=${m.username} | beneficiario=${m.beneficiario_item}_${m.beneficiario_nombre} | formulario=${m.formulario_id || '(sin vincular)'}`
      );
      console.log(`   actual:   ${m.ruta_actual}`);
      console.log(`   esperado: ${m.ruta_esperada}\n`);
    }
  }

  if (sinDatos.length > 0) {
    console.log('--- SIN DATOS SUFICIENTES (revisar manualmente) ---');
    for (const s of sinDatos) {
      console.log(`[${s.tipo}] archivo ${s.id} | usuario=${s.username || s.usuario_id} | formulario=${s.formulario_id || '(sin vincular)'} | motivo: ${s.motivo}`);
    }
  }

  console.log('\nResumen por técnico (mal ubicados):');
  const porTecnico = {};
  for (const m of mal) {
    porTecnico[m.username] = (porTecnico[m.username] || 0) + 1;
  }
  for (const [u, n] of Object.entries(porTecnico)) {
    console.log(`  ${u}: ${n}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error en diagnóstico:', err);
  process.exit(1);
});
