#!/bin/bash
# ============================================================
# LIMPIEZA TOTAL — GEODAILY
# Elimina TODOS los formularios, archivos, fotos, tracking,
# borradores y datos de prueba para empezar desde CERO.
# ============================================================
set -e

echo "========================================"
echo "🧹 LIMPIEZA TOTAL — GEODAILY"
echo "========================================"

# ─── 1. PostgreSQL (backend) ────────────────────────────────
echo ""
echo "[1/4] 🐘 Limpiando PostgreSQL..."
cd "$(dirname "$0")/../backend"

# Eliminar datos de todas las tablas (pero preservar usuarios y estructura)
node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'geodaily_admin',
  password: process.env.PG_PASSWORD || 'GeoDaily2026_S3gura!',
  database: process.env.PG_DB || 'geodaily',
});

async function clean() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Orden importante: respetar FK
    await client.query('DELETE FROM actividad_log');
    await client.query('DELETE FROM archivos');
    await client.query('DELETE FROM tracking');
    await client.query('DELETE FROM mediciones');
    await client.query('DELETE FROM plantaciones');
    await client.query('DELETE FROM formularios');

    await client.query('COMMIT');
    console.log('  ✅ PostgreSQL: formularios, archivos, tracking, mediciones, plantaciones, actividad_log eliminados');
    console.log('  ℹ️  Usuarios preservados');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
clean();
"

# ─── 2. SQLite Local (geodaily.db) ──────────────────────────
echo ""
echo "[2/4] 📱 Limpiando SQLite local..."
if [ -f "../geodaily.db" ]; then
  sqlite3 ../geodaily.db <<'EOSQL'
  DELETE FROM formularios;
  DELETE FROM sync_queue;
  DELETE FROM fotos_locales;
  DELETE FROM documentos_finca;
  DELETE FROM tracking_posiciones;
  DELETE FROM mediciones_terreno;
  DELETE FROM plantaciones;
  DELETE FROM conteo_plantas;
  VACUUM;
EOSQL
  echo "  ✅ SQLite: todas las tablas de datos limpiadas"
else
  echo "  ⚠️  geodaily.db no encontrado en raíz"
fi

# También buscar en otras ubicaciones comunes
for dbpath in $(find /opt/App-movil -name "geodaily.db" -not -path "*/node_modules/*" 2>/dev/null); do
  echo "  📍 Encontrado: $dbpath"
  sqlite3 "$dbpath" <<'EOSQL'
  DELETE FROM formularios;
  DELETE FROM sync_queue;
  DELETE FROM fotos_locales;
  DELETE FROM documentos_finca;
  DELETE FROM tracking_posiciones;
  DELETE FROM mediciones_terreno;
  DELETE FROM plantaciones;
  DELETE FROM conteo_plantas;
  VACUUM;
EOSQL
  echo "  ✅ Limpiado: $dbpath"
done

# ─── 3. MinIO (storage) ─────────────────────────────────────
echo ""
echo "[3/4] ☁️  Limpiando MinIO..."
node -e "
const Minio = require('minio');

const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'geodaily_admin',
  secretKey: process.env.MINIO_SECRET || 'GeoDaily2026_M1n10!',
});

const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';

async function cleanMinIO() {
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      console.log('  ⚠️  Bucket no existe, se creará al subir archivos');
      return;
    }

    // Listar y eliminar todos los objetos
    let total = 0;
    const stream = client.listObjects(bucket, '', true);
    for await (const obj of stream) {
      await client.removeObject(bucket, obj.name);
      total++;
    }
    console.log('  ✅ MinIO: ' + total + ' objetos eliminados del bucket ' + bucket);
  } catch (err) {
    console.log('  ⚠️  MinIO no disponible:', err.message);
    console.log('  ℹ️  Puedes limpiar manualmente desde la consola MinIO');
  }
}
cleanMinIO();
"

# ─── 4. Backend uploads ─────────────────────────────────────
echo ""
echo "[4/4] 📁 Limpiando uploads locales..."
rm -rf ../uploads/fotos/*
rm -rf ../uploads/pdfs/*
rm -rf ../uploads/videos/*
rm -rf ../uploads/documentos/*
echo "  ✅ Uploads locales limpiados"

echo ""
echo "========================================"
echo "✅ LIMPIEZA COMPLETADA"
echo "========================================"
echo ""
echo "Resumen:"
echo "  • PostgreSQL: formularios, archivos, tracking, mediciones, plantaciones, logs → ELIMINADOS"
echo "  • SQLite local: formularios, fotos, documentos, tracking, mediciones → ELIMINADOS"
echo "  • MinIO: todos los objetos → ELIMINADOS"
echo "  • Uploads locales → LIMPIOS"
echo ""
echo "⚠️  Los USUARIOS se conservan para que puedas iniciar sesión."
echo "⚠️  Las ESTRUCTURAS de tablas se conservan."
echo "⚠️  Borradores en SecureStore/AsyncStorage se limpian al reinstalar la app."
echo ""
echo "¡Todo listo para pruebas desde 0! 🚀"
