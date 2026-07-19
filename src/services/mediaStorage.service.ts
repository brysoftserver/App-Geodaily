// ============================================================
// GEODAILY — Almacenamiento persistente de evidencias
// ============================================================
// expo-camera escribe las fotos y los videos en el directorio de
// CACHÉ del sistema (cacheDirectory/Camera/). Android puede vaciar
// esa caché sin avisar cuando el dispositivo se queda sin espacio.
//
// En campo eso significaba pérdida de evidencia: un técnico varios
// días sin señal podía perder fotos y videos ANTES de haberlos
// llegado a sincronizar, de forma irrecuperable.
//
// Aquí las evidencias se copian a documentDirectory apenas se
// capturan. Ese directorio solo se borra si el usuario desinstala la
// app o limpia los datos, nunca por presión de almacenamiento.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';

/** Carpeta persistente donde viven las evidencias de campo */
export const EVIDENCIAS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}evidencias/`
  : null;

let directorioListo = false;

/** Crea la carpeta de evidencias si no existe (idempotente) */
export const asegurarDirectorioEvidencias = async (): Promise<boolean> => {
  if (!EVIDENCIAS_DIR) return false;
  if (directorioListo) return true;
  try {
    const info = await FileSystem.getInfoAsync(EVIDENCIAS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(EVIDENCIAS_DIR, { intermediates: true });
      console.log('[Evidencias] Carpeta persistente creada');
    }
    directorioListo = true;
    return true;
  } catch (e) {
    console.warn('[Evidencias] No se pudo crear la carpeta persistente:', e);
    return false;
  }
};

/** Extensión del archivo, con respaldo según el tipo */
const extensionDe = (uri: string, esVideo: boolean): string => {
  const limpia = uri.split('?')[0];
  const punto = limpia.lastIndexOf('.');
  if (punto > -1 && punto > limpia.lastIndexOf('/')) {
    return limpia.slice(punto);
  }
  return esVideo ? '.mp4' : '.jpg';
};

/**
 * Copiar una evidencia recién capturada a almacenamiento persistente.
 *
 * Nunca lanza: si la copia falla se devuelve la URI original, de modo
 * que la captura siga funcionando aunque el disco esté lleno. Es un
 * refuerzo de durabilidad, no un paso que pueda bloquear al técnico.
 *
 * @returns la URI persistente, o la original si no se pudo copiar
 */
export const persistirEvidencia = async (
  uriOrigen: string,
  id: string,
  esVideo = false
): Promise<string> => {
  if (!uriOrigen || !uriOrigen.startsWith('file://')) return uriOrigen;

  const ok = await asegurarDirectorioEvidencias();
  if (!ok || !EVIDENCIAS_DIR) return uriOrigen;

  // Ya está en la carpeta persistente (p.ej. re-guardado de un borrador)
  if (uriOrigen.startsWith(EVIDENCIAS_DIR)) return uriOrigen;

  const destino = `${EVIDENCIAS_DIR}${id}${extensionDe(uriOrigen, esVideo)}`;

  try {
    // copyAsync y no moveAsync: si algo falla a medias, el archivo
    // original en caché sigue intacto y no se pierde la evidencia.
    await FileSystem.copyAsync({ from: uriOrigen, to: destino });

    const info = await FileSystem.getInfoAsync(destino);
    if (!info.exists || info.size === 0) {
      console.warn('[Evidencias] Copia vacía o ausente, se conserva la original');
      return uriOrigen;
    }

    console.log(`[Evidencias] Guardada en almacenamiento persistente: ${id}`);
    return destino;
  } catch (e) {
    console.warn('[Evidencias] No se pudo persistir, se usa la de caché:', e);
    return uriOrigen;
  }
};

/** ¿Esta URI está en el almacenamiento persistente? */
export const esEvidenciaPersistente = (uri?: string): boolean =>
  !!uri && !!EVIDENCIAS_DIR && uri.startsWith(EVIDENCIAS_DIR);

/** Borrar un archivo de evidencia (best-effort) */
export const eliminarArchivoLocal = async (uri: string): Promise<void> => {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Ya no existe o no se puede borrar — no es crítico
  }
};

/**
 * Liberar espacio borrando evidencias antiguas YA respaldadas en MinIO.
 *
 * Solo toca archivos que el servidor confirmó haber recibido (ver
 * `getEvidenciasPurgables`), así que siguen siendo recuperables desde el
 * detalle del formulario, que los vuelve a traer del servidor.
 *
 * @param diasMinimos antigüedad mínima para descartar (por defecto 30 días)
 * @returns cuántos archivos se liberaron
 */
export const limpiarEvidenciasAntiguas = async (
  diasMinimos = 30
): Promise<number> => {
  try {
    // Import diferido: evita un ciclo entre database y mediaStorage
    const { getEvidenciasPurgables } = await import('./database');
    const uris = await getEvidenciasPurgables(diasMinimos);
    if (uris.length === 0) return 0;

    let liberados = 0;
    for (const uri of uris) {
      // Solo se borra lo que esta app copió a su carpeta persistente
      if (!esEvidenciaPersistente(uri)) continue;
      await eliminarArchivoLocal(uri);
      liberados++;
    }

    if (liberados > 0) {
      console.log(
        `[Evidencias] ${liberados} evidencia(s) antiguas liberadas (siguen en el servidor)`
      );
    }
    return liberados;
  } catch (e) {
    console.warn('[Evidencias] No se pudo limpiar el almacenamiento:', e);
    return 0;
  }
};

/** Espacio ocupado por las evidencias persistidas, en bytes */
export const tamanoEvidencias = async (): Promise<number> => {
  if (!EVIDENCIAS_DIR) return 0;
  try {
    const info = await FileSystem.getInfoAsync(EVIDENCIAS_DIR);
    if (!info.exists) return 0;
    const archivos = await FileSystem.readDirectoryAsync(EVIDENCIAS_DIR);
    let total = 0;
    for (const nombre of archivos) {
      const fInfo = await FileSystem.getInfoAsync(`${EVIDENCIAS_DIR}${nombre}`);
      if (fInfo.exists && !fInfo.isDirectory) total += fInfo.size || 0;
    }
    return total;
  } catch {
    return 0;
  }
};
