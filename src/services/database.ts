// ============================================================
// GEODAILY — Servicio de Base de Datos Local (SQLite)
// ============================================================

import * as SQLite from 'expo-sqlite';
import { Formulario, Coordenadas, DocumentoFinca, PosicionTracking } from '../types';

let db: SQLite.SQLiteDatabase | null = null;
let dbFailedOnce = false; // evita reintentar si ya falló (web)

/**
 * Asegura que la BD esté abierta.
 * Si `db` es null (ej. tras Fast Refresh), la reabre automáticamente.
 */
/**
 * Espera mínima entre reintentos de apertura, para no machacar el disco
 * cuando la BD está momentáneamente ocupada.
 */
const REINTENTO_DB_MS = 3000;
let ultimoIntentoDb = 0;

const ensureDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (db) return db;

  // Antes existía una bandera `dbFailedOnce` que, tras UN solo fallo
  // transitorio (p.ej. el timeout de 3 s en un teléfono lento arrancando en
  // frío), dejaba la base muerta para el resto de la sesión: todas las
  // funciones devolvían vacío o no-op en silencio y el técnico perdía cada
  // formulario que levantara a partir de entonces. Ahora se reintenta siempre,
  // limitando la frecuencia.
  const ahora = Date.now();
  if (ahora - ultimoIntentoDb < REINTENTO_DB_MS) return null;
  ultimoIntentoDb = ahora;

  try {
    db = await withTimeout(
      SQLite.openDatabaseAsync('geodaily.db'),
      5000,
      'ensureDb openDatabaseAsync'
    );
    // Crear tablas base + migraciones. `initDatabase` puede no haber llegado a
    // completarse (o haber fallado), así que aquí se asegura el esquema entero,
    // no solo las migraciones — si no, quedaban tablas como `formularios` sin crear.
    await withTimeout(crearEsquemaBase(), 8000, 'ensureDb crearEsquemaBase');
    await withTimeout(runMigrations(), 5000, 'ensureDb runMigrations');
    dbFailedOnce = false;
    console.log('[DB] Reconexión automática exitosa');
    return db;
  } catch (error) {
    console.error('[DB] Error al reconectar BD:', error);
    dbFailedOnce = true;
    db = null;
    return null;
  }
};

/**
 * Eliminar una evidencia (foto o video) de la cola local de sincronización.
 *
 * Sin esto, "eliminar foto" solo la quitaba de la pantalla: la fila seguía en
 * `fotos_locales` y el sincronizador la subía a MinIO igualmente.
 *
 * @returns true si se eliminó alguna fila
 */
export const deleteEvidenciaLocal = async (fotoId: string): Promise<boolean> => {
  const database = await ensureDb();
  if (!database) return false;
  try {
    const f = await database.runAsync('DELETE FROM fotos_locales WHERE id = ?', [fotoId]);
    const v = await database.runAsync('DELETE FROM videos_locales WHERE id = ?', [fotoId]);
    return (f.changes || 0) + (v.changes || 0) > 0;
  } catch (e) {
    console.warn('[DB] No se pudo eliminar la evidencia local:', fotoId, e);
    return false;
  }
};

/** ¿La base local está operativa? Para que la UI pueda avisar al técnico. */
export const isDbDisponible = (): boolean => db !== null;

/** ¿Hubo algún fallo de BD en esta sesión? */
export const huboFalloDb = (): boolean => dbFailedOnce;

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
 * Crear las tablas base del esquema local.
 *
 * Se extrajo de `initDatabase` para poder invocarla también desde
 * `ensureDb`: si `initDatabase` fallaba a mitad, la reconexión solo corría
 * `runMigrations` y tablas como `formularios` no llegaban a existir nunca,
 * dejando la app sin persistencia y sin ningún aviso.
 */
const crearEsquemaBase = async (): Promise<void> => {
  if (!db) return;
  await db.execAsync(`
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

        CREATE TABLE IF NOT EXISTS videos_locales (
          id TEXT PRIMARY KEY,
          formulario_id TEXT NOT NULL,
          uri TEXT NOT NULL,
          latitud REAL,
          longitud REAL,
          timestamp TEXT NOT NULL,
          sincronizada INTEGER DEFAULT 0,
          FOREIGN KEY (formulario_id) REFERENCES formularios(id)
        );

        CREATE TABLE IF NOT EXISTS beneficiarios (
          item INTEGER PRIMARY KEY,
          corregimiento TEXT NOT NULL,
          vereda TEXT NOT NULL,
          nombre_completo TEXT NOT NULL,
          cedula TEXT NOT NULL DEFAULT '',
          tecnico_asignado_id TEXT,
          tecnico_asignado_nombre TEXT,
          departamento TEXT,
          municipio TEXT,
          telefono TEXT,
          nombre_predio TEXT,
          area_predio REAL,
          latitud REAL,
          longitud REAL,
          correo_electronico TEXT,
          calidad_predio TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
  `);
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

    // Crear tablas base (idempotente)
    await withTimeout(crearEsquemaBase(), 8000, 'Crear tablas');

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

    // Migración: verificar que beneficiarios tenga columna item
    // (corrige BDs creadas con schema antiguo de runMigrations)
    try {
      const tables = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='beneficiarios'"
      );
      if (tables.length > 0) {
        const columns = await db.getAllAsync<{ name: string }>(
          'PRAGMA table_info(beneficiarios)'
        );
        const hasItem = columns.some((c: any) => c.name === 'item');
        if (!hasItem) {
          console.log('[DB] Migrando tabla beneficiarios desde schema antiguo...');
          await db.execAsync('ALTER TABLE beneficiarios RENAME TO beneficiarios_sociodemograficos');
          await db.execAsync(`
            CREATE TABLE IF NOT EXISTS beneficiarios (
              item INTEGER PRIMARY KEY,
              corregimiento TEXT NOT NULL,
              vereda TEXT NOT NULL,
              nombre_completo TEXT NOT NULL,
              cedula TEXT NOT NULL DEFAULT '',
              tecnico_asignado_id TEXT,
              tecnico_asignado_nombre TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          `);
          console.log('[DB] Tabla beneficiarios migrada exitosamente');
        }
      }
    } catch (e) {
      console.warn('[DB] No se pudo verificar schema de beneficiarios:', e);
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
    // Antes hacía `console.warn` + `return`, así que el llamador creía que el
    // formulario estaba guardado y a continuación borraba el borrador: la
    // encuesta completa desaparecía sin dejar rastro. Debe fallar de verdad.
    throw new Error(
      'La base de datos local no está disponible — el formulario NO se guardó'
    );
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
 * Si no, devuelve todos (para coordinadores/gerentes/admin).
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
 * Formularios que fueron purgados localmente porque el servidor dejó de
 * devolverlos (papelera de seguridad — ver tabla `formularios_purgados`).
 *
 * Sirve para que "se me eliminó el formulario" siempre tenga vuelta atrás:
 * el trabajo del técnico (datos, fotos, firmas) sigue en el teléfono hasta
 * que la papelera se vacíe a mano.
 */
export const getFormulariosPurgados = async (): Promise<
  { id: string; usuario_id: string | null; beneficiario_nombre: string | null; purgado_at: string; motivo: string | null }[]
> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    return await database.getAllAsync(
      `SELECT id, usuario_id, beneficiario_nombre, purgado_at, motivo
         FROM formularios_purgados ORDER BY purgado_at DESC`
    );
  } catch {
    return [];
  }
};

/**
 * Restaurar (total o parcialmente) la papelera de formularios purgados.
 *
 * ⚠️ Los formularios se restauran como **pendientes de sincronizar**
 * (`sincronizado = 0`) a propósito: el servidor ya no los tiene, así que si
 * se marcaran como sincronizados el próximo ciclo de sync los descartaría y
 * volverían a desaparecer. Quedan visibles y con su evidencia, listos para
 * reenviarse, en lugar de perderse.
 */
export const restaurarFormulariosPurgados = async (ids?: string[]): Promise<number> => {
  const database = await ensureDb();
  if (!database) return 0;
  try {
    const filas = await database.getAllAsync<{ id: string; payload_json: string }>(
      ids && ids.length > 0
        ? `SELECT id, payload_json FROM formularios_purgados WHERE id IN (${ids.map(() => '?').join(',')})`
        : 'SELECT id, payload_json FROM formularios_purgados',
      ids && ids.length > 0 ? ids : ([] as any)
    );

    let restaurados = 0;
    for (const fila of filas) {
      const row = parseSeguro<Record<string, any>>(fila.payload_json);
      if (!row?.id) continue;
      try {
        // Las columnas se toman del propio snapshot (se guardó con `SELECT *`),
        // así que nunca se pide una columna que no exista en esta versión del
        // esquema. `sincronizado` se fuerza a 0 aparte.
        const columnas = Object.keys(row).filter((k) => k !== 'sincronizado');
        if (!columnas.includes('id')) continue;
        const placeholders = columnas.map(() => '?').join(', ');
        const valores = columnas.map((k) => (row[k] === undefined ? null : row[k]));
        await database.runAsync(
          `INSERT OR REPLACE INTO formularios (${columnas.join(', ')}, sincronizado)
           VALUES (${placeholders}, 0)`,
          valores
        );
        await database.runAsync('DELETE FROM formularios_purgados WHERE id = ?', [row.id]);
        restaurados += 1;
      } catch (e) {
        console.warn('[DB] No se pudo restaurar el formulario purgado:', row.id, e);
      }
    }
    if (restaurados > 0) {
      console.log(`[DB] ${restaurados} formulario(s) restaurados desde la papelera`);
    }
    return restaurados;
  } catch (e) {
    console.warn('[DB] Error restaurando la papelera:', e);
    return 0;
  }
};

