// ============================================================
// GEODAILY — Servicio de Base de Datos Local (SQLite)
// ============================================================

import * as SQLite from 'expo-sqlite';
import { Formulario, Coordenadas } from '../types';

let db: SQLite.SQLiteDatabase | null = null;
let dbFailedOnce = false; // evita reintentar si ya falló (web)

/**
 * Asegura que la BD esté abierta.
 * Si `db` es null (ej. tras Fast Refresh), la reabre automáticamente.
 */
const ensureDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (db) return db;
  if (dbFailedOnce) return null; // no reintentar si ya falló
  try {
    db = await withTimeout(
      SQLite.openDatabaseAsync('geodaily.db'),
      3000,
      'ensureDb openDatabaseAsync'
    );
    await withTimeout(runMigrations(), 3000, 'ensureDb runMigrations');
    console.log('[DB] Reconexión automática exitosa');
    return db;
  } catch (error) {
    console.error('[DB] Error al reconectar BD:', error);
    dbFailedOnce = true;
    return null;
  }
};

/**
 * Timeout promisificado para evitar que SQLite cuelgue en web
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[DB] Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
};

/**
 * Inicializar la base de datos local
 * NOTA: En web, expo-sqlite requiere WASM que Metro no resuelve.
 * Si falla o expira, se ignora para que la app cargue igual.
 */
export const initDatabase = async (): Promise<void> => {
  try {
    db = await withTimeout(
      SQLite.openDatabaseAsync('geodaily.db'),
      5000,
      'openDatabaseAsync'
    );

    // Crear tablas
    await withTimeout(
      db.execAsync(`
        CREATE TABLE IF NOT EXISTS formularios (
          id TEXT PRIMARY KEY,
          tipo TEXT NOT NULL,
          tecnico_json TEXT NOT NULL,
          beneficiario_json TEXT NOT NULL,
          actividad_json TEXT NOT NULL,
          sociodemografico_json TEXT,
          caracterizacion_nueva_json TEXT,
          coordenadas_json TEXT NOT NULL,
          georeferencia_json TEXT,
          clima_json TEXT,
          fotos_json TEXT,
          firma_beneficiario TEXT,
          firma_tecnico TEXT,
          huella_beneficiario INTEGER DEFAULT 0,
          pdf_url TEXT,
          sincronizado INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          formulario_id TEXT NOT NULL,
          accion TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          intentos INTEGER DEFAULT 0,
          FOREIGN KEY (formulario_id) REFERENCES formularios(id)
        );

        CREATE TABLE IF NOT EXISTS fotos_locales (
          id TEXT PRIMARY KEY,
          formulario_id TEXT NOT NULL,
          uri TEXT NOT NULL,
          latitud REAL,
          longitud REAL,
          altitud REAL,
          timestamp TEXT NOT NULL,
          sincronizada INTEGER DEFAULT 0,
          FOREIGN KEY (formulario_id) REFERENCES formularios(id)
        );
      `),
      5000,
      'Crear tablas'
    );

    // Migración: agregar columna usuario_id si no existe
    try {
      await db.execAsync('ALTER TABLE formularios ADD COLUMN usuario_id TEXT');
      console.log('[DB] Columna usuario_id agregada a formularios');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar columna sociodemografico_json si no existe
    try {
      await db.execAsync('ALTER TABLE formularios ADD COLUMN sociodemografico_json TEXT');
      console.log('[DB] Columna sociodemografico_json agregada a formularios');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar columna caracterizacion_nueva_json si no existe
    try {
      await db.execAsync('ALTER TABLE formularios ADD COLUMN caracterizacion_nueva_json TEXT');
      console.log('[DB] Columna caracterizacion_nueva_json agregada a formularios');
    } catch {
      // Ya existe, ignorar
    }

    // Ejecutar migraciones de nuevas tablas
    await withTimeout(runMigrations(), 5000, 'runMigrations');

    console.log('[DB] Base de datos local inicializada');
  } catch (error) {
    console.warn('[DB] SQLite no disponible en este entorno — la app funciona sin persistencia local:', (error as Error)?.message);
    db = null; // asegurar que db quede null
  }
};

/**
 * Guardar un formulario localmente
 */
export const saveFormularioLocal = async (
  formulario: Formulario
): Promise<void> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — no se guardó el formulario localmente');
    return;
  }

  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO formularios (
        id, tipo, tecnico_json, beneficiario_json, actividad_json,
        sociodemografico_json, caracterizacion_nueva_json, coordenadas_json, georeferencia_json, clima_json, fotos_json,
        firma_beneficiario, firma_tecnico, huella_beneficiario,
        pdf_url, sincronizado, usuario_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formulario.id,
        formulario.tipo,
        JSON.stringify(formulario.tecnico),
        JSON.stringify(formulario.beneficiario),
        JSON.stringify(formulario.actividad),
        formulario.sociodemografico ? JSON.stringify(formulario.sociodemografico) : null,
        (formulario as any).caracterizacion_nueva ? JSON.stringify((formulario as any).caracterizacion_nueva) : null,
        formulario.coordenadas ? JSON.stringify(formulario.coordenadas) : null,
        formulario.georeferencia ? JSON.stringify(formulario.georeferencia) : null,
        formulario.clima ? JSON.stringify(formulario.clima) : null,
        JSON.stringify(formulario.fotos || []),
        formulario.firma_beneficiario || null,
        formulario.firma_tecnico || null,
        formulario.huella_beneficiario ? 1 : 0,
        formulario.pdf_url || null,
        formulario.sincronizado ? 1 : 0,
        formulario.tecnico.usuario_id || null,
        formulario.created_at,
        formulario.updated_at,
      ]
    );

    // Si no está sincronizado, añadir a la cola
    if (!formulario.sincronizado) {
      await addToSyncQueue(formulario.id, 'crear', formulario);
    }

    console.log('[DB] Formulario guardado localmente:', formulario.id);
  } catch (error) {
    console.error('[DB] Error al guardar formulario:', error);
    throw error;
  }
};

