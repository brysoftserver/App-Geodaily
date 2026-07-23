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

const AVATAR_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}avatares/`
  : null;

const claveAsyncStorage = (userId: string) => `@geodaily/avatar_uri_${userId}`;

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