/**
 * Vaciar la papelera. Solo debería llamarse con el usuario delante: es la
 * única acción que hace definitivamente irrecuperable un formulario purgado.
 */
export const vaciarPapeleraFormularios = async (): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync('DELETE FROM formularios_purgados');
    console.log('[DB] Papelera de formularios vaciada');
  } catch (e) {
    console.warn('[DB] Error vaciando la papelera:', e);
  }
};

/**
 * Evidencias locales que ya se pueden borrar del dispositivo.
 *
 * Triple garantía antes de considerar una evidencia descartable:
 *  1. está marcada como sincronizada,
 *  2. tiene `archivo_id`, es decir el servidor confirmó la subida y se
 *     puede recuperar desde MinIO,
 *  3. es más antigua que `diasMinimos`.
 *
 * Sin las tres condiciones el archivo se conserva: es preferible ocupar
 * espacio que perder evidencia de campo.
 */
export const getEvidenciasPurgables = async (
  diasMinimos = 30
): Promise<string[]> => {
  const database = await ensureDb();
  if (!database) return [];

  const limite = new Date(Date.now() - diasMinimos * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = await database.getAllAsync<{ uri: string }>(
      `SELECT uri FROM fotos_locales
        WHERE sincronizada = 1 AND archivo_id IS NOT NULL AND archivo_id != '' AND timestamp < ?
       UNION ALL
       SELECT uri FROM videos_locales
        WHERE sincronizada = 1 AND archivo_id IS NOT NULL AND archivo_id != '' AND timestamp < ?`,
      [limite, limite]
    );
    return rows.map((r) => r.uri).filter(Boolean);
  } catch (e) {
    console.warn('[DB] Error buscando evidencias purgables:', e);
    return [];
  }
};

/**
 * Fusionar formularios traídos del servidor con los locales.
 *
 * Regla de conflicto: gana el `updated_at` más reciente. Así el trabajo
 * hecho offline en este dispositivo nunca es pisado por una copia vieja
 * del servidor, y a la vez un dispositivo nuevo recibe todo el historial
 * del técnico al iniciar sesión.
 *
 * Los formularios que entran del servidor se marcan como sincronizados
 * para que no vuelvan a encolarse para subida.
 *
 * También purga localmente los formularios que el servidor ya NO tiene
 * (p. ej. borrados por un admin desde otro dispositivo) — así un
 * dispositivo que los había cacheado antes deja de mostrarlos como
 * "fantasmas" tras el próximo refresco. Solo se purgan filas ya
 * `sincronizado = 1`; un borrador offline pendiente de subir jamás se
 * toca aunque no aparezca en `remotos`. Si se pasa `usuarioId`, la purga
 * se limita a las filas de ese usuario, porque `remotos` en ese caso solo
 * representa SU alcance completo (p. ej. la pantalla de técnico solo trae
 * sus propios formularios) — sin ese límite se borrarían por error datos
 * de otros usuarios que el fetch actual ni siquiera consultó.
 *
 * @returns cuántos formularios se insertaron o actualizaron desde el servidor
 */