/**
 * Obtener formularios locales.
 * Si se provee usuarioId, filtra solo los de ese usuario (para técnicos).
 * Si no, devuelve todos (para supervisores/gerentes/admin).
 */
export const getFormulariosLocales = async (usuarioId?: string): Promise<Formulario[]> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — devolviendo lista vacía');
    return [];
  }

  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      usuarioId
        ? 'SELECT * FROM formularios WHERE usuario_id = ? ORDER BY created_at DESC'
        : 'SELECT * FROM formularios ORDER BY created_at DESC',
      usuarioId ? [usuarioId] : ([] as any)
    );
    const validRows: Formulario[] = [];
    for (const row of rows) {
      try {
        validRows.push(deserializeFormulario(row));
      } catch (e) {
        console.warn('[DB] Saltando fila corrupta:', row.id, e);
      }
    }
    return validRows;
  } catch (error) {
    console.error('[DB] Error al leer formularios:', error);
    return [];
  }
};

/**
 * Obtener un formulario por ID
 */
export const getFormularioById = async (
  id: string
): Promise<Formulario | null> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — getFormularioById retorna null');
    return null;
  }

  try {
    const row = await database.getFirstAsync<Record<string, any>>(
      'SELECT * FROM formularios WHERE id = ?',
      [id]
    );
    return row ? deserializeFormulario(row) : null;
  } catch (error) {
    console.error('[DB] Error al leer formulario:', error);
    return null;
  }
};

/**
 * Eliminar formulario local
 */
export const deleteFormularioLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — no se eliminó el formulario local');
    return;
  }
  await database.runAsync('DELETE FROM formularios WHERE id = ?', [id]);
};

/**
 * Marcar formulario como sincronizado
 */
export const markAsSynced = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — markAsSynced ignorado');
    return;
  }
  await database.runAsync(
    'UPDATE formularios SET sincronizado = 1 WHERE id = ?',
    [id]
  );
};

/**
 * Obtener formularios pendientes de sincronización
 */
