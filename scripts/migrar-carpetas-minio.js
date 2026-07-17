#!/usr/bin/env node
// ============================================================
// Script de migración: Crear estructura de carpetas en MinIO
// para todos los beneficiarios con técnico asignado.
//
// Uso: node scripts/migrar-carpetas-minio.js
// ============================================================

const path = require('path');

// Cargar variables de entorno — probar backend/.env primero, luego .env raíz
const envPaths = [
  path.join(__dirname, '..', 'backend', '.env'),
  path.join(__dirname, '..', '.env'),
];
for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
  } catch {
    // dotenv no instalado o archivo no existe
  }
}

const storage = require('../backend/src/storage');

// Conexión directa a PostgreSQL
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'geodaily',
  max: 5,
});

async function migrar() {
  console.log('==================================================');
  console.log('  Migración: Carpetas MinIO por beneficiario');
  console.log('==================================================\n');

  let client;
  try {
    client = await pool.connect();
    console.log('✅ Conectado a PostgreSQL\n');

    // Obtener todos los beneficiarios con técnico asignado
    const result = await client.query(`
      SELECT b.item, b.nombre_completo, b.tecnico_asignado_id,
             u.usuario, u.rol
      FROM beneficiarios b
      JOIN usuarios u ON u.id = b.tecnico_asignado_id
      WHERE b.tecnico_asignado_id IS NOT NULL
        AND u.activo = TRUE
      ORDER BY b.item
    `);

    const asignados = result.rows;
    console.log(`📋 Beneficiarios con técnico asignado: ${asignados.length}\n`);

    if (asignados.length === 0) {
      console.log('⚠️  No hay beneficiarios con técnico asignado. Nada que migrar.');
      return;
    }

    let exitosos = 0;
    let fallidos = 0;

    for (const benef of asignados) {
      try {
        // Crear carpetas para ambos tipos de formulario
        for (const tipoForm of ['caracterizacion', 'visita_tecnica']) {
          await storage.createBeneficiaryFolders(
            benef.rol,
            benef.usuario,
            benef.item,
            benef.nombre_completo,
            tipoForm
          );
        }
        console.log(`  ✅ ${benef.item} — ${benef.nombre_completo} → ${benef.usuario}`);
        exitosos++;
      } catch (err) {
        console.error(`  ❌ ${benef.item} — ${benef.nombre_completo}: ${err.message}`);
        fallidos++;
      }
    }

    console.log('\n==================================================');
    console.log(`  ✅ Exitosos: ${exitosos}`);
    console.log(`  ❌ Fallidos: ${fallidos}`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('❌ Error de conexión:', err.message);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

migrar().then(() => {
  console.log('Migración completada.');
  process.exit(0);
}).catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
