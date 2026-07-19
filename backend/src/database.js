// ============================================================
// GEODAILY — Conexión a PostgreSQL
// ============================================================

const { Pool } = require('pg');

if (!process.env.PG_PASSWORD) {
  throw new Error('PG_PASSWORD no configurado. Define la variable de entorno PG_PASSWORD antes de iniciar el servidor.');
}

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB || 'geodaily',
  user: process.env.PG_USER || 'geodaily_admin',
  password: process.env.PG_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en el pool:', err.message);
});

/**
 * Consulta helper: ejecuta SQL con parámetros
 */
async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`[DB] Consulta lenta (${duration}ms):`, text.slice(0, 100));
  }
  return result;
}

/**
 * Obtener un solo registro
 */
async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/**
 * Obtener todos los registros
 */
async function queryAll(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Insertar y retornar el registro creado
 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.map(k => `"${k}"`).join(', ');
  const sql = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING *`;
  const result = await query(sql, values);
  return result.rows[0];
}

/**
 * Actualizar y retornar
 */
async function update(table, data, whereColumn, whereValue) {
  const keys = Object.keys(data);
  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values = [...Object.values(data), whereValue];
  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')}, updated_at = NOW() WHERE "${whereColumn}" = $${keys.length + 1} RETURNING *`;
  const result = await query(sql, values);
  return result.rows[0] || null;
}

/**
 * Eliminar
 */
async function remove(table, whereColumn, whereValue) {
  const sql = `DELETE FROM "${table}" WHERE "${whereColumn}" = $1 RETURNING *`;
  const result = await query(sql, [whereValue]);
  return result.rows[0] || null;
}

/**
 * Inicializar esquema de base de datos
 * Crea todas las tablas si no existen
 */