export const getPendingSyncForms = async (): Promise<Formulario[]> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — getPendingSyncForms retorna vacío');
    return [];
  }
  const rows = await database.getAllAsync<Record<string, any>>(
    'SELECT * FROM formularios WHERE sincronizado = 0 ORDER BY created_at ASC'
  );
  const validRows: Formulario[] = [];
  for (const row of rows) {
    try {
      validRows.push(deserializeFormulario(row));
    } catch (e) {
      console.warn('[DB] Saltando fila corrupta en sync:', row.id, e);
    }
  }
  return validRows;
};

// --- Cola de sincronización ---

const addToSyncQueue = async (
  formularioId: string,
  accion: string,
  formulario: Formulario
): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `INSERT INTO sync_queue (formulario_id, accion, payload_json, created_at)
     VALUES (?, ?, ?, ?)`,
    [formularioId, accion, JSON.stringify(formulario), new Date().toISOString()]
  );
};

export const getSyncQueue = async (): Promise<Record<string, any>[]> => {
  if (!db) return [];
  return await db.getAllAsync<Record<string, any>>(
    'SELECT * FROM sync_queue ORDER BY created_at ASC'
  );
};

export const clearSyncQueueItem = async (id: number): Promise<void> => {
  if (!db) return;
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
};

// --- Fotos locales ---

export const saveFotoLocal = async (
  id: string,
  formularioId: string,
  uri: string,
  coordenadas?: Coordenadas
): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO fotos_locales (id, formulario_id, uri, latitud, longitud, altitud, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      formularioId,
      uri,
      coordenadas?.latitud || null,
      coordenadas?.longitud || null,
      coordenadas?.altitud || null,
      new Date().toISOString(),
    ]
  );
};

/**
 * Marcar una foto local como sincronizada
 */
export const markFotoAsSynced = async (id: string): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    'UPDATE fotos_locales SET sincronizada = 1 WHERE id = ?',
    [id]
  );
};

/**
 * Obtener fotos locales pendientes de sincronizar para un formulario
 */
export const getUnsyncedPhotos = async (
  formularioId: string
): Promise<Record<string, any>[]> => {
  if (!db) return [];
  return await db.getAllAsync<Record<string, any>>(
    'SELECT * FROM fotos_locales WHERE formulario_id = ? AND sincronizada = 0',
    [formularioId]
  );
};

/**
 * Actualizar el contador de intentos en la cola de sincronización
 */
export const updateSyncAttempts = async (
  formularioId: string,
  intentos: number
): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    'UPDATE sync_queue SET intentos = ? WHERE formulario_id = ?',
    [intentos, formularioId]
  );
};

/**
 * Obtener item de la cola de sync por ID de formulario
 */
export const getSyncQueueItemByFormId = async (
  formularioId: string
): Promise<Record<string, any> | null> => {
  if (!db) return null;
  return await db.getFirstAsync<Record<string, any>>(
    'SELECT * FROM sync_queue WHERE formulario_id = ?',
    [formularioId]
  );
};

/**
 * Limpiar items de la cola de sync por ID de formulario
 */
export const clearSyncQueueByFormId = async (
  formularioId: string
): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    'DELETE FROM sync_queue WHERE formulario_id = ?',
    [formularioId]
  );
};

// --- Utilidades ---

