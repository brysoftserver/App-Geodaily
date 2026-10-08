// ============================================================
// GEODAILY — Conexión a PostgreSQL
// ============================================================

const { Pool, types } = require('pg');

if (!process.env.PG_PASSWORD) {
  throw new Error('PG_PASSWORD no configurado. Define la variable de entorno PG_PASSWORD antes de iniciar el servidor.');
}

// El driver pg convierte las columnas DATE (OID 1082) a un objeto Date de
// JS por defecto. Al serializar a JSON eso produce
// "2026-07-31T00:00:00.000Z" en vez de "2026-07-31" — la app compara
// fechas como texto plano (p. ej. contra el dateString del calendario), así
// que la comparación fallaba en silencio y la visita programada nunca
// aparecía tras recargar desde el servidor. Se deja el valor tal como lo
// entrega Postgres (YYYY-MM-DD) sin conversión.
types.setTypeParser(1082, (val) => val);

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
      rol VARCHAR(20) NOT NULL CHECK (rol IN ('tecnico','coordinador','interventor','gerente','admin')),
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Veredas vienen de Overpass (OpenStreetMap) o de un fallback
    // hardcodeado en maps.js — no existen como tabla propia, así que no se
    // pueden "eliminar" de verdad. Esto es un soft-hide: el admin oculta una
    // vereda de la vista de la app sin tocar el dato de origen (que igual
    // reaparecería en el próximo fetch a Overpass).
    `CREATE TABLE IF NOT EXISTS veredas_excluidas (
      id TEXT PRIMARY KEY,
      nombre TEXT,
      excluida_por VARCHAR(20),
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
      beneficiario_cedula VARCHAR(30),
      beneficiario_nombre VARCHAR(200),
      actividad_numero INTEGER,
      vereda VARCHAR(200),
      corregimiento VARCHAR(200),
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

    `CREATE TABLE IF NOT EXISTS notificaciones (
      id SERIAL PRIMARY KEY,
      usuario_id VARCHAR(20) NOT NULL,
      tipo VARCHAR(50) NOT NULL,
      titulo VARCHAR(200) NOT NULL,
      mensaje TEXT,
      formulario_id VARCHAR(100),
      leida BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(usuario_id, leida)`,

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

    // Configuración global clave-valor (ej. la API key de DeepSeek para el
    // análisis con IA de las gráficas del PDF del Dashboard). Solo el admin
    // la lee/escribe vía /api/ia/config.
    `CREATE TABLE IF NOT EXISTS configuracion_sistema (
      clave VARCHAR(100) PRIMARY KEY,
      valor TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // "Tumbas" de formularios borrados. POST /formularios/guardar es un
    // upsert por id: sin este registro, cualquier dispositivo que aún
    // conserve en su SQLite local un formulario que el admin ya borró en el
    // servidor lo vuelve a subir en su próximo ciclo de sync, y el upsert lo
    // recrea como si fuera nuevo. Con la tumba, ese POST se rechaza en vez
    // de resucitar el registro.
    `CREATE TABLE IF NOT EXISTS formularios_eliminados (
      id VARCHAR(100) PRIMARY KEY,
      eliminado_por VARCHAR(20),
      eliminado_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS formularios_borradores (
      id VARCHAR(100) PRIMARY KEY,
      usuario_id VARCHAR(20) NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      payload_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_formularios_borradores_usuario ON formularios_borradores(usuario_id, updated_at DESC)`,

    // "Tumbas" de evidencias (foto/video) borradas individualmente desde el
    // detalle del formulario por un admin/coordinador. El teléfono que capturó
    // la foto conserva el archivo local, así que sin este registro podría
    // volver a mostrarla o a subirla en un sync posterior; además sirve para
    // filtrarla del fotos_json aunque otro dispositivo reenvíe el formulario
    // completo (POST /guardar es un upsert por id).
    `CREATE TABLE IF NOT EXISTS evidencias_eliminadas (
      id SERIAL PRIMARY KEY,
      -- TEXT, no INTEGER: archivos.id es uuid (ver docs/schema-actual.sql).
      archivo_id TEXT,
      formulario_id VARCHAR(100),
      evidencia_local_id VARCHAR(100),
      minio_path TEXT,
      eliminado_por VARCHAR(20),
      eliminado_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_evidencias_eliminadas_formulario ON evidencias_eliminadas(formulario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_evidencias_eliminadas_local ON evidencias_eliminadas(evidencia_local_id)`,
  ];

  for (const sql of tables) {
    try {
      await query(sql);
    } catch (err) {
      console.error(`[DB] Error creando tabla/índice:`, err.message);
      console.error(`[DB] SQL:`, sql.slice(0, 200));
    }
  }

  // Migración: la tabla evidencias_eliminadas se creó con archivo_id INTEGER,
  // pero archivos.id es uuid (ver docs/schema-actual.sql). El INSERT de la
  // tumba fallaba con 22P02 ("invalid input syntax for type integer") y por
  // eso el DELETE de una evidencia devolvía 500. TEXT coincide además con las
  // columnas vecinas (formulario_id, evidencia_local_id, minio_path). Se lee
  // el tipo real antes de alterar para que la migración sea idempotente.
  try {
    const tipoActual = await query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'evidencias_eliminadas' AND column_name = 'archivo_id'`
    );
    const tipo = tipoActual.rows[0]?.data_type;
    if (tipo && tipo !== 'text') {
      await query(`ALTER TABLE evidencias_eliminadas
        ALTER COLUMN archivo_id TYPE TEXT USING archivo_id::text`);
      console.log('[DB] ✅ evidencias_eliminadas.archivo_id migrado de', tipo, 'a TEXT');
    }
  } catch (err) {
    console.error('[DB] Error migrando evidencias_eliminadas.archivo_id:', err.message);
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

  // Migración: columnas de detalle de las visitas programadas.
  //
  // La tabla se creó originalmente solo con (id, usuario_id, titulo,
  // ubicacion, fecha, estado, timestamp_dispositivo, created_at). El
  // `CREATE TABLE IF NOT EXISTS visitas_programadas` de arriba ya incluye
  // estas 5 columnas, pero NO las añade a una tabla que YA existe — así que
  // en producción nunca se crearon. Consecuencia:
  //   • GET /api/visitas-programadas → 500 "column vp.beneficiario_cedula
  //     does not exist" → el calendario caía al SQLite local y cada rol
  //     veía solo SUS visitas planificadas.
  //   • POST /api/visitas-programadas/sync → fallaba igual, así que las
  //     visitas que programaba un técnico se quedaban para siempre en su
  //     teléfono y ningún rol superior las veía.
  // Idempotente: ADD COLUMN IF NOT EXISTS se puede correr en cada arranque.
  const columnasVisitasProgramadas = [
    ['beneficiario_cedula', 'VARCHAR(30)'],
    ['beneficiario_nombre', 'VARCHAR(200)'],
    ['actividad_numero', 'INTEGER'],
    ['vereda', 'VARCHAR(200)'],
    ['corregimiento', 'VARCHAR(200)'],
  ];
  for (const [col, tipo] of columnasVisitasProgramadas) {
    try {
      await query(`ALTER TABLE visitas_programadas ADD COLUMN IF NOT EXISTS ${col} ${tipo}`);
    } catch (err) {
      console.error(`[DB] Error agregando ${col} a visitas_programadas:`, err.message);
    }
  }
  console.log('[DB] ✅ Columnas de detalle verificadas en visitas_programadas');

  try {
    await query(`CREATE INDEX IF NOT EXISTS idx_visitas_programadas_fecha ON visitas_programadas(fecha)`);
  } catch (err) {
    console.error('[DB] Error creando índice idx_visitas_programadas_fecha:', err.message);
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

  // Migración: columna contrasena_visible en usuarios para que el admin
  // pueda consultar la contraseña actual de cada usuario. No es un hash
  // sino el texto plano, porque el admin necesita poder verla y comunicarla
  // a los técnicos. Solo accesible por admin vía GET /api/auth/usuarios.
  try {
    await query(`ALTER TABLE usuarios ADD COLUMN contrasena_visible TEXT DEFAULT ''`);
    console.log('[DB] ✅ Columna contrasena_visible agregada a usuarios');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando contrasena_visible:', err.message);
    }
  }

  // Migración: foto de perfil (avatar) por usuario. Antes solo se guardaba
  // en el filesystem local del dispositivo (avatar.service.ts) — nunca
  // llegaba al servidor, así que un técnico veía su propia foto pero nadie
  // más (ej. el admin en "Gestión de Usuarios") la veía jamás. Se guarda
  // el id del archivo (tabla `archivos`, ya usada para fotos/firmas/PDF)
  // que contiene el binario subido a MinIO.
  try {
    await query(`ALTER TABLE usuarios ADD COLUMN avatar_archivo_id TEXT`);
    console.log('[DB] ✅ Columna avatar_archivo_id agregada a usuarios');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando avatar_archivo_id:', err.message);
    }
  }

  // Migración: permitir tipo 'avatar' en archivos.tipo (antes solo
  // foto/video/firma/pdf/capacitacion/other). Idempotente: se puede correr
  // en cada arranque sin error.
  try {
    await query(`ALTER TABLE archivos DROP CONSTRAINT IF EXISTS archivos_tipo_check`);
    await query(`ALTER TABLE archivos ADD CONSTRAINT archivos_tipo_check
      CHECK (tipo IN ('foto','video','pdf','documento','firma','capacitacion','other','avatar'))`);
    console.log('[DB] ✅ Constraint archivos_tipo_check actualizado (admite avatar)');
  } catch (err) {
    console.error('[DB] Error actualizando archivos_tipo_check:', err.message);
  }

  // Migración: columna seccion en revisiones_formulario — permite marcar
  // Novedad/Aprobado por cada sección del formulario clonado (en vez de
  // solo a nivel de formulario completo). NULL = revisión de todo el
  // formulario (compatibilidad con registros anteriores).
  try {
    await query(`ALTER TABLE revisiones_formulario ADD COLUMN seccion VARCHAR(100)`);
    console.log('[DB] ✅ Columna seccion agregada a revisiones_formulario');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando seccion a revisiones_formulario:', err.message);
    }
  }

  // Tabla: evidencia final del revisor (coordinador/interventor) — una fila
  // por formulario + rol revisor: fotos propias, video, firma dual
  // (beneficiario + revisor) y una georeferencia puntual (captura única,
  // no tracking). fotos_json/videos_json guardan [{ archivo_id }] —
  // referencias a la tabla `archivos` (subidas a MinIO), no los binarios.
  try {
    await query(`CREATE TABLE IF NOT EXISTS revision_evidencia_formulario (
      id SERIAL PRIMARY KEY,
      formulario_id VARCHAR(100) NOT NULL,
      revisor_id VARCHAR(20) NOT NULL,
      revisor_nombre VARCHAR(200),
      revisor_rol VARCHAR(20) NOT NULL,
      fotos_json JSONB DEFAULT '[]',
      videos_json JSONB DEFAULT '[]',
      firma_beneficiario TEXT,
      firma_revisor TEXT,
      geo_latitud DECIMAL(10,7),
      geo_longitud DECIMAL(10,7),
      geo_altitud DECIMAL(10,2),
      observaciones TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(formulario_id, revisor_rol)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_revision_evidencia_formulario ON revision_evidencia_formulario(formulario_id)`);
  } catch (err) {
    console.error('[DB] Error creando revision_evidencia_formulario:', err.message);
  }

  // Migración: columna videos_json en revision_evidencia_formulario —
  // la tabla ya existía sin ella en instalaciones previas a esta versión.
  // firma_beneficiario/firma_revisor pasan de guardar base64 crudo a
  // guardar el id del archivo subido a MinIO (más liviano y consistente
  // con cómo el técnico guarda sus propias firmas); el renderizado en la
  // app sigue soportando registros viejos en base64 para no romperlos.
  try {
    await query(`ALTER TABLE revision_evidencia_formulario ADD COLUMN videos_json JSONB DEFAULT '[]'`);
    console.log('[DB] ✅ Columna videos_json agregada a revision_evidencia_formulario');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando videos_json a revision_evidencia_formulario:', err.message);
    }
  }

  // Migración: columnas de la base verificada de 300 beneficiarios
  // (Base_de_datos_beneficiarios/300 beneficiarios final.csv) — antes la
  // tabla solo tenía corregimiento/vereda/nombre/cedula; el listado
  // verificado trae además ubicación administrativa, contacto y predio.
  const columnasBeneficiarios300 = [
    ['departamento', 'VARCHAR(100)'],
    ['municipio', 'VARCHAR(100)'],
    ['telefono', 'VARCHAR(50)'],
    ['nombre_predio', 'VARCHAR(150)'],
    ['area_predio', 'NUMERIC(10,2)'],
    ['latitud', 'NUMERIC(10,7)'],
    ['longitud', 'NUMERIC(10,7)'],
    // Capturados al diligenciar el Acta de Compromiso (Otros Formatos) —
    // no venían en la base verificada de 300 beneficiarios.
    ['correo_electronico', 'VARCHAR(150)'],
    ['calidad_predio', 'VARCHAR(20)'],
  ];
  for (const [col, tipo] of columnasBeneficiarios300) {
    try {
      await query(`ALTER TABLE beneficiarios ADD COLUMN ${col} ${tipo}`);
      console.log(`[DB] ✅ Columna ${col} agregada a beneficiarios`);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error(`[DB] Error agregando ${col} a beneficiarios:`, err.message);
      }
    }
  }

  // Migración: id de evidencia local (generado en el celular al capturar la
  // foto/video, ver generarId() en utils/formatters.ts — un UUID). Permite
  // deduplicar subidas reintentadas: si el servidor ya recibió y guardó la
  // evidencia pero la respuesta no llegó a tiempo al teléfono (timeout con
  // señal débil, o la app se cerró antes de marcarla como sincronizada), la
  // app la reintentaba en el siguiente ciclo y quedaba duplicada en
  // `archivos`. Con este índice, el segundo intento del mismo id se
  // reconoce y no crea una fila nueva.
  try {
    await query(`ALTER TABLE archivos ADD COLUMN evidencia_local_id TEXT`);
    console.log('[DB] ✅ Columna evidencia_local_id agregada a archivos');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando evidencia_local_id a archivos:', err.message);
    }
  }

  // updated_at en archivos: permite invalidar la caché de imágenes del
  // cliente. La app agrega `?v=<updated_at>` a la URL de cada evidencia; si
  // el binario se re-sube (p. ej. re-estampado de marca de agua) y se toca
  // esta columna, la URL cambia y el <Image> de React Native vuelve a
  // descargar la versión nueva en vez de servir la cacheada por URI.
  try {
    await query(`ALTER TABLE archivos ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()`);
    console.log('[DB] ✅ Columna updated_at agregada a archivos');
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[DB] Error agregando updated_at a archivos:', err.message);
    }
  }

  try {
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_archivos_evidencia_local_id
      ON archivos(usuario_id, evidencia_local_id)
      WHERE evidencia_local_id IS NOT NULL`);
    console.log('[DB] ✅ Índice único idx_archivos_evidencia_local_id creado');
  } catch (err) {
    console.error('[DB] Error creando índice idx_archivos_evidencia_local_id:', err.message);
  }

  // ID estable del punto GPS generado en el dispositivo. Los reintentos
  // pueden reenviar lotes parcialmente aceptados; esta clave evita duplicarlos.
  try {
    await query('ALTER TABLE tracking ADD COLUMN IF NOT EXISTS id_local TEXT');
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_usuario_id_local
      ON tracking(usuario_id, id_local) WHERE id_local IS NOT NULL`);
    console.log('[DB] ✅ Idempotencia de tracking verificada');
  } catch (err) {
    console.error('[DB] Error agregando idempotencia a tracking:', err.message);
  }

  // Migración: el rol 'supervisor' pasa a llamarse 'coordinador' en todo
  // el sistema (cambio de nomenclatura pedido por el proyecto). Se
  // actualizan las cuentas existentes y el histórico de revisiones para
  // que queden consistentes con el nuevo constraint — los ids de usuario
  // (ej. 'sup-001') y las rutas ya subidas a MinIO NO se tocan, porque no
  // dependen de esto (el id es solo una clave opaca y la ruta de archivo
  // se lee tal como quedó guardada, no se reconstruye desde el rol).
  try {
    await query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check`);
    const res = await query(`UPDATE usuarios SET rol = 'coordinador' WHERE rol = 'supervisor'`);
    if (res?.rowCount > 0) {
      console.log(`[DB] ✅ Migración rol: ${res.rowCount} usuario(s) 'supervisor' → 'coordinador'`);
    }
    await query(`ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
      CHECK (rol IN ('tecnico','coordinador','interventor','gerente','admin'))`);
    console.log('[DB] ✅ Constraint usuarios_rol_check actualizado (coordinador en vez de supervisor)');
  } catch (err) {
    console.error('[DB] Error migrando rol supervisor→coordinador:', err.message);
  }

  try {
    const r1 = await query(`UPDATE revisiones_formulario SET revisor_rol = 'coordinador' WHERE revisor_rol = 'supervisor'`);
    const r2 = await query(`UPDATE revision_evidencia_formulario SET revisor_rol = 'coordinador' WHERE revisor_rol = 'supervisor'`);
    if ((r1?.rowCount || 0) + (r2?.rowCount || 0) > 0) {
      console.log(`[DB] ✅ Migración revisor_rol: ${r1.rowCount} revisión(es) + ${r2.rowCount} evidencia(s) 'supervisor' → 'coordinador'`);
    }
  } catch (err) {
    console.error('[DB] Error migrando revisor_rol supervisor→coordinador:', err.message);
  }

  // Tabla: seguimientos de Coordinación/Interventoría — registro de
  // acompañamiento en campo independiente del formulario del técnico (no
  // requiere que el formulario del técnico ya exista ni esté sincronizado,
  // a diferencia del flujo de revisión de revisiones_formulario). Fotos
  // de evidencia se referencian igual que en revision_evidencia_formulario:
  // [{ archivo_id, uri? }] contra la tabla `archivos`.
  try {
    await query(`CREATE TABLE IF NOT EXISTS seguimientos (
      id VARCHAR(100) PRIMARY KEY,
      autor_id VARCHAR(20) NOT NULL,
      autor_nombre VARCHAR(200),
      autor_rol VARCHAR(20) NOT NULL CHECK (autor_rol IN ('coordinador','interventor')),
      beneficiario_cedula VARCHAR(30),
      beneficiario_nombre VARCHAR(200),
      formulario_id VARCHAR(100),
      actividad VARCHAR(200) NOT NULL,
      objetivo_visita TEXT,
      descripcion_actividad TEXT,
      observaciones TEXT,
      fotos_json JSONB DEFAULT '[]',
      videos_json JSONB DEFAULT '[]',
      firma_beneficiario TEXT,
      firma_autor TEXT,
      geo_latitud DECIMAL(10,7),
      geo_longitud DECIMAL(10,7),
      geo_altitud DECIMAL(10,2),
      geo_precision DECIMAL(10,2),
      huella_beneficiario BOOLEAN DEFAULT FALSE,
      pdf_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seguimientos_autor ON seguimientos(autor_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seguimientos_autor_rol ON seguimientos(autor_rol)`);
    // NOTA: el índice de formulario_id se crea DESPUÉS del ALTER TABLE de
    // abajo. Si se crea aquí, falla en instalaciones antiguas (la tabla ya
    // existe sin la columna) y PostgreSQL aborta el bloque entero.
  } catch (err) {
    console.error('[DB] Error creando seguimientos:', err.message);
  }

  // Migración: video y firmas (beneficiario + autor) en seguimientos — la
  // tabla ya existía sin estas columnas en instalaciones previas a esta
  // versión. firma_beneficiario/firma_autor guardan el archivo_id de MinIO
  // (subido vía /api/firmas), igual convención que revision_evidencia_formulario.
  for (const [col, tipo] of [
    ['videos_json', "JSONB DEFAULT '[]'"],
    ['firma_beneficiario', 'TEXT'],
    ['firma_autor', 'TEXT'],
    ['geo_latitud', 'DECIMAL(10,7)'],
    ['geo_longitud', 'DECIMAL(10,7)'],
    ['geo_altitud', 'DECIMAL(10,2)'],
    ['geo_precision', 'DECIMAL(10,2)'],
    ['huella_beneficiario', 'BOOLEAN DEFAULT FALSE'],
    ['formulario_id', 'VARCHAR(100)'],
  ]) {
    try {
      await query(`ALTER TABLE seguimientos ADD COLUMN ${col} ${tipo}`);
      console.log(`[DB] ✅ Columna ${col} agregada a seguimientos`);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error(`[DB] Error agregando ${col} a seguimientos:`, err.message);
      }
    }
  }

  // Índice de formulario_id: después de la migración para que la columna
  // exista sí o sí (ver nota arriba).
  try {
    await query(`CREATE INDEX IF NOT EXISTS idx_seguimientos_formulario ON seguimientos(formulario_id)`);
  } catch (err) {
    console.error('[DB] Error creando idx_seguimientos_formulario:', err.message);
  }

  await seedBeneficiarios();

  console.log('[DB] ✅ Esquema de base de datos inicializado');
}

// Siembra inicial de los 301 beneficiarios del proyecto (una sola vez,
// solo si la tabla está vacía). Fuente: data/beneficiarios-seed.json,
// generado desde la base de datos oficial del proyecto (incluye la lista
// verificada de 300 de Base_de_datos_beneficiarios/300 beneficiarios final.csv).
async function seedBeneficiarios() {
  try {
    const { count } = await queryOne('SELECT COUNT(*)::int AS count FROM beneficiarios');
    if (count > 0) return;

    const seed = require('./data/beneficiarios-seed.json');
    for (const b of seed) {
      await query(
        `INSERT INTO beneficiarios
           (item, corregimiento, vereda, nombre_completo, cedula,
            departamento, municipio, telefono, nombre_predio, area_predio, latitud, longitud)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (item) DO NOTHING`,
        [
          b.item, b.corregimiento, b.vereda, b.nombre_completo, b.cedula,
          b.departamento || null, b.municipio || null, b.telefono || null,
          b.nombre_predio || null, b.area_predio ?? null, b.latitud ?? null, b.longitud ?? null,
        ]
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