export const mergeFormulariosDelServidor = async (
  remotos: Formulario[],
  opts?: { usuarioId?: string }
): Promise<{ aplicados: number; purgados: string[] }> => {
  const database = await ensureDb();
  if (!database) {
    console.warn('[DB] BD local no disponible — merge omitido');
    return { aplicados: 0, purgados: [] };
  }
  if (!remotos || remotos.length === 0) return { aplicados: 0, purgados: [] };

  let aplicados = 0;

  for (const remoto of remotos) {
    if (!remoto?.id) continue;
    try {
      const local = await database.getFirstAsync<Record<string, any>>(
        'SELECT id, updated_at, sincronizado FROM formularios WHERE id = ?',
        [remoto.id]
      );

      // Si existe local y es igual o más nuevo, conservar el local
      if (local?.updated_at && remoto.updated_at) {
        const tLocal = Date.parse(local.updated_at);
        const tRemoto = Date.parse(remoto.updated_at);
        if (Number.isFinite(tLocal) && Number.isFinite(tRemoto) && tLocal >= tRemoto) {
          continue;
        }
      }

      // El servidor devuelve usuario_id como columna propia; si el técnico
      // embebido no lo trae, usarlo como respaldo para que el filtrado por
      // usuario en getFormulariosLocales siga funcionando.
      const usuarioId =
        remoto.tecnico?.usuario_id || (remoto as any).usuario_id || null;

      await database.runAsync(
        `INSERT OR REPLACE INTO formularios (
          id, tipo, tecnico_json, beneficiario_json, actividad_json,
          sociodemografico_json, caracterizacion_nueva_json, coordenadas_json,
          georeferencia_json, clima_json, fotos_json,
          firma_beneficiario, firma_tecnico, huella_beneficiario,
          pdf_url, sincronizado, usuario_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          remoto.id,
          remoto.tipo,
          JSON.stringify(remoto.tecnico || {}),
          JSON.stringify(remoto.beneficiario || {}),
          JSON.stringify(remoto.actividad || {}),
          remoto.sociodemografico ? JSON.stringify(remoto.sociodemografico) : null,
          (remoto as any).caracterizacion_nueva
            ? JSON.stringify((remoto as any).caracterizacion_nueva)
            : null,
          remoto.coordenadas ? JSON.stringify(remoto.coordenadas) : null,
          remoto.georeferencia ? JSON.stringify(remoto.georeferencia) : null,
          remoto.clima ? JSON.stringify(remoto.clima) : null,
          JSON.stringify(remoto.fotos || []),
          remoto.firma_beneficiario || null,
          remoto.firma_tecnico || null,
          remoto.huella_beneficiario ? 1 : 0,
          remoto.pdf_url || null,
          usuarioId,
          remoto.created_at,
          remoto.updated_at,
        ]
      );
      aplicados++;
    } catch (e) {
      console.warn('[DB] No se pudo fusionar formulario del servidor:', remoto.id, e);
    }
  }

  if (aplicados > 0) {
    console.log(`[DB] ${aplicados} formulario(s) traídos del servidor`);
  }

  const purgados: string[] = [];
  try {
    const idsRemotos = new Set(remotos.map((r) => r.id));
    const sincronizadosLocales = await database.getAllAsync<{ id: string }>(
      opts?.usuarioId
        ? 'SELECT id FROM formularios WHERE sincronizado = 1 AND usuario_id = ?'
        : 'SELECT id FROM formularios WHERE sincronizado = 1',
      opts?.usuarioId ? [opts.usuarioId] : ([] as any)
    );

    const habriaQuePurgar = sincronizadosLocales.filter((row) => !idsRemotos.has(row.id));

    // 🛡️ FRENO DE SEGURIDAD CONTRA RESPUESTAS PARCIALES.
    //
    // Esta purga asume que `remotos` es el conjunto COMPLETO de formularios
    // del usuario. Si esa suposición se rompe (una respuesta truncada, un
    // `limit`/filtro de fechas que se agregue al endpoint, un rol que cambia
    // de alcance, un error de red que devuelve un subconjunto…), la app
    // borraría de golpe montones de formularios legítimos creyendo que "ya
    // no existen en el servidor".
    //
    // Cuando la desaparición es masiva (más de la mitad de lo local, y al
    // menos 5 registros) es mucho más probable que la lista remota esté
    // incompleta que que alguien borrara todo. En ese caso NO se purga: solo
    // se avisa por consola. Preferimos dejar filas "fantasma" (que se pueden
    // reclasificar) antes que borrar el trabajo de un técnico.
    const totalLocalSync = sincronizadosLocales.length;
    const proporcionDesaparicion =
      totalLocalSync > 0 ? habriaQuePurgar.length / totalLocalSync : 0;
    const sospechoso =
      habriaQuePurgar.length >= 5 && proporcionDesaparicion > 0.5 && remotos.length < totalLocalSync;

    if (sospechoso) {
      console.warn(
        `[DB] ⚠️ Purga CANCELADA por seguridad: el servidor devolvió ${remotos.length} ` +
          `formulario(s) pero hay ${totalLocalSync} locales sincronizados ` +
          `(${habriaQuePurgar.length} desaparecerían). Se conservan para no perder trabajo de campo.`
      );
    } else {
      // La tabla se crea también en runMigrations, pero aquella migración va
      // dentro de un bloque con timeout: si el teléfono está lento y el bloque
      // se corta antes del final, aquí no habría papelera. Es idempotente y
      // barata, así que se asegura justo antes de usarla.
      try {
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS formularios_purgados (
            id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            usuario_id TEXT,
            usuario_nombre TEXT,
            beneficiario_nombre TEXT,
            purgado_at TEXT NOT NULL,
            motivo TEXT
          );
        `);
      } catch (e) {
        console.warn('[DB] No se pudo asegurar la papelera de formularios:', e);
      }

      for (const row of habriaQuePurgar) {
        // 📦 Copia de seguridad ANTES de borrar (ver tabla `formularios_purgados`).
        //
        // Regla de oro: si NO se pudo guardar la copia, NO se borra. Es mejor
        // dejar una fila "fantasma" en la lista que perder el trabajo de campo
        // sin posibilidad de recuperarlo.
        let respaldado = false;
        try {
          const completa = await database.getFirstAsync<Record<string, any>>(
            'SELECT * FROM formularios WHERE id = ?',
            [row.id]
          );
          if (!completa) {
            // La fila ya no está: no hay nada que perder ni que respaldar.
            respaldado = true;
          } else {
            const tecnico = parseSeguro(completa.tecnico_json) as any;
            const beneficiario = parseSeguro(completa.beneficiario_json) as any;
            await database.runAsync(
              `INSERT OR REPLACE INTO formularios_purgados
                 (id, payload_json, usuario_id, usuario_nombre, beneficiario_nombre, purgado_at, motivo)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                row.id,
                JSON.stringify(completa),
                completa.usuario_id || null,
                tecnico?.nombre || null,
                beneficiario?.nombre || null,
                new Date().toISOString(),
                'El servidor ya no lo devolvía en la lista de formularios',
              ]
            );
            respaldado = true;
          }
        } catch (e) {
          console.warn('[DB] No se pudo respaldar el formulario purgado:', row.id, e);
        }

        if (!respaldado) {
          console.warn(
            `[DB] 🛡️ No se purga ${row.id}: no se pudo guardar la copia de seguridad. ` +
              'Se conserva el formulario en el teléfono.'
          );
          continue;
        }

        await database.runAsync('DELETE FROM sync_queue WHERE formulario_id = ?', [row.id]);
        await database.runAsync('DELETE FROM formularios WHERE id = ?', [row.id]);
        purgados.push(row.id);
      }
      if (purgados.length > 0) {
        console.warn(
          `[DB] ${purgados.length} formulario(s) locales purgados (ya no existen en el servidor). ` +
            'Copia de seguridad guardada en `formularios_purgados`.'
        );
      }
    }
  } catch (e) {
    console.warn('[DB] Error purgando formularios eliminados del servidor:', e);
  }

  return { aplicados, purgados };
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
  // Sin esto, un formulario borrado que todavía tuviera una entrada
  // pendiente en sync_queue quedaba huérfano ahí y el próximo ciclo de
  // sync intentaba reenviarlo al servidor con su payload viejo.
  await database.runAsync('DELETE FROM sync_queue WHERE formulario_id = ?', [id]);
  await database.runAsync('DELETE FROM formularios WHERE id = ?', [id]);
};

/**
 * Marcar formulario como sincronizado
 */
export const markAsSynced = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) {
    throw new Error('La base local no está disponible; el formulario sigue pendiente de sincronización');
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
    throw new Error('La base local no está disponible; no se pudieron consultar formularios pendientes');
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
  const database = await ensureDb();
  if (!database) return;
  await database.runAsync(
    `INSERT INTO sync_queue (formulario_id, accion, payload_json, created_at)
     VALUES (?, ?, ?, ?)`,
    [formularioId, accion, JSON.stringify(formulario), new Date().toISOString()]
  );
};

export const getSyncQueue = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  return await database.getAllAsync<Record<string, any>>(
    'SELECT * FROM sync_queue ORDER BY created_at ASC'
  );
};

export const clearSyncQueueItem = async (id: number): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  await database.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
};

// --- Fotos locales ---

export const saveFotoLocal = async (
  id: string,
  formularioId: string,
  uri: string,
  coordenadas?: Coordenadas,
  beneficiario?: { cedula?: string; nombre?: string },
  tipoFormulario?: string
): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base de datos local no está disponible; la foto no quedó en la cola de sincronización');
  // ON CONFLICT DO UPDATE (no INSERT OR REPLACE): un REPLACE borra la fila
  // entera y la vuelve a crear, así que cualquier columna que no se liste
  // aquí —sincronizada, archivo_id, ruta_remota— vuelve a su valor por
  // defecto. Esta función se reinvoca a cada rato (autoguardado cada
  // pocos segundos, "Guardar borrador") para TODAS las fotos del
  // formulario, ya estén subidas o no, así que con REPLACE una foto ya
  // subida quedaba marcada como pendiente otra vez en cada autoguardado
  // — de ahí las subidas duplicadas que veíamos en el servidor. El UPDATE
  // parcial preserva el estado de sincronización si ya existía.
  await database.runAsync(
    `INSERT INTO fotos_locales (id, formulario_id, uri, latitud, longitud, altitud, timestamp, beneficiario_cedula, beneficiario_nombre, tipo_formulario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       formulario_id = excluded.formulario_id,
       uri = excluded.uri,
       latitud = excluded.latitud,
       longitud = excluded.longitud,
       altitud = excluded.altitud,
       timestamp = excluded.timestamp,
       beneficiario_cedula = excluded.beneficiario_cedula,
       beneficiario_nombre = excluded.beneficiario_nombre,
       tipo_formulario = excluded.tipo_formulario`,
    [
      id,
      formularioId,
      uri,
      coordenadas?.latitud || null,
      coordenadas?.longitud || null,
      coordenadas?.altitud || null,
      new Date().toISOString(),
      beneficiario?.cedula || null,
      beneficiario?.nombre || null,
      tipoFormulario || null,
    ]
  );
};

/**
 * Marcar una foto local como sincronizada
 */
export const markFotoAsSynced = async (
  id: string,
  remoto?: { archivoId?: string; ruta?: string }
): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; la foto sigue pendiente de sincronización');
  // Se guarda la referencia en MinIO (id de archivo y ruta) para poder
  // recuperar la evidencia desde otro dispositivo: la `uri` local apunta
  // al almacenamiento del teléfono que la capturó y allí no existe.
  await database.runAsync(
    'UPDATE fotos_locales SET sincronizada = 1, archivo_id = ?, ruta_remota = ? WHERE id = ?',
    [remoto?.archivoId || null, remoto?.ruta || null, id]
  );
};

/**
 * Obtener fotos locales pendientes de sincronizar para un formulario
 */
export const getUnsyncedPhotos = async (
  formularioId: string
): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  return await database.getAllAsync<Record<string, any>>(
    'SELECT * FROM fotos_locales WHERE formulario_id = ? AND sincronizada = 0',
    [formularioId]
  );
};

/**
 * TODAS las evidencias pendientes de subir, sin importar el formulario.
 *
 * Necesario porque un formulario puede quedar marcado como sincronizado
 * mientras alguna de sus fotos sigue pendiente: al dejar de aparecer en
 * `getPendingSyncForms`, esas evidencias quedaban huérfanas del ciclo de
 * sincronización y no se subían jamás.
 */
export const getEvidenciasPendientes = async (): Promise<{
  fotos: Record<string, any>[];
  videos: Record<string, any>[];
}> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar evidencias pendientes');
  try {
    // Sin filtro por formulario_id: una evidencia capturada antes de que
    // exista el formulario en curso se encola con formulario_id = '' (ver
    // CamaraScreen.guardarEvidenciaInmediata). Antes se filtraba por
    // `formulario_id != ''` y esas capturas quedaban fuera del barrido para
    // siempre: el archivo existía en disco pero nunca se subía, y el técnico
    // lo reportaba como "se borraron las fotos".
    const [fotos, videos] = await Promise.all([
      database.getAllAsync<Record<string, any>>(
        'SELECT * FROM fotos_locales WHERE sincronizada = 0'
      ),
      database.getAllAsync<Record<string, any>>(
        'SELECT * FROM videos_locales WHERE sincronizada = 0'
      ),
    ]);
    return { fotos, videos };
  } catch (e) {
    console.warn('[DB] Error leyendo evidencias pendientes:', e);
    throw e;
  }
};

// --- Videos locales ---

export const saveVideoLocal = async (
  id: string,
  formularioId: string,
  uri: string,
  coordenadas?: Coordenadas,
  beneficiario?: { cedula?: string; nombre?: string },
  tipoFormulario?: string
): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base de datos local no está disponible; el video no quedó en la cola de sincronización');
  // Ver nota en saveFotoLocal: UPDATE parcial en vez de INSERT OR REPLACE,
  // para no resetear sincronizada/archivo_id/ruta_remota de un video que
  // ya se había subido.
  await database.runAsync(
    `INSERT INTO videos_locales (id, formulario_id, uri, latitud, longitud, timestamp, beneficiario_cedula, beneficiario_nombre, tipo_formulario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       formulario_id = excluded.formulario_id,
       uri = excluded.uri,
       latitud = excluded.latitud,
       longitud = excluded.longitud,
       timestamp = excluded.timestamp,
       beneficiario_cedula = excluded.beneficiario_cedula,
       beneficiario_nombre = excluded.beneficiario_nombre,
       tipo_formulario = excluded.tipo_formulario`,
    [
      id,
      formularioId,
      uri,
      coordenadas?.latitud || null,
      coordenadas?.longitud || null,
      new Date().toISOString(),
      beneficiario?.cedula || null,
      beneficiario?.nombre || null,
      tipoFormulario || null,
    ]
  );
};

/**
 * Marcar un video local como sincronizado
 */
export const markVideoAsSynced = async (
  id: string,
  remoto?: { archivoId?: string; ruta?: string }
): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; el video sigue pendiente de sincronización');
  await database.runAsync(
    'UPDATE videos_locales SET sincronizada = 1, archivo_id = ?, ruta_remota = ? WHERE id = ?',
    [remoto?.archivoId || null, remoto?.ruta || null, id]
  );
};

/**
 * Obtener videos locales pendientes de sincronizar
 */
export const getUnsyncedVideos = async (
  formularioId: string
): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) return [];
  return await database.getAllAsync<Record<string, any>>(
    'SELECT * FROM videos_locales WHERE formulario_id = ? AND sincronizada = 0',
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
  const database = await ensureDb();
  if (!database) return;
  await database.runAsync(
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
  const database = await ensureDb();
  if (!database) return null;
  return await database.getFirstAsync<Record<string, any>>(
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
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudo limpiar la cola del formulario');
  await database.runAsync(
    'DELETE FROM sync_queue WHERE formulario_id = ?',
    [formularioId]
  );
};

/**
 * Reiniciar el contador de intentos de sync para un formulario (reintento manual)
 */
export const resetSyncAttempts = async (formularioId: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  await database.runAsync(
    'UPDATE sync_queue SET intentos = 0 WHERE formulario_id = ?',
    [formularioId]
  );
};

// --- Utilidades ---

/** JSON.parse que nunca lanza (devuelve `fallback` si el texto es inválido). */
const parseSeguro = <T>(texto: string | null | undefined, fallback: T | null = null): T | null => {
  if (!texto) return fallback;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return fallback;
  }
};

const deserializeFormulario = (row: Record<string, any>): Formulario => {
  const safeJsonParse = (val: string | null, fallback: Record<string, any> = {}) => {
    if (!val) return fallback;
    try { return JSON.parse(val); }
    catch { return fallback; }
  };

  const tecnico = safeJsonParse(row.tecnico_json, { nombre: '', cedula: '', telefono: '', email: '' });

  const form: Record<string, any> = {
    id: row.id,
    tipo: row.tipo,
    // Dueño de la visita. Mismo criterio (y mismo orden) que valida el
    // backend en PATCH /formularios/:id/respuesta: el snapshot
    // `tecnico_json.usuario_id` manda — es la atribución vigente, la
    // reescribe PUT /api/beneficiarios/:item/asignacion al reasignar el
    // beneficiario, y POST /formularios/guardar la protege de snapshots
    // viejos que lleguen de un dispositivo desactualizado. La columna
    // `usuario_id` es el respaldo para filas antiguas sin snapshot.
    //
    // Antes esta clave se omitía al deserializar, así que el objeto
    // `Formulario` llegaba a las pantallas SIN dueño y el botón
    // «✎ Completar» nunca aparecía para ningún técnico, ni siquiera en los
    // formularios propios.
    usuario_id: tecnico.usuario_id || row.usuario_id || undefined,
    tecnico,
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
// ==================================================================
// Documentos de la finca
// ==================================================================
// Los documentos pertenecen al BENEFICIARIO, no a una visita puntual.
// Se consultan por cédula para que sigan disponibles en toda visita
// posterior a la misma finca.

/**
 * Documentos de una finca. Si se pasa `formularioId`, también incluye los
 * documentos de esa visita que todavía no tienen cédula asignada (recién
 * capturados o provenientes de BDs antiguas).
 */
export const getDocumentosDeBeneficiario = async (
  cedula?: string,
  formularioId?: string
): Promise<DocumentoFinca[]> => {
  const database = await ensureDb();
  if (!database) return [];

  const cedulaLimpia = cedula?.trim();
  try {
    if (cedulaLimpia && formularioId) {
      return (await database.getAllAsync<any>(
        `SELECT * FROM documentos_finca
         WHERE beneficiario_cedula = ?
            OR (formulario_id = ? AND (beneficiario_cedula IS NULL OR beneficiario_cedula = ''))
         ORDER BY created_at DESC`,
        [cedulaLimpia, formularioId]
      )) as DocumentoFinca[];
    }
    if (cedulaLimpia) {
      return (await database.getAllAsync<any>(
        'SELECT * FROM documentos_finca WHERE beneficiario_cedula = ? ORDER BY created_at DESC',
        [cedulaLimpia]
      )) as DocumentoFinca[];
    }
    if (formularioId) {
      return (await database.getAllAsync<any>(
        'SELECT * FROM documentos_finca WHERE formulario_id = ? ORDER BY created_at DESC',
        [formularioId]
      )) as DocumentoFinca[];
    }
    return [];
  } catch (e) {
    console.warn('[DB] Error leyendo documentos de finca:', e);
    return [];
  }
};

/** Guardar (o reemplazar) un documento de finca */
export const saveDocumentoLocal = async (doc: DocumentoFinca): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('BD local no disponible');

  // Ver nota en saveFotoLocal: UPDATE parcial en vez de INSERT OR REPLACE,
  // para no resetear `sincronizado` si el id ya existía (hoy esta función
  // solo se llama una vez por documento nuevo, pero un REPLACE deja la
  // trampa lista para el día que alguien la vuelva a invocar, como pasó
  // con fotos/video).
  await database.runAsync(
    `INSERT INTO documentos_finca
       (id, formulario_id, beneficiario_cedula, tipo, uri, nombre, descripcion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       formulario_id = excluded.formulario_id,
       beneficiario_cedula = excluded.beneficiario_cedula,
       tipo = excluded.tipo,
       uri = excluded.uri,
       nombre = excluded.nombre,
       descripcion = excluded.descripcion,
       created_at = excluded.created_at`,
    [
      doc.id,
      doc.formulario_id,
      doc.beneficiario_cedula?.trim() || null,
      doc.tipo,
      doc.uri,
      doc.nombre,
      doc.descripcion || null,
      doc.created_at,
    ]
  );
};

/** Documentos de finca pendientes de subir al servidor */
export const getDocumentosNoSincronizados = async (): Promise<DocumentoFinca[]> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar documentos pendientes');
  try {
    return (await database.getAllAsync<any>(
      'SELECT * FROM documentos_finca WHERE sincronizado = 0 OR sincronizado IS NULL ORDER BY created_at ASC'
    )) as DocumentoFinca[];
  } catch (e) {
    console.warn('[DB] Error leyendo documentos pendientes:', e);
    throw e;
  }
};

/** Marcar un documento de finca como subido al servidor */
export const marcarDocumentoSincronizado = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; el documento sigue pendiente de sincronización');
  await database.runAsync('UPDATE documentos_finca SET sincronizado = 1 WHERE id = ?', [id]);
};

/** Eliminar un documento de finca */
export const deleteDocumentoLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  await database.runAsync('DELETE FROM documentos_finca WHERE id = ?', [id]);
};

/**
 * Vincular documentos huérfanos (capturados antes de que existiera el ID
 * definitivo del formulario) al formulario y beneficiario correctos.
 *
 * IMPORTANTE: se filtra por cédula del beneficiario. Sin ese filtro, los
 * documentos huérfanos de CUALQUIER finca se reasignaban a la primera que
 * abriera la pantalla — contaminación cruzada entre beneficiarios.
 */
export const vincularDocumentosHuerfanos = async (
  formularioId: string,
  cedula?: string
): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  if (!formularioId || formularioId === 'sin-formulario') return;

  const cedulaLimpia = cedula?.trim();
  try {
    if (cedulaLimpia) {
      // Huérfanos de ESTA finca: por cédula ya asignada, o por el marcador
      // temporal 'sin-formulario' que aún no tiene dueño.
      await database.runAsync(
        `UPDATE documentos_finca
            SET formulario_id = ?, beneficiario_cedula = ?
          WHERE (beneficiario_cedula = ? OR formulario_id = ?)
            AND (formulario_id = 'sin-formulario' OR formulario_id IS NULL
                 OR formulario_id = '' OR beneficiario_cedula IS NULL
                 OR beneficiario_cedula = '')`,
        [formularioId, cedulaLimpia, cedulaLimpia, formularioId]
      );
    } else {
      // Sin cédula no se puede desambiguar: solo se tocan los documentos
      // de este mismo formulario, nunca los de otras fincas.
      await database.runAsync(
        `UPDATE documentos_finca SET formulario_id = ?
          WHERE formulario_id = ?`,
        [formularioId, formularioId]
      );
    }
  } catch (e) {
    console.warn('[DB] No se pudieron vincular documentos huérfanos:', e);
  }
};

export const runMigrations = async (): Promise<void> => {
  if (!db) return;
  try {
    await db.execAsync(`
      -- Documentos digitales de fincas
      -- Los documentos pertenecen al BENEFICIARIO (la finca), no a una
      -- visita concreta: persisten entre formularios y nunca se pierden.
      -- formulario_id se conserva como referencia de la visita que los
      -- capturó, pero la consulta canónica es por beneficiario_cedula.
      CREATE TABLE IF NOT EXISTS documentos_finca (
        id TEXT PRIMARY KEY,
        formulario_id TEXT NOT NULL,
        beneficiario_cedula TEXT,
        tipo TEXT NOT NULL,
        uri TEXT NOT NULL,
        nombre TEXT,
        descripcion TEXT,
        created_at TEXT NOT NULL,
        sincronizado INTEGER DEFAULT 0
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
        sincronizado INTEGER DEFAULT 0,
        sesion_id TEXT
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
        icono TEXT DEFAULT '🌱',
        poligono_json TEXT DEFAULT NULL,
        beneficiario_cedula TEXT DEFAULT NULL,
        beneficiario_nombre TEXT DEFAULT NULL,
        vereda TEXT DEFAULT NULL,
        corregimiento TEXT DEFAULT NULL
      );

      -- Visitas programadas (compartidas entre el equipo vía servidor)
      CREATE TABLE IF NOT EXISTS visitas_programadas (
        id TEXT PRIMARY KEY,
        usuario_id TEXT,
        usuario_nombre TEXT,
        titulo TEXT,
        ubicacion TEXT,
        fecha TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        beneficiario_cedula TEXT,
        beneficiario_nombre TEXT,
        actividad_numero INTEGER,
        vereda TEXT,
        corregimiento TEXT,
        timestamp TEXT NOT NULL,
        sincronizado INTEGER DEFAULT 0
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

      -- Seguimientos de Coordinación/Interventoría (offline-first, igual que
      -- formularios): el rol superior puede registrar su acompañamiento en
      -- campo sin conexión, junto al técnico, y se sincroniza solo cuando
      -- vuelve la señal. Las fotos de evidencia van embebidas en fotos_json
      -- (uri local + archivo_id una vez subidas), no en fotos_locales — un
      -- seguimiento es una sola fila autocontenida, sin las demás columnas
      -- que sí necesita un formulario completo del técnico.
      CREATE TABLE IF NOT EXISTS seguimientos_locales (
        id TEXT PRIMARY KEY,
        autor_id TEXT,
        autor_nombre TEXT,
        autor_rol TEXT NOT NULL,
        beneficiario_cedula TEXT,
        beneficiario_nombre TEXT,
        -- Visita (formulario del técnico) desde la cual se registró este
        -- seguimiento — NULL cuando se hace desde la tarjeta general de
        -- inicio, que no amarra ningún beneficiario.
        formulario_id TEXT,
        actividad TEXT NOT NULL DEFAULT '',
        objetivo_visita TEXT,
        descripcion_actividad TEXT,
        observaciones TEXT,
        fotos_json TEXT DEFAULT '[]',
        videos_json TEXT DEFAULT '[]',
        firma_beneficiario TEXT,
        firma_autor TEXT,
        geo_latitud REAL,
        geo_longitud REAL,
        geo_altitud REAL,
        geo_precision REAL,
        huella_beneficiario INTEGER DEFAULT 0,
        pdf_url TEXT,
        sincronizado INTEGER DEFAULT 0,
        completado INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- ⚠️ PAPELERA DE SEGURIDAD (no la borres sin leer esto)
      --
      -- Cuando el servidor deja de devolver un formulario (porque un admin o
      -- un interventor lo eliminó en el panel web), el merge de formularios
      -- lo purga del SQLite local para que no quede como "fantasma" en la lista.
      -- Esa purga es irreversible desde la app, así que antes de borrar la fila
      -- se guarda aquí una copia completa del formulario tal como lo tenía el
      -- técnico (con fotos, firmas y huella).
      --
      -- Motivo: en campo, un formulario es el trabajo de media jornada de un
      -- técnico. El borrado en el panel puede ser un error humano o una prueba,
      -- y sin esta copia el técnico se quedaba sin nada que mostrar. Con esta
      -- tabla, "se me eliminó el formulario" siempre es recuperable.
      CREATE TABLE IF NOT EXISTS formularios_purgados (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        usuario_id TEXT,
        usuario_nombre TEXT,
        beneficiario_nombre TEXT,
        purgado_at TEXT NOT NULL,
        motivo TEXT
      );
    `);

    // Migración: referencia remota de las evidencias en MinIO.
    // La `uri` local solo sirve en el teléfono que capturó la evidencia;
    // guardar el id de archivo y la ruta permite recuperarla desde otro.
    //
    // Además se guarda el contexto del beneficiario/formulario en el momento
    // de la captura (beneficiario_cedula, beneficiario_nombre, tipo_formulario):
    // sin esto, el barrido de "evidencias huérfanas" (subirEvidenciasHuerfanas
    // en SyncContext) reintentaba la subida sin ese contexto y el backend
    // guardaba la foto en la carpeta genérica del técnico en vez de la del
    // beneficiario correspondiente.
    for (const tabla of ['fotos_locales', 'videos_locales']) {
      for (const columna of [
        'archivo_id TEXT',
        'ruta_remota TEXT',
        'beneficiario_cedula TEXT',
        'beneficiario_nombre TEXT',
        'tipo_formulario TEXT',
      ]) {
        try {
          await db.runAsync(`ALTER TABLE ${tabla} ADD COLUMN ${columna}`);
        } catch {
          // Ya existe, ignorar
        }
      }
    }

    // Migración: columnas de la base verificada de 300 beneficiarios
    // (ubicación administrativa, contacto y predio) — instalaciones previas
    // a esta versión solo tenían corregimiento/vereda/nombre/cedula.
    for (const columna of [
      'departamento TEXT',
      'municipio TEXT',
      'telefono TEXT',
      'nombre_predio TEXT',
      'area_predio REAL',
      'latitud REAL',
      'longitud REAL',
      'correo_electronico TEXT',
      'calidad_predio TEXT',
    ]) {
      try {
        await db.runAsync(`ALTER TABLE beneficiarios ADD COLUMN ${columna}`);
      } catch {
        // Ya existe, ignorar
      }
    }

    // Migración: cola de sincronización de documentos de finca.
    // La tabla no tenía estado de sincronización y SyncContext ni la miraba:
    // un documento capturado sin señal (el caso normal en campo) NUNCA llegaba
    // al servidor, mientras la app decía "guardado (local + MinIO)".
    try {
      await db.runAsync('ALTER TABLE documentos_finca ADD COLUMN sincronizado INTEGER DEFAULT 0');
      console.log('[DB] Columna sincronizado agregada a documentos_finca');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: documentos de finca por beneficiario (no por visita).
    // Antes los documentos colgaban solo de formulario_id, así que en la
    // siguiente visita a la misma finca "desaparecían". Ahora se anclan a
    // la cédula del beneficiario y persisten para siempre.
    try {
      await db.runAsync('ALTER TABLE documentos_finca ADD COLUMN beneficiario_cedula TEXT');
      console.log('[DB] Columna beneficiario_cedula agregada a documentos_finca');
    } catch {
      // Ya existe, ignorar
    }

    // Backfill: rellenar la cédula de los documentos históricos a partir
    // del formulario que los capturó. Solo toca filas sin cédula.
    try {
      const huerfanos = await db.getAllAsync<{ id: string; formulario_id: string }>(
        `SELECT id, formulario_id FROM documentos_finca
         WHERE (beneficiario_cedula IS NULL OR beneficiario_cedula = '')
           AND formulario_id IS NOT NULL AND formulario_id != ''`
      );
      let rellenados = 0;
      for (const doc of huerfanos) {
        const form = await db.getFirstAsync<{ beneficiario_json: string }>(
          'SELECT beneficiario_json FROM formularios WHERE id = ?',
          [doc.formulario_id]
        );
        if (!form?.beneficiario_json) continue;
        try {
          const cedula = JSON.parse(form.beneficiario_json)?.cedula;
          if (cedula) {
            await db.runAsync(
              'UPDATE documentos_finca SET beneficiario_cedula = ? WHERE id = ?',
              [String(cedula).trim(), doc.id]
            );
            rellenados++;
          }
        } catch {
          // JSON corrupto — dejar el documento sin cédula, no se pierde
        }
      }
      if (rellenados > 0) {
        console.log(`[DB] Backfill: ${rellenados} documento(s) vinculados a su beneficiario`);
      }
    } catch (e) {
      console.warn('[DB] No se pudo hacer backfill de documentos_finca:', e);
    }

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

    // Migración: agregar columna poligono_json a plantaciones (BDs antiguas)
    try {
      await db.runAsync('ALTER TABLE plantaciones ADD COLUMN poligono_json TEXT DEFAULT NULL');
      console.log('[DB] Columna poligono_json agregada a plantaciones');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar columnas de beneficiario/vereda a plantaciones (BDs antiguas)
    for (const col of ['beneficiario_cedula', 'beneficiario_nombre', 'vereda', 'corregimiento']) {
      try {
        await db.runAsync(`ALTER TABLE plantaciones ADD COLUMN ${col} TEXT DEFAULT NULL`);
        console.log(`[DB] Columna ${col} agregada a plantaciones`);
      } catch {
        // Ya existe, ignorar
      }
    }

    // Migración: columnas de programación por beneficiario y visita numerada.
    // `usuario_nombre` guarda quién creó la planificación (puede ser técnico,
    // interventor, coordinador, etc.) — antes solo llegaba por el JOIN del
    // backend, así que la visita recién creada en el dispositivo aparecía sin
    // el nombre hasta que el servidor la devolvía en un refresco.
    for (const col of [
      'beneficiario_cedula TEXT',
      'beneficiario_nombre TEXT',
      'actividad_numero INTEGER',
      'vereda TEXT',
      'corregimiento TEXT',
      'usuario_nombre TEXT',
    ]) {
      try {
        await db.runAsync(`ALTER TABLE visitas_programadas ADD COLUMN ${col}`);
      } catch {
        // Ya existe, ignorar
      }
    }

    // Migración: agregar columna sincronizado a tracking_posiciones si no existe
    try {
      await db.runAsync('ALTER TABLE tracking_posiciones ADD COLUMN sincronizado INTEGER DEFAULT 0');
      console.log('[DB] Columna sincronizado agregada a tracking_posiciones');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: agregar sesion_id a tracking_posiciones — agrupa las
    // posiciones de una misma ruta (Iniciar → Detener) para poder listarlas
    // y volver a dibujarlas después en el historial de rutas. Las posiciones
    // ya guardadas ANTES de esta migración quedan con sesion_id NULL (no se
    // pueden agrupar retroactivamente, pero tampoco rompen nada).
    try {
      await db.runAsync('ALTER TABLE tracking_posiciones ADD COLUMN sesion_id TEXT DEFAULT NULL');
      console.log('[DB] Columna sesion_id agregada a tracking_posiciones');
    } catch {
      // Ya existe, ignorar
    }

    // Migración: video y firmas (beneficiario + autor) en seguimientos_locales
    // — la tabla se creó sin estas columnas en la primera versión de la
    // función (solo fotos). firma_beneficiario/firma_autor guardan base64
    // mientras no se han subido, y el archivo_id de MinIO una vez sincronizadas.
    for (const columna of [
      'videos_json TEXT DEFAULT \'[]\'',
      'firma_beneficiario TEXT',
      'firma_autor TEXT',
      'geo_latitud REAL',
      'geo_longitud REAL',
      'geo_altitud REAL',
      'geo_precision REAL',
      'huella_beneficiario INTEGER DEFAULT 0',
      'formulario_id TEXT',
    ]) {
      try {
        await db.runAsync(`ALTER TABLE seguimientos_locales ADD COLUMN ${columna}`);
      } catch {
        // Ya existe, ignorar
      }
    }

    // Migración: columna `completado` — distingue un seguimiento TERMINADO
    // (se presionó "Guardar Seguimiento") de un borrador autoguardado a
    // medio llenar (igual idea que FormDraftStore para el técnico, pero en
    // la misma fila en vez de un store aparte, porque un seguimiento es una
    // sola fila simple). Los seguimientos guardados ANTES de que existiera
    // esta columna se marcan retroactivamente como completados (con la
    // versión anterior no había concepto de borrador, así que todo lo que
    // ya existe se trató siempre como terminado) — solo se hace una vez,
    // justo cuando la columna se crea por primera vez.
    try {
      await db.runAsync(`ALTER TABLE seguimientos_locales ADD COLUMN completado INTEGER DEFAULT 0`);
      await db.runAsync(`UPDATE seguimientos_locales SET completado = 1`);
      console.log('[DB] ✅ Columna completado agregada a seguimientos_locales (backfill: registros previos marcados como completados)');
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

// === Historial de rutas (sesiones de tracking) ===

export interface SesionRutaResumen {
  sesionId: string;
  inicio: string;
  fin: string;
  totalPuntos: number;
  distanciaKm: number;
}

const haversineKm = (
  a: { latitud: number; longitud: number },
  b: { latitud: number; longitud: number }
): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitud - a.latitud);
  const dLon = toRad(b.longitud - a.longitud);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitud)) * Math.cos(toRad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

/**
 * Lista las rutas (sesiones de tracking) guardadas de un técnico, más
 * recientes primero — cada una es un trayecto completo entre "Iniciar Ruta"
 * y "Detener". Las posiciones grabadas antes de que existiera sesion_id
 * quedan fuera (no se pueden agrupar retroactivamente).
 */
export const getSesionesRuta = async (usuarioId: string): Promise<SesionRutaResumen[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      `SELECT * FROM tracking_posiciones WHERE usuario_id = ? AND sesion_id IS NOT NULL ORDER BY sesion_id, timestamp ASC`,
      [usuarioId]
    );
    const porSesion = new Map<string, Record<string, any>[]>();
    for (const r of rows) {
      const arr = porSesion.get(r.sesion_id) || [];
      arr.push(r);
      porSesion.set(r.sesion_id, arr);
    }
    const resumenes: SesionRutaResumen[] = [];
    for (const [sesionId, puntos] of porSesion.entries()) {
      let distanciaKm = 0;
      for (let i = 1; i < puntos.length; i++) {
        distanciaKm += haversineKm(puntos[i - 1] as any, puntos[i] as any);
      }
      resumenes.push({
        sesionId,
        inicio: puntos[0].timestamp,
        fin: puntos[puntos.length - 1].timestamp,
        totalPuntos: puntos.length,
        distanciaKm,
      });
    }
    return resumenes.sort((a, b) => b.inicio.localeCompare(a.inicio));
  } catch (error) {
    console.error('[DB] Error al obtener sesiones de ruta:', error);
    return [];
  }
};

/** Todas las posiciones de una ruta (sesión de tracking) puntual, en orden — para previsualizar/exportar. */
export const getPosicionesPorSesion = async (sesionId: string): Promise<PosicionTracking[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM tracking_posiciones WHERE sesion_id = ? ORDER BY timestamp ASC',
      [sesionId]
    );
    return rows.map((r) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      latitud: r.latitud,
      longitud: r.longitud,
      altitud: r.altitud ?? undefined,
      precision_gps: r.precision_gps ?? undefined,
      velocidad: r.velocidad ?? undefined,
      heading: r.heading ?? undefined,
      timestamp: r.timestamp,
      sincronizado: !!r.sincronizado,
      sesion_id: r.sesion_id,
    }));
  } catch (error) {
    console.error('[DB] Error al obtener posiciones de la sesión:', error);
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
  if (!database) throw new Error('La base de datos local no está disponible; el conteo no se guardó');
  try {
    const poligonoJson = plantacion.poligono ? JSON.stringify(plantacion.poligono) : null;
    await database.runAsync(
      `INSERT OR REPLACE INTO plantaciones (id, usuario_id, latitud, longitud, especie, cantidad, timestamp, sincronizado, icono, poligono_json, beneficiario_cedula, beneficiario_nombre, vereda, corregimiento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        poligonoJson,
        plantacion.beneficiario_cedula || null,
        plantacion.beneficiario_nombre || null,
        plantacion.vereda || null,
        plantacion.corregimiento || null,
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
      poligono: r.poligono_json ? JSON.parse(r.poligono_json) : undefined,
      beneficiario_cedula: r.beneficiario_cedula || undefined,
      beneficiario_nombre: r.beneficiario_nombre || undefined,
      vereda: r.vereda || undefined,
      corregimiento: r.corregimiento || undefined,
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
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar plantaciones pendientes');
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
      poligono: r.poligono_json ? JSON.parse(r.poligono_json) : undefined,
      beneficiario_cedula: r.beneficiario_cedula || undefined,
      beneficiario_nombre: r.beneficiario_nombre || undefined,
      vereda: r.vereda || undefined,
      corregimiento: r.corregimiento || undefined,
    }));
  } catch (error) {
    console.error('[DB] Error al obtener plantaciones no sincronizadas:', error);
    throw error;
  }
};

/**
 * Obtener posiciones de tracking pendientes de sincronizar
 */
export const getTrackingNoSincronizado = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar puntos GPS pendientes');
  try {
    return await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM tracking_posiciones WHERE sincronizado = 0 ORDER BY timestamp ASC'
    );
  } catch (error) {
    console.error('[DB] Error al obtener tracking no sincronizado:', error);
    throw error;
  }
};

/**
 * Obtener mediciones de terreno pendientes de sincronizar
 */
export const getMedicionesNoSincronizadas = async (): Promise<Record<string, any>[]> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar mediciones pendientes');
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM mediciones_terreno WHERE sincronizado = 0 ORDER BY created_at ASC'
    );
    return rows.map((row) => {
      let puntos: { latitud: number; longitud: number }[] = [];
      try {
        puntos = row.puntos_json ? JSON.parse(row.puntos_json) : [];
      } catch {
        puntos = [];
      }
      const areaHectareas = Number(row.area_hectareas) || 0;
      const medicionDeArea = areaHectareas > 0;
      return {
        id: row.id,
        usuario_id: row.usuario_id,
        formulario_id: row.formulario_id === 'mapa_directo' ? null : row.formulario_id,
        tipo_medicion: medicionDeArea ? 'area' : 'distancia',
        valor: medicionDeArea ? areaHectareas : Number(row.perimetro_metros) || 0,
        unidad: medicionDeArea ? 'hectareas' : 'metros',
        metadata_json: {
          area_hectareas: areaHectareas,
          area_metros2: Number(row.area_metros2) || 0,
          perimetro_metros: Number(row.perimetro_metros) || 0,
          puntos,
        },
        timestamp: row.created_at,
      };
    });
  } catch (error) {
    console.error('[DB] Error al obtener mediciones no sincronizadas:', error);
    throw error;
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
  if (!database) throw new Error(`La base local no está disponible; ${tabla}/${id} sigue pendiente de sincronización`);
  await database.runAsync(
    `UPDATE ${tabla} SET sincronizado = 1 WHERE id = ?`,
    [id]
  );
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

// === Funciones para Visitas Programadas (compartidas) ===

/**
 * Guardar una visita programada (crear o actualizar)
 */
export const saveVisitaProgramada = async (
  visita: import('../types').VisitaProgramada
): Promise<void> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base de datos local no está disponible; la visita no se guardó');
  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO visitas_programadas (
        id, usuario_id, usuario_nombre, titulo, ubicacion, fecha, estado,
        beneficiario_cedula, beneficiario_nombre, actividad_numero, vereda, corregimiento,
        timestamp, sincronizado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        visita.id,
        visita.usuario_id || null,
        visita.usuario_nombre || null,
        visita.titulo,
        visita.ubicacion,
        visita.fecha,
        visita.estado || 'pendiente',
        visita.beneficiario_cedula || null,
        visita.beneficiario_nombre || null,
        visita.actividad_numero ?? null,
        visita.vereda || null,
        visita.corregimiento || null,
        new Date().toISOString(),
        visita.sincronizado ? 1 : 0,
      ]
    );
  } catch (error) {
    console.error('[DB] Error al guardar visita programada:', error);
    throw error;
  }
};

/**
 * Obtener visitas programadas. Si se provee usuarioId, filtra solo las de
 * ese usuario (técnico); si no, devuelve todas (roles superiores).
 */
export const getVisitasProgramadas = async (
  usuarioId?: string
): Promise<import('../types').VisitaProgramada[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const query = usuarioId
      ? 'SELECT * FROM visitas_programadas WHERE usuario_id = ? ORDER BY fecha ASC'
      : 'SELECT * FROM visitas_programadas ORDER BY fecha ASC';
    const rows = await database.getAllAsync<Record<string, any>>(query, usuarioId ? [usuarioId] : []);
    return rows.filter(Boolean).map((r: Record<string, any>) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario_nombre || undefined,
      titulo: r.titulo,
      ubicacion: r.ubicacion,
      fecha: r.fecha,
      estado: r.estado || 'pendiente',
      beneficiario_cedula: r.beneficiario_cedula || undefined,
      beneficiario_nombre: r.beneficiario_nombre || undefined,
      actividad_numero: r.actividad_numero !== null && r.actividad_numero !== undefined ? Number(r.actividad_numero) : undefined,
      vereda: r.vereda || undefined,
      corregimiento: r.corregimiento || undefined,
      sincronizado: r.sincronizado === 1,
    }));
  } catch (error) {
    console.error('[DB] Error al obtener visitas programadas:', error);
    return [];
  }
};