const deserializeFormulario = (row: Record<string, any>): Formulario => {
  const safeJsonParse = (val: string | null, fallback: Record<string, any> = {}) => {
    if (!val) return fallback;
    try { return JSON.parse(val); }
    catch { return fallback; }
  };

  const form: Record<string, any> = {
    id: row.id,
    tipo: row.tipo,
    tecnico: safeJsonParse(row.tecnico_json, { nombre: '', cedula: '', telefono: '', email: '' }),
    beneficiario: safeJsonParse(row.beneficiario_json, { nombre: '', cedula: '', telefono: '', departamento: '', municipio: '', vereda: '', finca: '' }),
    actividad: safeJsonParse(row.actividad_json, { descripcion: '', observaciones: '', recomendaciones: '' }),
    sociodemografico: row.sociodemografico_json ? safeJsonParse(row.sociodemografico_json, undefined) : undefined,
    coordenadas: safeJsonParse(row.coordenadas_json, { latitud: 0, longitud: 0 }),
    georeferencia: row.georeferencia_json ? safeJsonParse(row.georeferencia_json, undefined) : undefined,
    clima: row.clima_json ? safeJsonParse(row.clima_json, undefined) : undefined,
    fotos: safeJsonParse(row.fotos_json, []),
    firma_beneficiario: row.firma_beneficiario || '',
    firma_tecnico: row.firma_tecnico || '',
    huella_beneficiario: row.huella_beneficiario === 1,
    pdf_url: row.pdf_url || undefined,
    sincronizado: row.sincronizado === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (row.caracterizacion_nueva_json) {
    form.caracterizacion_nueva = safeJsonParse(row.caracterizacion_nueva_json, undefined);
  }

  return form as Formulario;
};

// ============================================================
// MIGRACIONES — Nuevas tablas (Fases 1, 3, 4)
// ============================================================

/**
 * Ejecuta migraciones para crear nuevas tablas del sistema
 */
export const runMigrations = async (): Promise<void> => {
  if (!db) return;
  try {
    await db.execAsync(`
      -- Beneficiarios con datos sociodemográficos
      CREATE TABLE IF NOT EXISTS beneficiarios (
        cedula TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        telefono TEXT,
        departamento TEXT,
        municipio TEXT,
        vereda TEXT,
        finca TEXT,
        genero TEXT,
        escolaridad TEXT,
        etnia TEXT,
        personas_cargo INTEGER DEFAULT 0,
        hectareas REAL DEFAULT 0,
        vive_en_finca INTEGER DEFAULT 1,
        asociado INTEGER DEFAULT 0,
        asociacion_nombre TEXT,
        telefono_emergencia TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Documentos digitales de fincas
      CREATE TABLE IF NOT EXISTS documentos_finca (
        id TEXT PRIMARY KEY,
        formulario_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        uri TEXT NOT NULL,
        nombre TEXT,
        descripcion TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (formulario_id) REFERENCES formularios(id)
      );

      -- Tracking de posiciones GPS
      CREATE TABLE IF NOT EXISTS tracking_posiciones (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        latitud REAL NOT NULL,
        longitud REAL NOT NULL,
        altitud REAL,
        precision_gps REAL,
        velocidad REAL,
        heading REAL,
        timestamp TEXT NOT NULL,
        sincronizado INTEGER DEFAULT 0
      );

      -- Capacitaciones a beneficiarios
      CREATE TABLE IF NOT EXISTS capacitaciones (
        id TEXT PRIMARY KEY,
        tema TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        material_url TEXT,
        material_nombre TEXT,
        fecha TEXT NOT NULL,
        duracion_minutos INTEGER DEFAULT 0,
        beneficiarios_asistentes INTEGER DEFAULT 0,
        tecnico_id TEXT NOT NULL,
        lugar TEXT,
        observaciones TEXT,
        fotos_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Mediciones de terreno (Shoelace)
      CREATE TABLE IF NOT EXISTS mediciones_terreno (
        id TEXT PRIMARY KEY,
        formulario_id TEXT NOT NULL,
        usuario_id TEXT,
        area_hectareas REAL NOT NULL,
        area_metros2 REAL NOT NULL,
        perimetro_metros REAL NOT NULL,
        puntos_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sincronizado INTEGER DEFAULT 0,
        FOREIGN KEY (formulario_id) REFERENCES formularios(id)
      );

      -- Conteo de plantas por especie
      CREATE TABLE IF NOT EXISTS conteo_plantas (
        id TEXT PRIMARY KEY,
        formulario_id TEXT NOT NULL,
        especie TEXT NOT NULL,
        cantidad INTEGER NOT NULL,
        observaciones TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (formulario_id) REFERENCES formularios(id)
      );

      -- Plantaciones marcadas en el mapa (Fase B)
      CREATE TABLE IF NOT EXISTS plantaciones (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        latitud REAL NOT NULL,
        longitud REAL NOT NULL,
        especie TEXT NOT NULL,
        cantidad INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        sincronizado INTEGER DEFAULT 0,
        icono TEXT DEFAULT '🌱'
      );

      -- Cache local de geometrías de veredas (se descarga una vez)
      CREATE TABLE IF NOT EXISTS veredas_cache (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        properties_json TEXT,
        cached_at TEXT NOT NULL,
        fuente TEXT DEFAULT 'overpass'
      );
    `);

    // Migración: agregar columna icono si no existe (BDs previas a Fase B+)
    try {
      await db.runAsync('ALTER TABLE plantaciones ADD COLUMN icono TEXT DEFAULT \'🌱\'');
    } catch {
      // La columna ya existe, ignorar
    }

    // Migración: agregar columna sincronizado a mediciones_terreno si no existe
    try {
      await db.runAsync('ALTER TABLE mediciones_terreno ADD COLUMN sincronizado INTEGER DEFAULT 0');
      console.log('[DB] Columna sincronizado agregada a mediciones_terreno');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar columna sincronizado a plantaciones si no existe (BDs antiguas)
    try {
      await db.runAsync('ALTER TABLE plantaciones ADD COLUMN sincronizado INTEGER DEFAULT 0');
      console.log('[DB] Columna sincronizado agregada a plantaciones');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar columna sincronizado a tracking_posiciones si no existe
    try {
      await db.runAsync('ALTER TABLE tracking_posiciones ADD COLUMN sincronizado INTEGER DEFAULT 0');
      console.log('[DB] Columna sincronizado agregada a tracking_posiciones');
    } catch {
      // Ya existe, ignorar
    }

    console.log('[DB] Migraciones ejecutadas correctamente');
  } catch (error) {
    console.error('[DB] Error en migraciones:', error);
    throw error;
  }
};

/**
 * Obtener la instancia actual de la BD (puede ser null si no está inicializada).
 * Para uso directo en operaciones que necesitan la BD. Prefiere ensureDb()
 * si necesitas reconexión automática.
 */
export const getDb = (): SQLite.SQLiteDatabase | null => db;

/**
 * Obtener la BD con reconexión automática. Úsala en lugar de getDb()
 * cuando necesites garantizar que la BD esté abierta.
 */
export const getDbSafe = async (): Promise<SQLite.SQLiteDatabase | null> => {
  return ensureDb();
};

// === Funciones para Tracking GPS ===

/**
 * Obtener la última posición conocida de cada técnico
 */
export const getUltimasPosicionesTecnicos = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    return await database.getAllAsync<Record<string, any>>(
      `SELECT t1.* FROM tracking_posiciones t1
       INNER JOIN (
         SELECT usuario_id, MAX(timestamp) as max_ts
         FROM tracking_posiciones
         GROUP BY usuario_id
       ) t2 ON t1.usuario_id = t2.usuario_id AND t1.timestamp = t2.max_ts
       ORDER BY t1.timestamp DESC`
    );
  } catch (error) {
    console.error('[DB] Error al obtener últimas posiciones:', error);
    return [];
  }
};

/**
 * Obtener el historial de posiciones de un técnico en un rango de fecha
 */
export const getPosicionesTecnico = async (
  usuarioId: string,
  desde?: string,
  hasta?: string
): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    let query = 'SELECT * FROM tracking_posiciones WHERE usuario_id = ?';
    const params: (string | undefined)[] = [usuarioId];
    if (desde) {
      query += ' AND timestamp >= ?';
      params.push(desde);
    }
    if (hasta) {
      query += ' AND timestamp <= ?';
      params.push(hasta);
    }
    query += ' ORDER BY timestamp ASC';
    return await database.getAllAsync<Record<string, any>>(query, params.filter((p): p is string => p !== undefined));
  } catch (error) {
    console.error('[DB] Error al obtener posiciones:', error);
    return [];
  }
};

