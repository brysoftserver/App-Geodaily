// ============================================================
// GEODAILY — Foto de perfil persistente
// ============================================================
// expo-image-picker devuelve una URI dentro del directorio de CACHÉ del
// sistema. Android puede vaciarla sin avisar (presión de almacenamiento,
// reinicio, limpieza de caché), así que guardar esa URI tal cual hacía que
// la foto de perfil "se borrara" al reiniciar: el dato persistía pero el
// archivo al que apuntaba ya no existía.
//
// Aquí la foto se copia a documentDirectory apenas se elige, igual que ya
// se hace con las evidencias de campo (ver mediaStorage.service.ts). Ese
// directorio solo se borra si se desinstala la app.
//
// Se guarda UNA foto por usuario (clave = user.id), no una sola global,
// para que cada cuenta que use este dispositivo conserve la suya propia.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';

const AVATAR_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}avatares/`
  : null;

const claveAsyncStorage = (userId: string) => `@geodaily/avatar_uri_${userId}`;
/** Recuerda qué `avatar_archivo_id` del servidor ya está reflejado en el archivo local — evita redescargar en cada apertura de pantalla. */
const claveSincronizado = (userId: string) => `@geodaily/avatar_synced_id_${userId}`;

let directorioListo = false;

const asegurarDirectorio = async (): Promise<boolean> => {
  if (!AVATAR_DIR) return false;
  if (directorioListo) return true;
  try {
    const info = await FileSystem.getInfoAsync(AVATAR_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
    }
    directorioListo = true;
    return true;
  } catch (e) {
    console.warn('[Avatar] No se pudo crear la carpeta persistente:', e);
    return false;
  }
};

/**
 * Cargar la foto de perfil guardada de un usuario.
 * Verifica que el archivo siga existiendo (autocorrección si se perdió).
 */
export const obtenerAvatarGuardado = async (userId: string): Promise<string | null> => {
  try {
    const uri = await AsyncStorage.getItem(claveAsyncStorage(userId));
    if (!uri) return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      await AsyncStorage.removeItem(claveAsyncStorage(userId));
      return null;
    }
    return uri;
  } catch (e) {
    console.warn('[Avatar] No se pudo leer la foto guardada:', e);
    return null;
  }
};

/**
 * Copiar una foto recién elegida a almacenamiento persistente y recordarla
 * para este usuario. Devuelve la URI persistente, o null si falló.
 */
export const guardarAvatar = async (
  userId: string,
  uriOrigen: string
): Promise<string | null> => {
  const ok = await asegurarDirectorio();
  if (!ok || !AVATAR_DIR) return null;

  const anterior = await AsyncStorage.getItem(claveAsyncStorage(userId));
  const extension = uriOrigen.split('?')[0].split('.').pop() || 'jpg';
  // Nombre único por foto (no fijo): evita que <Image> muestre una versión
  // cacheada de la foto anterior con el mismo path tras actualizarla.
  const destino = `${AVATAR_DIR}${userId}_${Date.now()}.${extension}`;

  try {
    await FileSystem.copyAsync({ from: uriOrigen, to: destino });
    const info = await FileSystem.getInfoAsync(destino);
    if (!info.exists || info.size === 0) {
      console.warn('[Avatar] Copia vacía o ausente');
      return null;
    }

    await AsyncStorage.setItem(claveAsyncStorage(userId), destino);

    // Limpiar la foto anterior de este usuario (best-effort)
    if (anterior && anterior !== destino) {
      FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
    }

    return destino;
  } catch (e) {
    console.warn('[Avatar] No se pudo guardar la foto de perfil:', e);
    return null;
  }
};

/**
 * Subir la foto de perfil al servidor (best-effort) para que otros roles
 * la vean — ej. el admin en "Gestión de Usuarios". Antes esta foto solo
 * existía en el dispositivo del propio usuario (ver comentario de cabecera
 * del archivo); esto la registra en MinIO + tabla `archivos` del backend.
 * No lanza si falla (sin conexión, etc.) — la foto local sigue funcionando
 * igual para el propio dueño aunque la subida remota no se complete.
 *
 * Devuelve el `avatar_archivo_id` nuevo (o null si falló) y de paso marca
 * este dispositivo como "ya sincronizado" con ese id, para que
 * `sincronizarAvatarDesdeServidor` no vuelva a descargar la misma foto que
 * este mismo dispositivo acaba de subir.
 */
export const subirAvatarAlServidor = async (
  userId: string,
  uriPersistente: string
): Promise<string | null> => {
  try {
    const formData = new FormData();
    const extension = uriPersistente.split('?')[0].split('.').pop() || 'jpg';
    // @ts-expect-error — React Native FormData
    formData.append('archivo', {
      uri: uriPersistente,
      type: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
      name: `avatar.${extension}`,
    });

    const response = await apiClient.post(`${API_CONFIG.ENDPOINTS.AUTH}/mi-foto`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    });

    const archivoId = response.data?.avatar_archivo_id;
    if (response.data?.estado === 'ok' && archivoId) {
      await AsyncStorage.setItem(claveSincronizado(userId), archivoId);
      return archivoId;
    }
    return null;
  } catch (e) {
    console.warn('[Avatar] No se pudo subir la foto de perfil al servidor:', e);
    return null;
  }
};

/**
 * Quitar la foto de perfil — local y en el servidor. Best-effort en el
 * servidor: si falla la conexión, se limpia igual localmente (el usuario
 * pidió explícitamente quitarla) pero puede reaparecer al reabrir la app
 * si el borrado remoto no llegó a completarse; se reintentará entonces.
 */
export const eliminarAvatar = async (userId: string): Promise<void> => {
  const actual = await AsyncStorage.getItem(claveAsyncStorage(userId));
  if (actual) {
    await FileSystem.deleteAsync(actual, { idempotent: true }).catch(() => {});
  }
  await AsyncStorage.multiRemove([claveAsyncStorage(userId), claveSincronizado(userId)]);
  try {
    await apiClient.delete(`${API_CONFIG.ENDPOINTS.AUTH}/mi-foto`);
  } catch (e) {
    console.warn('[Avatar] No se pudo eliminar la foto de perfil en el servidor:', e);
  }
};

/**
 * Sincronizar el avatar de OTRO dispositivo (o la ausencia de foto, si se
 * quitó en otro dispositivo) hacia este. `avatarArchivoId` es el valor
 * actual conocido del servidor (de `useAuth().user`).
 *
 * Devuelve:
 * - `undefined` si no hay nada que cambiar (ya está sincronizado).
 * - `null` si se confirmó que NO hay foto (se quitó en otro dispositivo).
 * - la nueva URI local si se descargó una foto distinta.
 */
export const sincronizarAvatarDesdeServidor = async (
  userId: string,
  avatarArchivoId: string | null | undefined
): Promise<string | null | undefined> => {
  const idActual = avatarArchivoId || null;
  const idSincronizado = await AsyncStorage.getItem(claveSincronizado(userId));
  if (idActual === idSincronizado) return undefined;

  if (!idActual) {
    const anterior = await AsyncStorage.getItem(claveAsyncStorage(userId));
    if (anterior) await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
    await AsyncStorage.multiRemove([claveAsyncStorage(userId), claveSincronizado(userId)]);
    return null;
  }

  const ok = await asegurarDirectorio();
  if (!ok || !AVATAR_DIR) return undefined;

  try {
    const token = await getApiAuthToken();
    const destino = `${AVATAR_DIR}${userId}_${Date.now()}.jpg`;
    const resultado = await FileSystem.downloadAsync(
      `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ARCHIVOS}/${idActual}/contenido`,
      destino,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (resultado.status !== 200) return undefined;

    const anterior = await AsyncStorage.getItem(claveAsyncStorage(userId));
    await AsyncStorage.setItem(claveAsyncStorage(userId), destino);
    await AsyncStorage.setItem(claveSincronizado(userId), idActual);
    if (anterior && anterior !== destino) {
      FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => {});
    }
    return destino;
  } catch (e) {
    console.warn('[Avatar] No se pudo sincronizar la foto desde el servidor:', e);
    return undefined;
  }
};
