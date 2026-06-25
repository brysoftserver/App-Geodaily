// ============================================================
// GEODAILY — Servicio de Beneficiarios (Búsqueda + Padrón)
// ============================================================

import * as SQLite from 'expo-sqlite';
import { DatosBeneficiario, DatosSociodemograficos, DatosBeneficiarioCompleto } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

const initDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('geodaily.db');
  }
  return db;
};

/**
 * Buscar beneficiario por cédula en la base local (beneficiarios + formularios)
 */
export const buscarBeneficiarioPorCedula = async (
  cedula: string
): Promise<DatosBeneficiarioCompleto | null> => {
  try {
    const database = await initDb();

    // Buscar primero en tabla de beneficiarios
    const row = await database.getFirstAsync<any>(
      'SELECT * FROM beneficiarios WHERE cedula = ?',
      [cedula]
    );

    if (row) {
      return {
        nombre: row.nombre,
        cedula: row.cedula,
        telefono: row.telefono || '',
        departamento: row.departamento || 'Caquetá',
        municipio: row.municipio || 'Puerto Rico',
        vereda: row.vereda || '',
        finca: row.finca || '',
        sociodemografico: {
          genero: row.genero || 'otro',
          escolaridad: row.escolaridad || '',
          etnia: row.etnia || undefined,
          personas_cargo: row.personas_cargo || 0,
          hectareas: row.hectareas || 0,
          vive_en_finca: row.vive_en_finca === 1,
          asociado: row.asociado === 1,
          asociacion_nombre: row.asociacion_nombre || undefined,
          telefono_emergencia: row.telefono_emergencia || undefined,
        },
      };
    }

    // Fallback: buscar en formularios existentes
    const formRow = await database.getFirstAsync<any>(
      `SELECT beneficiario_json FROM formularios
       WHERE json_extract(beneficiario_json, '$.cedula') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [cedula]
    );

    if (formRow) {
      const benef = JSON.parse(formRow.beneficiario_json);
      return {
        nombre: benef.nombre || '',
        cedula: benef.cedula || '',
        telefono: benef.telefono || '',
        departamento: benef.departamento || 'Caquetá',
        municipio: benef.municipio || 'Puerto Rico',
        vereda: benef.vereda || '',
        finca: benef.finca || '',
      };
    }

    return null;
  } catch (error) {
    console.error('[Beneficiarios] Error al buscar por cédula:', error);
    return null;
  }
};

/**
 * Buscar beneficiario en el padrón (API remota)
 */
export const buscarEnPadron = async (
  cedula: string
): Promise<DatosBeneficiario | null> => {
  try {
    const response = await fetch(
      `http://192.168.1.20:8089/api/beneficiarios/padron/${cedula}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data?.estado === 'ok' && data?.data) {
      return {
        nombre: data.data.nombre || '',
        cedula: data.data.cedula || cedula,
        telefono: data.data.telefono || '',
        departamento: data.data.departamento || 'Caquetá',
        municipio: data.data.municipio || 'Puerto Rico',
        vereda: data.data.vereda || '',
        finca: data.data.finca || '',
      };
    }

    return null;
  } catch (error) {
    console.warn('[Beneficiarios] Error en búsqueda remota:', error);
    return null;
  }
};

/**
 * Guardar o actualizar beneficiario en base local
 */
export const guardarBeneficiario = async (
  datos: DatosBeneficiarioCompleto
): Promise<void> => {
  try {
    const database = await initDb();
    const socio = datos.sociodemografico;

    await database.runAsync(
      `INSERT OR REPLACE INTO beneficiarios (
        cedula, nombre, telefono, departamento, municipio, vereda, finca,
        genero, escolaridad, etnia, personas_cargo, hectareas,
        vive_en_finca, asociado, asociacion_nombre, telefono_emergencia,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.cedula,
        datos.nombre,
        datos.telefono,
        datos.departamento,
        datos.municipio,
        datos.vereda,
        datos.finca,
        socio?.genero || null,
        socio?.escolaridad || null,
        socio?.etnia || null,
        socio?.personas_cargo || 0,
        socio?.hectareas || 0,
        socio?.vive_en_finca ? 1 : 0,
        socio?.asociado ? 1 : 0,
        socio?.asociacion_nombre || null,
        socio?.telefono_emergencia || null,
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    console.log('[Beneficiarios] Guardado local:', datos.cedula);
  } catch (error) {
    console.error('[Beneficiarios] Error al guardar:', error);
    throw error;
  }
};

/**
 * Sincronizar padrón completo desde el servidor
 */
export const sincronizarPadron = async (): Promise<number> => {
  try {
    const response = await fetch(
      'http://192.168.1.20:8089/api/beneficiarios/padron',
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) throw new Error('Error al obtener padrón');

    const data = await response.json();
    if (data?.estado !== 'ok' || !Array.isArray(data?.data)) return 0;

    const database = await initDb();
    let count = 0;

    for (const benef of data.data) {
      await database.runAsync(
        `INSERT OR REPLACE INTO beneficiarios (
          cedula, nombre, telefono, departamento, municipio, vereda, finca,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          benef.cedula || '',
          benef.nombre || '',
          benef.telefono || '',
          benef.departamento || 'Caquetá',
          benef.municipio || 'Puerto Rico',
          benef.vereda || '',
          benef.finca || '',
          new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
      count++;
    }

    console.log(`[Beneficiarios] Padrón sincronizado: ${count} registros`);
    return count;
  } catch (error) {
    console.error('[Beneficiarios] Error al sincronizar padrón:', error);
    return 0;
  }
};
