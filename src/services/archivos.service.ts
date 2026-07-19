// ============================================================
// GEODAILY — Servicio de Evidencias remotas (MinIO vía API)
// ============================================================
// Las fotos y videos se guardan en el formulario con la ruta LOCAL del
// teléfono que los capturó (file:///data/user/0/...). Al abrir ese
// formulario desde otro dispositivo esa ruta no existe.
//
// Este servicio recupera las evidencias desde el servidor para que la
// visita se pueda revisar completa desde cualquier teléfono.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { FotoGeotag } from '../types';

export interface ArchivoRemoto {
  id: string;
  tipo: 'foto' | 'video' | 'firma' | 'pdf' | string;
  filename: string;
  mimetype: string;
  latitud: number | null;
  longitud: number | null;
  created_at: string;
  /** Ruta relativa en la API, p.ej. /api/archivos/<id>/contenido */
  url: string;
}

/** URL absoluta para descargar una evidencia */
export const urlDeArchivo = (archivo: ArchivoRemoto): string =>
  `${API_CONFIG.BASE_URL}${archivo.url}`;

/**
 * Cabeceras necesarias para que <Image> y <VideoView> puedan descargar
 * la evidencia (hacen la petición fuera de axios, sin el interceptor).
 */
export const cabecerasDeArchivo = async (): Promise<Record<string, string>> => {
  const token = await getApiAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Evidencias que el servidor tiene asociadas a un formulario */
export const fetchArchivosDeFormulario = async (
  formularioId: string
): Promise<ArchivoRemoto[]> => {
  try {
    const response = await apiClient.get(
      `${API_CONFIG.ENDPOINTS.ARCHIVOS}/formulario/${encodeURIComponent(formularioId)}`,
      { timeout: 15000 }
    );
    if (response.data?.estado === 'ok' && Array.isArray(response.data?.archivos)) {
      return response.data.archivos as ArchivoRemoto[];
    }
    return [];
  } catch (error) {
    const err = error as any;
    if (err?.isOffline) {
      console.warn('[Archivos] Sin conexión — no se pueden traer evidencias remotas');
    } else {
      console.warn('[Archivos] Error obteniendo evidencias:', err?.message || error);
    }
    return [];
  }
};

/** ¿El archivo local sigue existiendo en este dispositivo? */
const existeLocalmente = async (uri?: string): Promise<boolean> => {
  if (!uri) return false;
  // Las URIs http(s) y data: no son archivos locales: se asumen válidas
  if (!uri.startsWith('file://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
};

/**
 * Devuelve las evidencias de un formulario listas para mostrar.
 *
 * Si los archivos locales existen (el mismo teléfono que capturó la
 * visita) se usan tal cual — funciona sin conexión. Si no existen, se
 * reconstruyen desde el servidor.
 *
 * @returns `null` si no hizo falta sustituir nada (usar `form.fotos`)
 */
export const resolverEvidenciasRemotas = async (
  formularioId: string,
  fotos: FotoGeotag[] | undefined
): Promise<FotoGeotag[] | null> => {
  const lista = fotos || [];

  // Si al menos una evidencia sigue en disco, este es el teléfono original
  if (lista.length > 0) {
    const disponibles = await Promise.all(lista.map((f) => existeLocalmente(f.uri)));
    if (disponibles.some(Boolean)) return null;
  }

  const remotos = await fetchArchivosDeFormulario(formularioId);
  // Firmas y PDFs se muestran aparte; aquí solo fotos y videos
  const evidencias = remotos.filter((a) => a.tipo === 'foto' || a.tipo === 'video');
  if (evidencias.length === 0) return null;

  console.log(
    `[Archivos] ${evidencias.length} evidencia(s) recuperadas del servidor para ${formularioId}`
  );

  return evidencias.map((a) => ({
    id: a.id,
    uri: urlDeArchivo(a),
    tipo: a.tipo === 'video' ? 'video' : 'foto',
    timestamp: a.created_at,
    coordenadas: {
      latitud: a.latitud ?? 0,
      longitud: a.longitud ?? 0,
    },
  })) as FotoGeotag[];
};