/**
 * Obtener visitas programadas pendientes de sincronizar
 */
export const getVisitasProgramadasNoSincronizadas = async (): Promise<import('../types').VisitaProgramada[]> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar visitas pendientes');
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM visitas_programadas WHERE sincronizado = 0 ORDER BY fecha ASC'
    );
    return rows.filter(Boolean).map((r: Record<string, any>) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario_nombre || undefined,
      titulo: r.titulo,
      ubicacion: r.ubicacion,
      fecha: r.fecha,
      estado: r.estado || 'pendiente',
      beneficiario_cedula: r.beneficiario_cedula || undefined,
      beneficiario_nombre: r.beneficiario_nombre || undefined,
      actividad_numero: r.actividad_numero !== null && r.actividad_numero !== undefined ? Number(r.actividad_numero) : undefined,
      vereda: r.vereda || undefined,
      corregimiento: r.corregimiento || undefined,
      sincronizado: false,
    }));
  } catch (error) {
    console.error('[DB] Error al obtener visitas programadas no sincronizadas:', error);
    throw error;
  }
};

/**
 * Eliminar una visita programada local por ID
 */
export const deleteVisitaProgramadaLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync('DELETE FROM visitas_programadas WHERE id = ?', [id]);
    console.log('[DB] Visita programada local eliminada:', id);
  } catch (error) {
    console.error('[DB] Error al eliminar visita programada local:', error);
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
  if (!database) throw new Error('La base de datos local no está disponible; la medición no se guardó');
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

// ============================================================
// Seguimientos de Coordinación/Interventoría (offline-first)
// ============================================================

export interface FotoSeguimientoLocal {
  id: string;
  uri: string;
  /** Presente una vez que la foto se subió a MinIO durante la sincronización */
  archivo_id?: string;
}

export interface SeguimientoLocal {
  id: string;
  autor_id: string;
  autor_nombre: string;
  autor_rol: 'coordinador' | 'interventor';
  beneficiario_cedula?: string;
  beneficiario_nombre?: string;
  /** id del formulario (visita) del técnico al que queda amarrado este seguimiento, si se registró desde su detalle. */
  formulario_id?: string;
  actividad: string;
  objetivo_visita?: string;
  descripcion_actividad?: string;
  observaciones?: string;
  fotos: FotoSeguimientoLocal[];
  videos: FotoSeguimientoLocal[];
  /** 'data:...' (base64, pendiente de subir) o archivo_id de MinIO (ya sincronizada) */
  firma_beneficiario?: string;
  /** 'data:...' (base64, pendiente de subir) o archivo_id de MinIO (ya sincronizada) — firma de quien registra el seguimiento */
  firma_autor?: string;
  /** Georeferencia puntual (captura única de 8s de alta precisión — CapturaGPSPrecisa) */
  geo_latitud?: number;
  geo_longitud?: number;
  geo_altitud?: number;
  geo_precision?: number;
  /** Confirmación con huella del sensor del dispositivo (atestigua presencia, no identidad del beneficiario) */
  huella_beneficiario?: boolean;
  pdf_url?: string;
  sincronizado: boolean;
  /** false mientras es un borrador autoguardado; true solo al presionar "Guardar Seguimiento". Un seguimiento incompleto nunca se sincroniza. */
  completado: boolean;
  created_at: string;
  updated_at: string;
}

const deserializeSeguimiento = (row: Record<string, any>): SeguimientoLocal => {
  const parseFotos = (json: string | null): FotoSeguimientoLocal[] => {
    try {
      return json ? JSON.parse(json) : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    autor_id: row.autor_id,
    autor_nombre: row.autor_nombre,
    autor_rol: row.autor_rol,
    beneficiario_cedula: row.beneficiario_cedula || undefined,
    beneficiario_nombre: row.beneficiario_nombre || undefined,
    formulario_id: row.formulario_id || undefined,
    actividad: row.actividad,
    objetivo_visita: row.objetivo_visita || undefined,
    descripcion_actividad: row.descripcion_actividad || undefined,
    observaciones: row.observaciones || undefined,
    fotos: parseFotos(row.fotos_json),
    videos: parseFotos(row.videos_json),
    firma_beneficiario: row.firma_beneficiario || undefined,
    firma_autor: row.firma_autor || undefined,
    geo_latitud: row.geo_latitud != null ? Number(row.geo_latitud) : undefined,
    geo_longitud: row.geo_longitud != null ? Number(row.geo_longitud) : undefined,
    geo_altitud: row.geo_altitud != null ? Number(row.geo_altitud) : undefined,
    geo_precision: row.geo_precision != null ? Number(row.geo_precision) : undefined,
    huella_beneficiario: row.huella_beneficiario === 1,
    pdf_url: row.pdf_url || undefined,
    sincronizado: row.sincronizado === 1,
    completado: row.completado === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

/** Guardar (crear o actualizar) un seguimiento local — llamado en cada cambio relevante (borrador) y al presionar "Guardar". */
export const saveSeguimientoLocal = async (s: SeguimientoLocal): Promise<void> => {
  const database = await ensureDb();
  if (!database) {
    throw new Error('La base de datos local no está disponible — el seguimiento NO se guardó');
  }
  await database.runAsync(
    `INSERT OR REPLACE INTO seguimientos_locales
       (id, autor_id, autor_nombre, autor_rol, beneficiario_cedula, beneficiario_nombre, formulario_id,
        actividad, objetivo_visita, descripcion_actividad, observaciones, fotos_json,
        videos_json, firma_beneficiario, firma_autor, geo_latitud, geo_longitud, geo_altitud, geo_precision,
        huella_beneficiario, pdf_url, sincronizado, completado, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.autor_id,
      s.autor_nombre,
      s.autor_rol,
      s.beneficiario_cedula || null,
      s.beneficiario_nombre || null,
      s.formulario_id || null,
      s.actividad,
      s.objetivo_visita || null,
      s.descripcion_actividad || null,
      s.observaciones || null,
      JSON.stringify(s.fotos || []),
      JSON.stringify(s.videos || []),
      s.firma_beneficiario || null,
      s.firma_autor || null,
      s.geo_latitud ?? null,
      s.geo_longitud ?? null,
      s.geo_altitud ?? null,
      s.geo_precision ?? null,
      s.huella_beneficiario ? 1 : 0,
      s.pdf_url || null,
      s.sincronizado ? 1 : 0,
      s.completado ? 1 : 0,
      s.created_at,
      s.updated_at,
    ]
  );
};

/** Seguimientos locales TERMINADOS — coordinador/interventor ven solo los de su propio rol. Los borradores incompletos no aparecen aquí (ver getSeguimientosIncompletos). */
export const getSeguimientosLocales = async (autorRol?: string): Promise<SeguimientoLocal[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      autorRol
        ? 'SELECT * FROM seguimientos_locales WHERE autor_rol = ? AND completado = 1 ORDER BY created_at DESC'
        : 'SELECT * FROM seguimientos_locales WHERE completado = 1 ORDER BY created_at DESC',
      autorRol ? [autorRol] : []
    );
    return rows.map(deserializeSeguimiento);
  } catch (error) {
    console.error('[DB] Error al leer seguimientos locales:', error);
    return [];
  }
};

/** Borradores de seguimiento sin terminar (no se presionó "Guardar Seguimiento"), del autor indicado — para la pantalla de "Seguimientos Incompletos". */
export const getSeguimientosIncompletos = async (autorId?: string): Promise<SeguimientoLocal[]> => {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const rows = await database.getAllAsync<Record<string, any>>(
      autorId
        ? 'SELECT * FROM seguimientos_locales WHERE completado = 0 AND autor_id = ? ORDER BY updated_at DESC'
        : 'SELECT * FROM seguimientos_locales WHERE completado = 0 ORDER BY updated_at DESC',
      autorId ? [autorId] : []
    );
    return rows.map(deserializeSeguimiento);
  } catch (error) {
    console.error('[DB] Error al leer borradores de seguimiento:', error);
    return [];
  }
};

/** Un seguimiento local por id — para reabrir un borrador y continuar llenándolo. */
/**
 * Seguimiento ya registrado para una visita concreta (por formulario_id).
 * Se usa al abrir la revisión "en campo" de un formulario: si el revisor ya
 * había empezado/completado el seguimiento de esa visita, se retoma ese
 * mismo registro en vez de crear uno nuevo cada vez.
 */
export const getSeguimientoLocalPorFormulario = async (formularioId: string): Promise<SeguimientoLocal | null> => {
  const database = await ensureDb();
  if (!database) return null;
  try {
    const row = await database.getFirstAsync<any>(
      'SELECT * FROM seguimientos_locales WHERE formulario_id = ? ORDER BY updated_at DESC LIMIT 1',
      [formularioId]
    );
    return row ? deserializeSeguimiento(row) : null;
  } catch (e) {
    console.warn('[DB] Error leyendo seguimiento por formulario:', e);
    return null;
  }
};

export const getSeguimientoLocalById = async (id: string): Promise<SeguimientoLocal | null> => {
  const database = await ensureDb();
  if (!database) return null;
  try {
    const row = await database.getFirstAsync<Record<string, any>>(
      'SELECT * FROM seguimientos_locales WHERE id = ?',
      [id]
    );
    return row ? deserializeSeguimiento(row) : null;
  } catch (error) {
    console.error('[DB] Error al leer seguimiento por id:', error);
    return null;
  }
};

/** Eliminar un borrador de seguimiento (descartarlo desde "Seguimientos Incompletos"). */
export const eliminarSeguimientoLocal = async (id: string): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;
  try {
    await database.runAsync('DELETE FROM seguimientos_locales WHERE id = ?', [id]);
  } catch (error) {
    console.error('[DB] Error al eliminar seguimiento local:', error);
  }
};

/** Seguimientos TERMINADOS y pendientes de sincronizar (para el ciclo de sync) — los borradores incompletos nunca se suben. */
export const getSeguimientosNoSincronizados = async (): Promise<SeguimientoLocal[]> => {
  const database = await ensureDb();
  if (!database) throw new Error('La base local no está disponible; no se pudieron consultar seguimientos pendientes');
  try {
    // Se traen todos los terminados y el filtro fino se hace en JS (ver abajo).
    const rows = await database.getAllAsync<Record<string, any>>(
      'SELECT * FROM seguimientos_locales WHERE completado = 1 ORDER BY created_at ASC'
    );
    return rows.map(deserializeSeguimiento).filter((s) => {
      if (!s.sincronizado) return true;
      // Rescate: un seguimiento puede quedar marcado como sincronizado y aun
      // así conservar evidencia que NUNCA llegó a MinIO (sin `archivo_id`).
      // Ocurre cuando el PATCH de una edición de texto/geo/fecha respondía OK
      // y marcaba el registro como sincronizado aunque hubiera fotos/videos
      // pendientes: como el sync solo mirara `sincronizado = 0`, esa evidencia
      // quedaba huérfana para siempre y los demás roles (admin/gerente) solo
      // veían las fotos que sí habían subido. Aquí se vuelven a tomar esos
      // registros para terminar de subir lo que falta.
      return [...(s.fotos || []), ...(s.videos || [])].some((e) => !e.archivo_id);
    });
  } catch (error) {
    console.error('[DB] Error al leer seguimientos pendientes:', error);
    throw error;
  }
};

/**
 * Fusionar seguimientos del servidor (de otros dispositivos/usuarios del
 * mismo rol) con los locales.
 *
 * - Si NO existe la fila local, se inserta (es de otro dispositivo).
 * - Si existe y es nuestro registro pendiente (`sincronizado = 0`) o todavía
 *   tiene evidencia sin subir (fotos/videos sin `archivo_id`), se deja
 *   intacta: nunca se pisa trabajo local que aún no llegó al servidor.
 * - Si existe y ya está sincronizada y sin evidencias pendientes, se
 *   ACTUALIZA con la copia remota. Antes se dejaba intacta siempre, así que
 *   el dispositivo del admin se quedaba con la primera versión que bajó y
 *   nunca veía lo que el autor agregara después (p. ej. un video grabado en
 *   una edición posterior) — desde el rol admin se veían las fotos pero no
 *   el video aunque el servidor ya lo tuviera.
 */
export const mergeSeguimientosDelServidor = async (
  remotos: SeguimientoLocal[]
): Promise<number> => {
  const database = await ensureDb();
  if (!database || !remotos || remotos.length === 0) return 0;
  let aplicados = 0;
  for (const r of remotos) {
    if (!r?.id) continue;
    try {
      const localRow = await database.getFirstAsync<Record<string, any>>(
        'SELECT * FROM seguimientos_locales WHERE id = ?',
        [r.id]
      );

      if (localRow) {
        const local = deserializeSeguimiento(localRow);
        // Trabajo local aún no confirmado por el servidor: manda lo local.
        if (!local.sincronizado) continue;
        // Evidencia capturada que nunca llegó a MinIO (sin archivo_id): si se
        // pisara con la copia remota se perdería el archivo del teléfono.
        const evidenciaPendiente = [...(local.fotos || []), ...(local.videos || [])].some(
          (e) => !e.archivo_id
        );
        if (evidenciaPendiente) continue;
        // Nada nuevo en el servidor para este registro.
        if ((local.updated_at || '') === (r.updated_at || '')) continue;
        // Gana la marca de tiempo más reciente (mismo criterio que
        // mergeFormulariosDelServidor). Si la copia local es MÁS NUEVA que la
        // remota, se conserva local en vez de pisarla: así una corrección
        // recién hecha (actividad, fecha…) nunca se revierte por una copia
        // del servidor que todavía no la refleja. Cuando el servidor tenga
        // algo genuinamente más reciente, su `updated_at` mayor hará que el
        // remoto gane, igual que antes.
        {
          const tLocal = Date.parse(local.updated_at || '');
          const tRemoto = Date.parse(r.updated_at || '');
          if (Number.isFinite(tLocal) && Number.isFinite(tRemoto) && tLocal >= tRemoto) {
            continue;
          }
        }

        await database.runAsync(
          `UPDATE seguimientos_locales SET
             autor_id = ?, autor_nombre = ?, autor_rol = ?, beneficiario_cedula = ?, beneficiario_nombre = ?,
             actividad = ?, objetivo_visita = ?, descripcion_actividad = ?, observaciones = ?,
             fotos_json = ?, videos_json = ?, firma_beneficiario = ?, firma_autor = ?,
             geo_latitud = ?, geo_longitud = ?, geo_altitud = ?, geo_precision = ?,
             huella_beneficiario = ?, pdf_url = COALESCE(?, pdf_url), sincronizado = 1, completado = 1,
             created_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            r.autor_id,
            r.autor_nombre,
            r.autor_rol,
            r.beneficiario_cedula || null,
            r.beneficiario_nombre || null,
            r.actividad,
            r.objetivo_visita || null,
            r.descripcion_actividad || null,
            r.observaciones || null,
            JSON.stringify(r.fotos || []),
            JSON.stringify(r.videos || []),
            r.firma_beneficiario || null,
            r.firma_autor || null,
            r.geo_latitud ?? null,
            r.geo_longitud ?? null,
            r.geo_altitud ?? null,
            r.geo_precision ?? null,
            r.huella_beneficiario ? 1 : 0,
            r.pdf_url || null,
            r.created_at,
            r.updated_at,
            r.id,
          ]
        );
        aplicados++;
        continue;
      }

      await database.runAsync(
        `INSERT OR IGNORE INTO seguimientos_locales
           (id, autor_id, autor_nombre, autor_rol, beneficiario_cedula, beneficiario_nombre,
            actividad, objetivo_visita, descripcion_actividad, observaciones, fotos_json,
            videos_json, firma_beneficiario, firma_autor, geo_latitud, geo_longitud, geo_altitud, geo_precision,
            huella_beneficiario, pdf_url, sincronizado, completado, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        [
          r.id,
          r.autor_id,
          r.autor_nombre,
          r.autor_rol,
          r.beneficiario_cedula || null,
          r.beneficiario_nombre || null,
          r.actividad,
          r.objetivo_visita || null,
          r.descripcion_actividad || null,
          r.observaciones || null,
          JSON.stringify(r.fotos || []),
          JSON.stringify(r.videos || []),
          r.firma_beneficiario || null,
          r.firma_autor || null,
          r.geo_latitud ?? null,
          r.geo_longitud ?? null,
          r.geo_altitud ?? null,
          r.geo_precision ?? null,
          r.huella_beneficiario ? 1 : 0,
          r.pdf_url || null,
          r.created_at,
          r.updated_at,
        ]
      );
      aplicados++;
    } catch (e) {
      console.warn('[DB] No se pudo fusionar seguimiento del servidor:', r.id, e);
    }
  }
  return aplicados;
};

/**
 * Purga local los seguimientos que YA NO existen en el servidor.
 *
 * El merge de arriba solo AGREGA; nunca borra. Por eso, si otro dispositivo
 * elimina un seguimiento, la copia local se queda "fantasma" para siempre
 * (y al intentar borrarla el servidor responde 404).
 *
 * Esta función elimina las filas locales que:
 *   - están sincronizadas (`sincronizado = 1`) — es decir, ya existen en el
 *     servidor y por tanto su ausencia en la respuesta significa que fueron
 *     borradas por alguien; y
 *   - su `id` NO aparece en la lista de ids remotos.
 *
 * SEGURIDAD: solo debe llamarse cuando la consulta al servidor fue EXITOSA
 * (`ok === true`). Nunca borra filas `sincronizado = 0` (creadas offline y
 * aún no subidas) para no perder trabajo local.
 *
 * @param idsRemotos ids presentes en el servidor (respuesta exitosa).
 * @returns número de filas locales eliminadas.
 */
export const purgarSeguimientosAusentes = async (idsRemotos: string[]): Promise<number> => {
  const database = await ensureDb();
  if (!database) return 0;
  try {
    const ids = (idsRemotos || []).filter((id) => !!id);
    if (ids.length === 0) {
      // El servidor respondió OK pero sin seguimientos: borrar todos los
      // locales ya sincronizados (los pendientes de subir se conservan).
      const res = await database.runAsync(
        'DELETE FROM seguimientos_locales WHERE sincronizado = 1'
      );
      return res.changes ?? 0;
    }
    const placeholders = ids.map(() => '?').join(', ');
    const res = await database.runAsync(
      `DELETE FROM seguimientos_locales
         WHERE sincronizado = 1 AND id NOT IN (${placeholders})`,
      ids
    );
    return res.changes ?? 0;
  } catch (e) {
    console.warn('[DB] No se pudo purgar seguimientos ausentes:', e);
    return 0;
  }
};