// === Funciones para Plantaciones (Fase B) ===

/**
 * Guardar una plantación marcada en el mapa
 */
export const savePlantacion = async (
  plantacion: import('../types').Plantacion
): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO plantaciones (id, usuario_id, latitud, longitud, especie, cantidad, timestamp, sincronizado, icono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plantacion.id,
        plantacion.usuario_id,
        plantacion.latitud,
        plantacion.longitud,
        plantacion.especie,
        plantacion.cantidad,
        plantacion.timestamp,
        plantacion.sincronizado ? 1 : 0,
        plantacion.icono || '🌱',
      ]
    );
  } catch (error) {
    console.error('[DB] Error al guardar plantación:', error);
    throw error;
  }
};

/**
 * Obtener plantaciones de un usuario
 */
export const getPlantaciones = async (
  usuarioId?: string
): Promise<import('../types').Plantacion[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const query = usuarioId
      ? 'SELECT * FROM plantaciones WHERE usuario_id = ? ORDER BY timestamp DESC'
      : 'SELECT * FROM plantaciones ORDER BY timestamp DESC';
    const rows = await database.getAllAsync<Record<string, any>>(
      query,
      usuarioId ? [usuarioId] : []
    );
    return rows.filter(Boolean).map((r: Record<string, any>) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      latitud: r.latitud,
      longitud: r.longitud,
      especie: r.especie,
      cantidad: r.cantidad,
      timestamp: r.timestamp,
      sincronizado: r.sincronizado === 1,
      icono: r.icono || '🌱',
    }));
  } catch (error) {
    console.error('[DB] Error al obtener plantaciones:', error);
    return [];
  }
};

