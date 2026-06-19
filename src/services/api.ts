// ============================================================
// GEODAILY — Cliente API (Axios) para QGIS Server
// ============================================================

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_CONFIG } from '../theme';
import { STORAGE_KEYS } from '../utils/constants';

// Crear instancia Axios
const apiClient: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Interceptor de peticiones — añade token JWT real desde SecureStore
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        console.warn(`[API] Token no encontrado en SecureStore para: ${config.url}`);
      }
    } catch (err) {
      console.warn(`[API] Error al leer token de SecureStore: ${err}`);
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Interceptor de respuestas — manejo de errores centralizado
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // 401 No autorizado — solo limpiar sesión si es un endpoint de autenticación
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const isAuthEndpoint = requestUrl.includes('/api/auth/');

      if (isAuthEndpoint) {
        try {
          await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
          await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
          console.warn('[API] Token inválido en auth — sesión limpiada');
        } catch {
          // Ignorar errores de SecureStore
        }
      } else {
        console.warn(
          `[API] 401 en ${requestUrl} — NO se limpia sesión (endpoint no auth)`
        );
      }
    }

    if (error.code === 'ERR_NETWORK') {
      console.warn('[API] Sin conexión al servidor — modo offline');
      return Promise.reject({ ...error, isOffline: true });
    }
    return Promise.reject(error);
  }
);

// --- Utilidades ---

export const isOfflineError = (error: unknown): boolean => {
  return (error as any)?.isOffline === true;
};

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.response?.data?.detail) {
      return error.response.data.detail;
    }
    if (error.response?.data?.mensaje) {
      return error.response.data.mensaje;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Error desconocido';
};

export default apiClient;
