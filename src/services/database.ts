// ============================================================
// GEODAILY — Servicio de Base de Datos Local (SQLite)
// ============================================================

import * as SQLite from 'expo-sqlite';
import { Formulario, Coordenadas } from '../types';

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
        coordenadas_json, georeferencia_json, clima_json, fotos_json,
        firma_beneficiario, firma_tecnico, huella_beneficiario,
        pdf_url, sincronizado, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formulario.id,
        formulario.tipo,
        JSON.stringify(formulario.tecnico),
        JSON.stringify(formulario.beneficiario),
        JSON.stringify(formulario.actividad),
        JSON.stringify(formulario.coordenadas),
        formulario.georeferencia ? JSON.stringify(formulario.georeferencia) : null,
        formulario.clima ? JSON.stringify(formulario.clima) : null,
        JSON.stringify(formulario.fotos),
        formulario.firma_beneficiario || null,
        formulario.firma_tecnico || null,
        formulario.huella_beneficiario ? 1 : 0,
        formulario.pdf_url || null,
        formulario.sincronizado ? 1 : 0,
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
 * Obtener todos los formularios locales
 */
export const getFormulariosLocales = async (): Promise<Formulario[]> => {
  if (!db) throw new Error('Base de datos no inicializada');

  try {
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM formularios ORDER BY created_at DESC'
    );
    return rows.map(deserializeFormulario);
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
  return rows.map(deserializeFormulario);
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

const deserializeFormulario = (row: any): Formulario => ({
  id: row.id,
  tipo: row.tipo,
  tecnico: JSON.parse(row.tecnico_json),
  beneficiario: JSON.parse(row.beneficiario_json),
  actividad: JSON.parse(row.actividad_json),
  coordenadas: JSON.parse(row.coordenadas_json),
  georeferencia: row.georeferencia_json ? JSON.parse(row.georeferencia_json) : undefined,
  clima: row.clima_json ? JSON.parse(row.clima_json) : undefined,
  fotos: JSON.parse(row.fotos_json || '[]'),
  firma_beneficiario: row.firma_beneficiario || '',
  firma_tecnico: row.firma_tecnico || '',
  huella_beneficiario: row.huella_beneficiario === 1,
  pdf_url: row.pdf_url || undefined,
  sincronizado: row.sincronizado === 1,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