// === Nuevas funciones para sincronización de mapas ===

/**
 * Obtener plantaciones pendientes de sincronizar
 */
export const getPlantacionesNoSincronizadas = async (): Promise<import('../types').Plantacion[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM plantaciones WHERE sincronizado = 0 ORDER BY timestamp ASC'
    );
    return rows.filter(Boolean).map((r: Record<string, any>) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      latitud: r.latitud,
      longitud: r.longitud,
      especie: r.especie,
      cantidad: r.cantidad,
      timestamp: r.timestamp,
      sincronizado: false,
      icono: r.icono || '🌱',
    }));
  } catch (error) {
    console.error('[DB] Error al obtener plantaciones no sincronizadas:', error);
    return [];
  }
};

/**
 * Obtener posiciones de tracking pendientes de sincronizar
 */
export const getTrackingNoSincronizado = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    return await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM tracking_posiciones WHERE sincronizado = 0 ORDER BY timestamp ASC'
    );
  } catch (error) {
    console.error('[DB] Error al obtener tracking no sincronizado:', error);
    return [];
  }
};

/**
 * Obtener mediciones de terreno pendientes de sincronizar
 */
export const getMedicionesNoSincronizadas = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    return await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM mediciones_terreno WHERE sincronizado = 0 ORDER BY created_at ASC'
    );
  } catch (error) {
    console.error('[DB] Error al obtener mediciones no sincronizadas:', error);
    return [];
  }
};

/**
 * Marcar un registro como sincronizado por tabla e ID
 */
export const marcarSincronizado = async (
  tabla: string,
  id: string
): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync(
      `UPDATE ${tabla} SET sincronizado = 1 WHERE id = ?`,
      [id]
    );
  } catch (error) {
    console.error(`[DB] Error al marcar ${tabla}/${id} como sincronizado:`, error);
  }
};

/**
 * Eliminar una plantación local por ID
 */
export const deletePlantacionLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync('DELETE FROM plantaciones WHERE id = ?', [id]);
    console.log('[DB] Plantación local eliminada:', id);
  } catch (error) {
    console.error('[DB] Error al eliminar plantación local:', error);
    throw error;
  }
};

/**
 * Eliminar una medición local por ID
 */
export const deleteMedicionLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync('DELETE FROM mediciones_terreno WHERE id = ?', [id]);
    console.log('[DB] Medición local eliminada:', id);
  } catch (error) {
    console.error('[DB] Error al eliminar medición local:', error);
    throw error;
  }
};

/**
 * Obtener todas las mediciones de terreno
 */
export const getMediciones = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM mediciones_terreno ORDER BY created_at DESC'
    );
    return rows.filter(Boolean).map((r: Record<string, any>) => ({
      id: r.id,
      formulario_id: r.formulario_id,
      usuario_id: r.usuario_id,
      area_hectareas: r.area_hectareas,
      area_metros2: r.area_metros2,
      perimetro_metros: r.perimetro_metros,
      puntos: r.puntos_json ? JSON.parse(r.puntos_json) : [],
      created_at: r.created_at,
      sincronizado: r.sincronizado === 1,
    }));
  } catch (error) {
    console.error('[DB] Error al obtener mediciones:', error);
    return [];
  }
};

