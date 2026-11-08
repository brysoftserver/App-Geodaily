// ============================================================
// GEODAILY — Fortalecimiento de Capacidades (ECAS)
// ============================================================
// Archivos compartidos por ECA y grupo de veredas. Ver
// backend/src/routes/fortalecimiento.js.
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { SeccionEca } from '../data/fortalecimiento';

const ENDPOINT = API_CONFIG.ENDPOINTS.FORTALECIMIENTO;

export interface ArchivoFortalecimiento {
  id: number;
  nombre: string | null;
  tipo: 'pdf' | 'imagen';
  tamano: number | null;
  subidoPor: string | null;
  fecha: string;
  puedeEliminar: boolean;
}

export interface ArchivosGrupoEca {
  /** Lo decide el servidor según el rol (técnico o admin). */
  puedeSubir: boolean;
  secciones: Record<SeccionEca, ArchivoFortalecimiento[]>;
}

/** Archivos por ECA y grupo: { "1": { "2": 5 } }. */
export const obtenerResumenEcas = async (): Promise<Record<string, Record<string, number>>> => {
  const r = await apiClient.get(`${ENDPOINT}/ecas/resumen`);
  return r.data.conteos ?? {};
};

export const obtenerArchivosGrupoEca = async (eca: number, grupo: number): Promise<ArchivosGrupoEca> => {
  const r = await apiClient.get(`${ENDPOINT}/ecas/${eca}/${grupo}`);
  return { puedeSubir: !!r.data.puedeSubir, secciones: r.data.secciones };
};

export const subirArchivoEca = async (
  eca: number,
  grupo: number,
  seccion: SeccionEca,
  archivo: { uri: string; nombre: string; mimeType?: string }
): Promise<void> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // En el navegador FormData solo acepta Blob/File.
    const blob = await (await fetch(archivo.uri)).blob();
    formData.append('archivo', blob, archivo.nombre);
  } else {
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri: archivo.uri, type: archivo.mimeType || 'application/octet-stream', name: archivo.nombre });
  }
  await apiClient.post(`${ENDPOINT}/ecas/${eca}/${grupo}/${seccion}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  });
};

export const eliminarArchivoFortalecimiento = async (id: number): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/archivo/${id}`);
};

/**
 * Fuente para <Image>: en nativo va con la cabecera Authorization; en web las
 * imágenes no pueden enviar cabeceras, así que el token viaja en la URL.
 */
export const fuenteArchivoFortalecimiento = async (id: number): Promise<{ uri: string; headers?: Record<string, string> }> => {
  const uri = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivo/${id}`;
  const token = await getApiAuthToken();
  if (!token) return { uri };
  return Platform.OS === 'web'
    ? { uri: `${uri}?token=${encodeURIComponent(token)}` }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
};

/**
 * PDF listo para el visor: en nativo se descarga a caché y se devuelve la URI
 * local; en web se devuelve la URL con el token (el navegador lo muestra).
 */
export const descargarPdfFortalecimiento = async (id: number): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivo/${id}`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const destino = `${FileSystem.cacheDirectory}fortalecimiento_${id}_${Date.now()}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  return uri;
};
