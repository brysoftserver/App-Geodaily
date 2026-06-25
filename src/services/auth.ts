// ============================================================
// GEODAILY — Servicio de Autenticación (JWT real)
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

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

/**
 * Verificar si el token JWT es válido contra el backend.
 */
export const verifyToken = async (token: string): Promise<boolean> => {
  if (!token) return false;
  try {
    const response = await apiClient.get(
      API_CONFIG.ENDPOINTS.AUTH + '/verify',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data?.success === true;
  } catch {
    return false;
  }
};
