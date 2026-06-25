// ============================================================
// GEODAILY — Servicio de Base de Datos Local (SQLite)
// ============================================================

import * as SQLite from 'expo-sqlite';
import { Formulario, Coordenadas, MedicionTerreno, ConteoPlantas, PosicionTracking, Capacitacion } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Inicializar la base de datos local
 */
export const initDatabase = async (): Promise<void> => {
  try {
    db = await SQLite.openDatabaseAsync('geodaily.db');

    // Crear tablas
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS formularios (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        tecnico_json TEXT NOT NULL,
        beneficiario_json TEXT NOT NULL,
        actividad_json TEXT NOT NULL,
        sociodemografico_json TEXT,
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
    `);

    // Migración: agregar columna usuario_id si no existe
    try {
      await db.execAsync('ALTER TABLE formularios ADD COLUMN usuario_id TEXT');
      console.log('[DB] Columna usuario_id agregada a formularios');
    } catch {
      // Ya existe, ignorar
    }

    // Ejecutar migraciones de nuevas tablas
    await runMigrations();

    console.log('[DB] Base de datos local inicializada');
  } catch (error) {
    console.error('[DB] Error de inicialización:', error);
    throw error;
  }
};

/**
 * Guardar un formulario localmente
 */
export const saveFormularioLocal = async (
  formulario: Formulario
): Promise<void> => {
  if (!db) throw new Error('Base de datos no inicializada');

  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO formularios (
        id, tipo, tecnico_json, beneficiario_json, actividad_json,
        sociodemografico_json, coordenadas_json, georeferencia_json, clima_json, fotos_json,
        firma_beneficiario, firma_tecnico, huella_beneficiario,
        pdf_url, sincronizado, usuario_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formulario.id,
        formulario.tipo,
        JSON.stringify(formulario.tecnico),
        JSON.stringify(formulario.beneficiario),
        JSON.stringify(formulario.actividad),
        formulario.sociodemografico ? JSON.stringify(formulario.sociodemografico) : null,
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
  if (!db) throw new Error('Base de datos no inicializada');

  try {
    let rows: any[];
    if (usuarioId) {
      rows = await db.getAllAsync<any>(
        'SELECT * FROM formularios WHERE usuario_id = ? ORDER BY created_at DESC',
        [usuarioId]
      );
    } else {
      rows = await db.getAllAsync<any>(
        'SELECT * FROM formularios ORDER BY created_at DESC'
      );
    }
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
  if (!db) throw new Error('Base de datos no inicializada');

  try {
    const row = await db.getFirstAsync<any>(
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
  if (!db) throw new Error('Base de datos no inicializada');
  await db.runAsync('DELETE FROM formularios WHERE id = ?', [id]);
};

/**
 * Marcar formulario como sincronizado
 */
export const markAsSynced = async (id: string): Promise<void> => {
  if (!db) throw new Error('Base de datos no inicializada');
  await db.runAsync(
    'UPDATE formularios SET sincronizado = 1 WHERE id = ?',
    [id]
  );
};

/**
 * Obtener formularios pendientes de sincronización
 */
export const getPendingSyncForms = async (): Promise<Formulario[]> => {
  if (!db) throw new Error('Base de datos no inicializada');
  const rows = await db.getAllAsync<any>(
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

export const getSyncQueue = async (): Promise<any[]> => {
  if (!db) return [];
  return await db.getAllAsync<any>(
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
): Promise<any[]> => {
  if (!db) return [];
  return await db.getAllAsync<any>(
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
): Promise<any | null> => {
  if (!db) return null;
  return await db.getFirstAsync<any>(
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

const deserializeFormulario = (row: any): Formulario => {
  const safeJsonParse = (val: string | null, fallback: any = {}) => {
    if (!val) return fallback;
    try { return JSON.parse(val); }
    catch { return fallback; }
  };

  return {
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
        area_hectareas REAL NOT NULL,
        area_metros2 REAL NOT NULL,
        perimetro_metros REAL NOT NULL,
        puntos_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
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
    `);

    console.log('[DB] Migraciones ejecutadas correctamente');
  } catch (error) {
    console.error('[DB] Error en migraciones:', error);
    throw error;
  }
};

export const getDb = (): SQLite.SQLiteDatabase | null => db;

// === Funciones para Tracking GPS ===

/**
 * Obtener la última posición conocida de cada técnico
 */
export const getUltimasPosicionesTecnicos = async (): Promise<any[]> => {
  if (!db) return [];
  try {
    return await db.getAllAsync<any>(
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
): Promise<any[]> => {
  if (!db) return [];
  try {
    let query = 'SELECT * FROM tracking_posiciones WHERE usuario_id = ?';
    const params: any[] = [usuarioId];
    if (desde) {
      query += ' AND timestamp >= ?';
      params.push(desde);
    }
    if (hasta) {
      query += ' AND timestamp <= ?';
      params.push(hasta);
    }
    query += ' ORDER BY timestamp ASC';
    return await db.getAllAsync<any>(query, params);
  } catch (error) {
    console.error('[DB] Error al obtener posiciones:', error);
    return [];
  }
};