/**
 * Guardar una medición de terreno en SQLite (desde MapaScreen)
 */
export const saveMedicion = async (
  data: {
    id: string;
    formulario_id?: string;
    usuario_id?: string;
    area_hectareas: number;
    area_metros2: number;
    perimetro_metros: number;
    puntos: { latitud: number; longitud: number }[];
    sincronizado?: boolean;
  }
): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO mediciones_terreno (
        id, formulario_id, usuario_id, area_hectareas, area_metros2,
        perimetro_metros, puntos_json, created_at, sincronizado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.formulario_id || 'mapa_directo',
        data.usuario_id || null,
        data.area_hectareas,
        data.area_metros2,
        data.perimetro_metros,
        JSON.stringify(data.puntos),
        new Date().toISOString(),
        data.sincronizado ? 1 : 0,
      ]
    );
    console.log('[DB] Medición guardada localmente:', data.id);
  } catch (error) {
    console.error('[DB] Error al guardar medición:', error);
    throw error;
  }
};

// ============================================================
// Cache local de veredas (offline-first)
// ============================================================

/**
 * Guardar veredas en caché local (SQLite)
 */
export const saveVeredasCache = async (
  veredas: Array<{
    id: string;
    nombre: string;
    type: string;
    properties: Record<string, any>;
    geometry: Record<string, any>;
  }>,
  fuente: string = 'overpass'
): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    // Limpiar cache anterior
    await database.runAsync('DELETE FROM veredas_cache');
    // Insertar nuevas
    const stmt = 'INSERT INTO veredas_cache (id, nombre, geometry_json, properties_json, cached_at, fuente) VALUES (?, ?, ?, ?, ?, ?)';
    const now = new Date().toISOString();
    for (const v of veredas) {
      await database.runAsync(stmt, [
        v.id,
        v.nombre,
        JSON.stringify(v.geometry),
        JSON.stringify(v.properties || {}),
        now,
        fuente,
      ]);
    }
    console.log(`[DB] Veredas cacheadas: ${veredas.length} (fuente: ${fuente})`);
  } catch (error) {
    console.error('[DB] Error al cachear veredas:', error);
  }
};

/**
 * Obtener veredas desde caché local
 */
export const getVeredasCache = async (): Promise<{
  veredas: any[];
  cached_at: string | null;
  fuente: string | null;
}> => {
  const database = await ensureDb();
  if (!database) return { veredas: [], cached_at: null, fuente: null };
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM veredas_cache ORDER BY nombre ASC'
    );
    if (rows.length === 0) return { veredas: [], cached_at: null, fuente: null };

    const veredas = rows.map((r: Record<string, any>) => ({
      id: r.id,
      nombre: r.nombre,
      type: 'Feature',
      properties: r.properties_json ? JSON.parse(r.properties_json) : { id: r.id, nombre: r.nombre },
      geometry: r.geometry_json ? JSON.parse(r.geometry_json) : { type: 'MultiPolygon', coordinates: [] },
    }));

    return {
      veredas,
      cached_at: rows[0]?.cached_at || null,
      fuente: rows[0]?.fuente || null,
    };
  } catch (error) {
    console.error('[DB] Error al leer cache de veredas:', error);
    return { veredas: [], cached_at: null, fuente: null };
  }
};

/**
 * Verificar si el cache de veredas está vigente (menos de 24h)
 */
export const isVeredasCacheFresh = async (maxAgeMs: number = 86400000): Promise<boolean> => {
  const database = await ensureDb();
  if (!database) return false;
  try {
    const row = await database.getFirstAsync<Record<string, any>>(
      'SELECT cached_at FROM veredas_cache LIMIT 1'
    );
    if (!row?.cached_at) return false;
    const age = Date.now() - new Date(row.cached_at).getTime();
    return age < maxAgeMs;
  } catch {
    return false;
  }
};