async function initSchema() {
  console.log('[DB] Inicializando esquema de base de datos...');

  const tables = [
    `CREATE TABLE IF NOT EXISTS usuarios (
      id VARCHAR(20) PRIMARY KEY,
      usuario VARCHAR(100) UNIQUE NOT NULL,
      contrasena TEXT NOT NULL,
      nombre VARCHAR(200) NOT NULL,
      cedula VARCHAR(20) DEFAULT '',
      email VARCHAR(200) DEFAULT '',
      rol VARCHAR(20) NOT NULL CHECK (rol IN ('tecnico','supervisor','interventor','gerente','admin')),
      telefono VARCHAR(20) DEFAULT '',
      activo BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS formularios (
      id VARCHAR(100) PRIMARY KEY,
      tipo VARCHAR(50) NOT NULL,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      datos JSONB NOT NULL DEFAULT '{}',
      sincronizado BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS archivos (
      id VARCHAR(100) PRIMARY KEY,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('foto','video','pdf','documento','firma')),
      nombre_original TEXT NOT NULL,
      nombre_almacenado TEXT NOT NULL,
      ruta_minio TEXT NOT NULL,
      mimetype VARCHAR(100) DEFAULT '',
      tamaño BIGINT DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS tracking (
      id SERIAL PRIMARY KEY,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      latitud DECIMAL(10,7) NOT NULL,
      longitud DECIMAL(10,7) NOT NULL,
      altitud DECIMAL(10,4),
      precision_gps DECIMAL(5,2),
      velocidad DECIMAL(5,2),
      timestamp_dispositivo TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS mediciones (
      id VARCHAR(100) PRIMARY KEY,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      tipo_medicion VARCHAR(50) NOT NULL,
      valor DECIMAL(12,4),
      unidad VARCHAR(20),
      latitud DECIMAL(10,7),
      longitud DECIMAL(10,7),
      datos JSONB DEFAULT '{}',
      timestamp_dispositivo TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS plantaciones (
      id VARCHAR(100) PRIMARY KEY,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      especie VARCHAR(200),
      cantidad INTEGER DEFAULT 1,
      latitud DECIMAL(10,7),
      longitud DECIMAL(10,7),
      datos JSONB DEFAULT '{}',
      timestamp_dispositivo TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS visitas_programadas (
      id VARCHAR(100) PRIMARY KEY,
      usuario_id VARCHAR(20) REFERENCES usuarios(id),
      titulo VARCHAR(200),
      ubicacion VARCHAR(200),
      fecha DATE NOT NULL,
      estado VARCHAR(20) DEFAULT 'pendiente',
      timestamp_dispositivo TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS actividad_log (
      id SERIAL PRIMARY KEY,
      usuario_id VARCHAR(20),
      accion VARCHAR(100) NOT NULL,
      detalle_json JSONB DEFAULT '{}',
      ip VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS beneficiarios (
      item INTEGER PRIMARY KEY,
      corregimiento VARCHAR(100) NOT NULL,
      vereda VARCHAR(100) NOT NULL,
      nombre_completo VARCHAR(200) NOT NULL,
      cedula VARCHAR(30) NOT NULL,
      tecnico_asignado_id VARCHAR(20),
      tecnico_asignado_nombre VARCHAR(200),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS revisiones_formulario (
      id SERIAL PRIMARY KEY,
      formulario_id VARCHAR(100) NOT NULL,
      revisor_id VARCHAR(20) NOT NULL,
      revisor_nombre VARCHAR(200),
      revisor_rol VARCHAR(20) NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      comentario TEXT,
      datos_formulario_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_revisiones_formulario ON revisiones_formulario(formulario_id)`,

    `CREATE INDEX IF NOT EXISTS idx_formularios_usuario ON formularios(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_formularios_tipo ON formularios(tipo)`,
    `CREATE INDEX IF NOT EXISTS idx_formularios_created ON formularios(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_archivos_usuario ON archivos(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_archivos_tipo ON archivos(tipo)`,
    `CREATE INDEX IF NOT EXISTS idx_tracking_usuario ON tracking(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mediciones_usuario ON mediciones(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_plantaciones_usuario ON plantaciones(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actividad_usuario ON actividad_log(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actividad_created ON actividad_log(created_at)`,
  ];

  for (const sql of tables) {
    try {
      await query(sql);
    } catch (err) {
      console.error(`[DB] Error creando tabla/índice:`, err.message);
      console.error(`[DB] SQL:`, sql.slice(0, 200));
    }
  }

  // Migración: agregar tecnico_json a formularios (para el agrupamiento
  // de visitas por técnico en el listado jerárquico de roles superiores)
  try {
    await query(`ALTER TABLE formularios ADD COLUMN tecnico_json JSONB DEFAULT '{}'::jsonb`);
    console.log('[DB] ✅ Columna tecnico_json agregada a formularios');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando tecnico_json:', err.message);
    }
  }

  // Migración: vincular las evidencias (fotos/videos) a su formulario.
  // Sin esta columna no se pueden recuperar las evidencias de una visita
  // desde otro dispositivo — la app solo guarda la ruta local del teléfono
  // que las capturó.
  try {
    await query(`ALTER TABLE archivos ADD COLUMN formulario_id TEXT`);
    console.log('[DB] ✅ Columna formulario_id agregada a archivos');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando formulario_id a archivos:', err.message);
    }
  }

  try {
    await query(`CREATE INDEX IF NOT EXISTS idx_archivos_formulario ON archivos(formulario_id)`);
  } catch (err) {
    console.error('[DB] Error creando índice idx_archivos_formulario:', err.message);
  }

  // Backfill: las evidencias subidas antes de esta versión no traen
  // formulario_id, pero la app guardaba el id en metadata_json->>'nombre'
  // con el formato "Formulario <id>" o "Encuesta <id>". Se recupera de ahí
  // para que las visitas históricas también se puedan revisar desde otro
  // dispositivo. Solo toca filas sin formulario_id.
  try {
    // El EXISTS es obligatorio: archivos.formulario_id tiene FK a
    // formularios(id), así que solo se vinculan los que realmente existen
    // (un borrador que nunca se sincronizó no tiene fila).
    const res = await query(
      `UPDATE archivos a
          SET formulario_id = substring(a.metadata_json->>'nombre' from '^(?:Formulario|Encuesta) (.+)$')
        WHERE a.formulario_id IS NULL
          AND a.metadata_json->>'nombre' ~ '^(?:Formulario|Encuesta) .+$'
          AND EXISTS (
            SELECT 1 FROM formularios f
             WHERE f.id = substring(a.metadata_json->>'nombre' from '^(?:Formulario|Encuesta) (.+)$')
          )`
    );
    if (res?.rowCount > 0) {
      console.log(`[DB] ✅ Backfill: ${res.rowCount} evidencia(s) vinculadas a su formulario`);
    }
  } catch (err) {
    console.error('[DB] Error en backfill de archivos.formulario_id:', err.message);
  }

  await seedBeneficiarios();

  console.log('[DB] ✅ Esquema de base de datos inicializado');
}

// Siembra inicial de los 300 beneficiarios del proyecto (una sola vez,
// solo si la tabla está vacía). Fuente: data/beneficiarios-seed.json,
// generado desde la base de datos oficial del proyecto.
async function seedBeneficiarios() {
  try {
    const { count } = await queryOne('SELECT COUNT(*)::int AS count FROM beneficiarios');
    if (count > 0) return;

    const seed = require('./data/beneficiarios-seed.json');
    for (const b of seed) {
      await query(
        `INSERT INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (item) DO NOTHING`,
        [b.item, b.corregimiento, b.vereda, b.nombre_completo, b.cedula]
      );
    }
    console.log(`[DB] ✅ Beneficiarios sembrados: ${seed.length}`);
  } catch (err) {
    console.error('[DB] Error sembrando beneficiarios:', err.message);
  }
}

module.exports = {
  pool,
  query,
  queryOne,
  queryAll,
  insert,
  update,
  remove,
  initSchema,
};
