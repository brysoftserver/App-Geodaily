// ============================================================
// GEODAILY — Servicio de Autenticación (JWT real)
// ============================================================

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';
import { STORAGE_KEYS } from '../utils/constants';
import type { Usuario } from '../types';

export interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    nombre: string;
    cedula?: string;
    email: string;
    rol: string;
    telefono?: string;
    token: string;
  };
  error?: string;
  /**
   * true cuando el login falló por falta de conexión, NO porque el
   * servidor rechazara las credenciales. Es la señal que usa AuthContext
   * para caer al login offline: sin esto, un técnico sin señal quedaba
   * bloqueado aunque tuviera su credencial cacheada.
   */
  offline?: boolean;
}

/**
 * Login de usuario contra el backend JWT (PostGIS + bcrypt).
 */
export const loginUser = async (
  usuario: string,
  contrasena: string
): Promise<AuthResult> => {
  try {
    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.AUTH + '/login',
      { usuario, contrasena },
      { timeout: 10000 }
    );

    const data = response.data;

    if (data.success && data.token) {
      return {
        success: true,
        user: {
          id: data.usuario.id,
          nombre: data.usuario.nombre,
          cedula: data.usuario.cedula,
          email: data.usuario.email || '',
          rol: data.usuario.rol,
          telefono: data.usuario.telefono,
          token: data.token,
        },
      };
    }

    return {
      success: false,
      error: data.error || 'Error de autenticación',
    };
  } catch (error: any) {
    const status = error?.response?.status;

    // Solo un 4xx es un rechazo EXPLÍCITO de las credenciales. Cualquier
    // otra cosa (sin red, timeout, DNS, 5xx) significa que el servidor no
    // llegó a decidir nada, así que el técnico debe poder entrar con su
    // credencial cacheada en vez de quedarse bloqueado en campo.
    const esRechazoDeCredenciales =
      typeof status === 'number' && status >= 400 && status < 500;

    if (esRechazoDeCredenciales) {
      const mensaje =
        error?.response?.data?.error ||
        error?.response?.data?.detail ||
        'Usuario o contraseña incorrectos';
      return { success: false, error: mensaje };
    }

    if (error?.message?.includes('Network') || error?.isOffline) {
      return { success: false, error: 'Sin conexión al servidor', offline: true };
    }

    return {
      success: false,
      error: status
        ? `El servidor no está disponible (error ${status})`
        : 'Error de conexión con el servidor',
      offline: true,
    };
  }
};

/**
 * Logout — solo limpia datos locales.
 */
export const logoutUser = async (): Promise<void> => {
  // En futuro: invalidar token en servidor (blacklist)
  return Promise.resolve();
};

// ============================================================
// LOGIN OFFLINE — credencial cacheada
// ============================================================
// Permite que un técnico vuelva a entrar en campo SIN señal, incluso
// después de cerrar sesión, validando la contraseña contra un hash
// salteado guardado en la última autenticación online exitosa.
// ============================================================

/** Estructura persistida en SecureStore para el login offline. */
interface CredencialOffline {
  usuario: string;
  salt: string;
  hash: string;
  user: Usuario; // incluye el token de la última sesión válida
  savedAt: string;
}

/**
 * Bajo STORAGE_KEYS.OFFLINE_CRED se guarda un DICCIONARIO de credenciales,
 * una por cada cuenta que alguna vez inició sesión online en este
 * dispositivo — no una sola. Antes se guardaba un único objeto y cada login
 * online lo sobrescribía, así que solo la última cuenta usada quedaba
 * disponible offline; si en campo se necesitaba entrar con un rol distinto
 * al último, la app lo rechazaba aunque ya hubiera entrado antes con esa
 * cuenta en ese mismo teléfono.
 */
type AlmacenCredencialesOffline = Record<string, CredencialOffline>;

const leerAlmacenOffline = async (): Promise<AlmacenCredencialesOffline> => {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.OFFLINE_CRED);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migración desde el formato anterior (un solo objeto, no diccionario).
    if (parsed && typeof parsed === 'object' && 'usuario' in parsed && 'hash' in parsed) {
      return { [parsed.usuario]: parsed as CredencialOffline };
    }
    return parsed as AlmacenCredencialesOffline;
  } catch {
    return {};
  }
};

const guardarAlmacenOffline = async (almacen: AlmacenCredencialesOffline): Promise<void> => {
  await SecureStore.setItemAsync(STORAGE_KEYS.OFFLINE_CRED, JSON.stringify(almacen));
};

/**
 * Nº de iteraciones de hashing — endurece frente a fuerza bruta local.
 * Cada iteración es una llamada al bridge nativo, así que se mantiene moderado
 * para que el login (y el login offline en campo) siga siendo ágil en tablets.
 * SecureStore ya cifra el valor con hardware del dispositivo; esto es una capa
 * extra de defensa, no la única.
 */
const HASH_ITERACIONES = 750;

