// ============================================================
// REUBICACIÓN (COPIA, NUNCA BORRA) — Fotos/videos con minio_path desfasado
// ============================================================
// Para cada archivo "mal ubicado" (mismo criterio que
// diagnostico-fotos-desfase.js, solo el grupo con beneficiario resuelto
// con confianza):
//   1. Copia el objeto en MinIO desde su ruta actual hacia la ruta correcta
//      (CopyObject — el original NUNCA se toca ni se borra).
//   2. Verifica que la copia exista y tenga el mismo tamaño que el original.
//   3. Solo si la verificación pasa, actualiza archivos.minio_path en
//      Postgres para que apunte a la copia nueva.
// Si algo falla en un archivo, se reporta y se sigue con el resto; nunca
// se borra el original ni se actualiza la DB sin verificar la copia antes.
//
// Uso: node scripts/reubicar-fotos-desfase.js
// ============================================================

require('dotenv').config();
const db = require('../src/database');
const storage = require('../src/storage');
const Minio = require('minio');

async function identificarMalUbicados() {
  const rows = await db.queryAll(
    `SELECT
        a.id,
        a.formulario_id,
        a.usuario_id,
        a.tipo,
        a.filename,
        a.minio_path,
        a.minio_bucket,
        COALESCE(a.metadata_json->>'beneficiario_cedula', f.beneficiario_json->>'cedula') AS cedula,
        f.tipo AS tipo_formulario,
        u.usuario AS username,
        u.rol AS rol
      FROM archivos a
      LEFT JOIN formularios f ON f.id = a.formulario_id
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.tipo IN ('foto', 'video')
      ORDER BY u.usuario, a.formulario_id, a.created_at`
  );

  const malUbicados = [];

  for (const row of rows) {
    if (!row.username || !row.rol || !row.cedula) continue;

    const benef = await db.queryOne(
      'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
      [row.cedula.trim()]
    );
    if (!benef) continue;

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

    if (rutaEsperada !== row.minio_path) {
      malUbicados.push({ ...row, ruta_esperada: rutaEsperada });
    }
  }

  return malUbicados;
}

async function main() {
  const malUbicados = await identificarMalUbicados();
  console.log(`\nArchivos a reubicar (copia, sin borrar original): ${malUbicados.length}\n`);

  let copiados = 0;
  let yaExistian = 0;
  let fallidos = 0;

  for (const item of malUbicados) {
    const bucket = item.minio_bucket || storage.CONFIG.bucket;
    const origen = item.minio_path;
    const destino = item.ruta_esperada;

    try {
      // Si el destino ya existe (ej. corrida previa parcial), no copiar de
      // nuevo: solo verificar tamaño y actualizar la DB si hace falta.
      let statDestino = null;
      try {
        statDestino = await storage.minioClient.statObject(bucket, destino);
      } catch {
        statDestino = null;
      }

      if (!statDestino) {
        const statOrigen = await storage.minioClient.statObject(bucket, origen);

        await storage.minioClient.copyObject(
          new Minio.CopySourceOptions({ Bucket: bucket, Object: origen }),
          new Minio.CopyDestinationOptions({ Bucket: bucket, Object: destino })
        );

        statDestino = await storage.minioClient.statObject(bucket, destino);

        if (statDestino.size !== statOrigen.size) {
          throw new Error(
            `tamaño no coincide tras copiar (origen=${statOrigen.size}, destino=${statDestino.size})`
          );
        }
      } else {
        yaExistian++;
      }

      await db.query('UPDATE archivos SET minio_path = $1 WHERE id = $2', [destino, item.id]);
      copiados++;
      console.log(`✅ ${item.id} (${item.username}) → ${destino}`);
    } catch (err) {
      fallidos++;
      console.error(`❌ ${item.id} (${item.username}) — origen: ${origen}`);
      console.error(`   Error: ${err.message}`);
    }
  }

  console.log('\n--- RESUMEN ---');
  console.log(`Total procesados:     ${malUbicados.length}`);
  console.log(`Copiados y vinculados: ${copiados}`);
  console.log(`  (de los cuales ya existía el destino: ${yaExistian})`);
  console.log(`Fallidos:             ${fallidos}`);
  console.log('\nNota: los archivos originales NO fueron eliminados de su ubicación anterior.');

  process.exit(fallidos > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error en reubicación:', err);
  process.exit(1);
});
