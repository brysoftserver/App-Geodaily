// ============================================================
// GEODAILY — Cliente API (Axios) para el backend Express (no usa QGIS/PostGIS)
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

/**
 * Obtener el token JWT actual.
 *
 * Necesario para cargar evidencias (fotos/videos) desde la API: los
 * componentes <Image> y <VideoView> hacen la petición HTTP por su cuenta,
 * fuera de axios, así que hay que pasarles la cabecera Authorization.
 */
export const getApiAuthToken = async (): Promise<string | null> => {
  try {
    const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
    if (token) return token;
  } catch {
    // SecureStore no disponible (Expo Go / web) — usar el de memoria
  }
  return _inMemoryToken;
};

// --- Puente hacia AuthContext: permite que el interceptor de 401 notifique
// a la UI para que reaccione (gate de login) sin que api.ts dependa de React ---
let _onUnauthorized: (() => void) | null = null;

/**
 * Registrar el callback que AuthContext invoca cuando cualquier petición
 * recibe un 401 — permite que la app salga de sesión inmediatamente en vez
 * de que el sync en segundo plano falle en silencio para siempre.
 */
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  _onUnauthorized = handler;
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
    // 401 No autorizado.
    //
    // CLAVE para el trabajo en campo: NO sacar al técnico de la app por un 401
    // que llega en segundo plano (sync/datos). Antes, cualquier 401 borraba la
    // sesión y lo mandaba a la pantalla de login; si en ese momento estaba con
    // señal intermitente, quedaba parado y con datos sin sincronizar atrapados.
    //
    // Ahora solo forzamos cierre de sesión cuando el 401 viene de un endpoint
    // de AUTENTICACIÓN (login/verify) — ahí el rechazo del token es explícito y
    // el técnico puede volver a entrar (incluso offline, con la credencial
    // cacheada). Un 401 de sync se deja fallar en silencio: la sesión y los
    // datos locales se conservan y se reintenta cuando haya red/reautenticación.
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const esEndpointAuth = requestUrl.includes(API_CONFIG.ENDPOINTS.AUTH);

      if (esEndpointAuth) {
        try {
          await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
          await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
        } catch {
          // Ignorar errores de SecureStore
        }
        setApiAuthToken(null);
        console.warn(`[API] 401 en endpoint de auth (${requestUrl}) — sesión cerrada`);
        _onUnauthorized?.();
      } else {
        // 401 en sync/datos — conservar sesión y datos, solo avisar.
        console.warn(`[API] 401 en ${requestUrl} — se conserva la sesión (reintento posterior)`);
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
