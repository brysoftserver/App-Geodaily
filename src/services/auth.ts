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
    if (error?.response?.data?.error) {
      return { success: false, error: error.response.data.error };
    }
    if (error?.response?.data?.detail) {
      return { success: false, error: error.response.data.detail };
    }
    if (error?.message?.includes('Network') || error?.isOffline) {
      return { success: false, error: 'Sin conexión al servidor' };
    }
    return { success: false, error: 'Error de conexión con el servidor' };
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
    const cred: CredencialOffline = {
      usuario: usuario.trim().toLowerCase(),
      salt,
      hash,
      user,
      savedAt: new Date().toISOString(),
    };
    await SecureStore.setItemAsync(STORAGE_KEYS.OFFLINE_CRED, JSON.stringify(cred));
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
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.OFFLINE_CRED);
    if (!raw) return null;
    const cred = JSON.parse(raw) as CredencialOffline;
    if (cred.usuario !== usuario.trim().toLowerCase()) return null;
    const hash = await hashContrasena(contrasena, cred.salt);
    if (hash !== cred.hash) return null;
    return cred.user;
  } catch (err) {
    console.warn('[Auth] Error validando credencial offline:', err);
    return null;
  }
};

/** ¿Existe una credencial offline guardada para este usuario? */
export const existeCredencialOffline = async (usuario?: string): Promise<boolean> => {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.OFFLINE_CRED);
    if (!raw) return false;
    if (!usuario) return true;
    const cred = JSON.parse(raw) as CredencialOffline;
    return cred.usuario === usuario.trim().toLowerCase();
  } catch {
    return false;
  }
};

/**
 * Borrar la credencial offline — solo en logout explícito del usuario.
 * NO se debe llamar ante un 401 de red para no dejar al técnico sin poder
 * reingresar en campo.
 */
export const limpiarCredencialOffline = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.OFFLINE_CRED);
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
