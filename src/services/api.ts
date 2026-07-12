// ============================================================
// GEODAILY — Cliente API (Axios) para QGIS Server
// ============================================================

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_CONFIG } from '../theme';
import { STORAGE_KEYS } from '../utils/constants';

// --- Token en memoria como fallback cuando SecureStore no está disponible ---
let _inMemoryToken: string | null = null;

/**
 * Establecer el token JWT en memoria (además de SecureStore).
 * Útil en entornos donde SecureStore no está disponible (Expo Go, web).
 */
export const setApiAuthToken = (token: string | null) => {
  _inMemoryToken = token;
};

// Crear instancia Axios
const apiClient: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Interceptor de peticiones — añade token JWT
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    let token: string | null = null;

    // 1. Intentar desde SecureStore (persistente)
    try {
      token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
    } catch (err) {
      // SecureStore no disponible en este entorno, continuar con memoria
    }

    // 2. Fallback a token en memoria
    if (!token) {
      token = _inMemoryToken;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log(`[API] Token añadido para: ${config.url}`);
    } else {
      console.warn(`[API] No hay token disponible para: ${config.url}`);
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
