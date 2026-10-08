// ============================================================
// GEODAILY — Servicio de Administración de Usuarios (Admin)
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

export interface UsuarioBackend {
  id: string;
  usuario: string;
  nombre: string;
  cedula?: string;
  email?: string;
  rol: 'tecnico' | 'coordinador' | 'interventor' | 'gerente' | 'admin';
  telefono?: string;
  activo: boolean;
  contrasena_visible?: string;
  /** Id en la tabla `archivos` (MinIO) de la foto de perfil, si el usuario tiene una. */
  avatar_archivo_id?: string | null;
  created_at?: string;
}

export interface CrearUsuarioPayload {
  usuario: string;
  contrasena: string;
  nombre: string;
  rol: UsuarioBackend['rol'];
  cedula?: string;
  email?: string;
  telefono?: string;
}

export interface ActualizarUsuarioPayload {
  nombre?: string;
  cedula?: string;
  email?: string;
  rol?: UsuarioBackend['rol'];
  telefono?: string;
  activo?: boolean;
  contrasena?: string;
}

const USUARIOS_ENDPOINT = API_CONFIG.ENDPOINTS.AUTH + '/usuarios';
const TECNICOS_ENDPOINT = API_CONFIG.ENDPOINTS.AUTH + '/tecnicos';
const PERSONAL_ENDPOINT = API_CONFIG.ENDPOINTS.AUTH + '/personal';

export interface PersonalCronograma {
  id: string;
  nombre: string;
  rol: 'tecnico' | 'coordinador' | 'interventor';
}

/**
 * Listar todos los usuarios reales (admin-only en backend).
 */
export const getUsuarios = async (): Promise<UsuarioBackend[]> => {
  const response = await apiClient.get(USUARIOS_ENDPOINT);
  return response.data?.usuarios || [];
};

/**
 * Listar solo técnicos activos (accesible por cualquier rol autenticado).
 */
export const getTecnicos = async (): Promise<UsuarioBackend[]> => {
  const response = await apiClient.get(TECNICOS_ENDPOINT);
  return response.data?.tecnicos || [];
};

/**
 * Listar técnicos, coordinadores e interventores activos — para elegir de
 * quién descargar el cronograma (accesible por cualquier rol autenticado).
 */
export const getPersonalCronograma = async (): Promise<PersonalCronograma[]> => {
  const response = await apiClient.get(PERSONAL_ENDPOINT);
  return response.data?.personal || [];
};

/**
 * Crear un usuario nuevo.
 */
export const crearUsuario = async (
  datos: CrearUsuarioPayload
): Promise<UsuarioBackend> => {
  const response = await apiClient.post(USUARIOS_ENDPOINT, datos);
  return response.data.usuario;
};

/**
 * Actualizar un usuario existente (parcial).
 */
export const actualizarUsuario = async (
  id: string,
  datos: ActualizarUsuarioPayload
): Promise<UsuarioBackend> => {
  const response = await apiClient.put(`${USUARIOS_ENDPOINT}/${id}`, datos);
  return response.data.usuario;
};

/**
 * Desactivar un usuario (soft-delete — el backend nunca borra la fila,
 * solo pone activo=false).
 */
export const eliminarUsuario = async (id: string): Promise<void> => {
  await apiClient.delete(`${USUARIOS_ENDPOINT}/${id}`);
};

export interface EliminarUsuarioPermanenteResultado {
  formularios_borrados: number;
  archivos_fisicos_eliminados: number;
}

/**
 * Eliminar un usuario PERMANENTEMENTE (hard-delete en cascada): borra la
 * cuenta y todo lo que generó (formularios, revisiones, notificaciones,
 * mediciones, plantaciones, tracking, log de actividad, archivos y PDFs en
 * MinIO). A los beneficiarios que tenía asignados solo se les quita la
 * asignación. Irreversible — solo admin.
 */
export const eliminarUsuarioPermanente = async (
  id: string
): Promise<EliminarUsuarioPermanenteResultado> => {
  const response = await apiClient.delete(`${USUARIOS_ENDPOINT}/${id}/permanente`);
  return response.data;
};
