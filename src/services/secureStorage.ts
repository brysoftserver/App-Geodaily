// ============================================================
// GEODAILY — Almacenamiento seguro de sesión (con respaldo en web)
// ============================================================
// expo-secure-store no tiene implementación real en web — su build para
// esa plataforma es un módulo vacío (`export default {}`, ver
// node_modules/expo-secure-store/src/ExpoSecureStore.web.ts). Eso significa
// que en el navegador `getItemAsync`/`setItemAsync`/`deleteItemAsync` no
// existen como funciones: cada intento de guardar el token lanzaba un error
// silenciado por un try/catch, y la sesión terminaba viviendo SOLO en la
// variable en memoria de api.ts (_inMemoryToken). Cualquier recarga o caída
// de la pestaña — por ejemplo, durante la generación de un PDF con varias
// fotos, que procesa todo en el hilo principal del navegador — borraba la
// sesión sin que el usuario hubiera cerrado sesión a propósito.
//
// Este wrapper reemplaza a `expo-secure-store` en AuthContext/api.ts:
// en nativo (Android/iOS) delega directo a SecureStore, sin cambiar nada.
// En web, usa `localStorage` como almacenamiento real para que la sesión
// sobreviva a una recarga de la pestaña — aplica a los 5 roles por igual,
// ninguno tenía persistencia real en la versión web.
// ============================================================

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const getItemAsync = async (key: string): Promise<string | null> => {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Almacenamiento no disponible (modo privado, cuota excedida, etc.)
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
};

export const setItemAsync = async (key: string, value: string): Promise<void> => {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // La sesión sigue funcionando en memoria mientras dure la pestaña.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

export const deleteItemAsync = async (key: string): Promise<void> => {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignorar — no hay nada que limpiar si nunca se pudo escribir.
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
};