/**
 * Deriva un hash de la contraseña con salt e iteraciones (SHA-256 encadenado).
 * No es PBKDF2 real, pero eleva el costo de un ataque de diccionario sobre el
 * hash almacenado en el dispositivo. La contraseña en claro nunca se guarda.
 */
const hashContrasena = async (contrasena: string, salt: string): Promise<string> => {
  let acc = `${salt}:${contrasena}`;
  for (let i = 0; i < HASH_ITERACIONES; i++) {
    acc = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, acc);
  }
  return acc;
};

/**
 * Guardar la credencial para permitir login offline futuro.
 * Se llama tras cada login online exitoso.
 */
export const guardarCredencialOffline = async (
  usuario: string,
  contrasena: string,
  user: Usuario,
): Promise<void> => {
  try {
    const saltBytes = await Crypto.getRandomBytesAsync(16);
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const hash = await hashContrasena(contrasena, salt);
    const key = usuario.trim().toLowerCase();
    const almacen = await leerAlmacenOffline();
    almacen[key] = {
      usuario: key,
      salt,
      hash,
      user,
      savedAt: new Date().toISOString(),
    };
    await guardarAlmacenOffline(almacen);
  } catch (err) {
    console.warn('[Auth] No se pudo guardar credencial offline:', err);
  }
};

/**
 * Intentar login offline validando contra la credencial cacheada.
 * Devuelve el usuario (con su último token) si coincide, o null si no hay
 * credencial guardada o la contraseña/usuario no coinciden.
 */
export const intentarLoginOffline = async (
  usuario: string,
  contrasena: string,
): Promise<Usuario | null> => {
  try {
    const almacen = await leerAlmacenOffline();
    const cred = almacen[usuario.trim().toLowerCase()];
    if (!cred) return null;
    const hash = await hashContrasena(contrasena, cred.salt);
    if (hash !== cred.hash) return null;
    return cred.user;
  } catch (err) {
    console.warn('[Auth] Error validando credencial offline:', err);
    return null;
  }
};

/**
 * ¿Existe una credencial offline guardada?
 * Sin `usuario`: ¿hay alguna cuenta cacheada en este dispositivo?
 * Con `usuario`: ¿esa cuenta específica tiene credencial cacheada?
 */
export const existeCredencialOffline = async (usuario?: string): Promise<boolean> => {
  try {
    const almacen = await leerAlmacenOffline();
    if (!usuario) return Object.keys(almacen).length > 0;
    return usuario.trim().toLowerCase() in almacen;
  } catch {
    return false;
  }
};

/**
 * Borrar credencial(es) offline.
 *
 * Sin `usuario`: borra TODAS las cuentas cacheadas en este dispositivo —
 * pensado para una futura opción explícita tipo "olvidar este dispositivo",
 * NO para el logout normal. Con `usuario`: borra solo esa cuenta.
 *
 * AuthContext.logout() YA NO llama a esta función: cerrar sesión de una
 * cuenta no debe impedir volver a entrar con ella offline más tarde —
 * exactamente el escenario de campo que este caché existe para resolver.
 */
export const limpiarCredencialOffline = async (usuario?: string): Promise<void> => {
  try {
    if (!usuario) {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.OFFLINE_CRED);
      return;
    }
    const almacen = await leerAlmacenOffline();
    delete almacen[usuario.trim().toLowerCase()];
    await guardarAlmacenOffline(almacen);
  } catch {
    // Ignorar
  }
};

/** Resultado de verificar el token contra el servidor. */
export type TokenVerification = 'valid' | 'invalid' | 'offline';

/**
 * Verificar si el token JWT es válido contra el backend.
 *
 * Distingue explícitamente "el servidor dijo que es inválido" de
 * "no se pudo contactar al servidor" — un técnico offline no debe perder
 * su sesión solo porque no hay señal para verificarla.
 */
export const verifyToken = async (token: string): Promise<TokenVerification> => {
  if (!token) return 'invalid';
  try {
    const response = await apiClient.get(
      API_CONFIG.ENDPOINTS.AUTH + '/verify',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data?.success === true ? 'valid' : 'invalid';
  } catch (error) {
    if (isOfflineError(error)) return 'offline';
    // El servidor respondió (ej. 401 token inválido/expirado) → sí es inválido
    if ((error as any)?.response?.status === 401) return 'invalid';
    // Cualquier otro fallo (timeout, 5xx, DNS, etc.) — no es un rechazo
    // explícito del token, tratar como "no se pudo verificar" para no
    // desloguear a un técnico por un problema transitorio de red/servidor.
    return 'offline';
  }
};

/**
 * Cambiar la contraseña del usuario autenticado.
 * Requiere la contraseña actual y la nueva.
 */
export const changePassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean; mensaje?: string; error?: string }> => {
  try {
    const response = await apiClient.put(
      API_CONFIG.ENDPOINTS.AUTH + '/mi-contrasena',
      { currentPassword, newPassword },
    );
    return response.data;
  } catch (error: any) {
    const mensaje = error?.response?.data?.error || 'Error al cambiar la contraseña';
    return { success: false, error: mensaje };
  }
};
