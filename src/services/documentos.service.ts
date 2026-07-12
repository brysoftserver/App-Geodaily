// ============================================================
// GEODAILY — Servicio de Documentos / Anexos (subida a MinIO)
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';

/**
 * Subir un documento (anexo) al servidor
 * @param uri Ruta local del archivo
 * @param descripcion Descripción opcional
 * @param categoria Categoría opcional
 */
export const subirDocumento = async (
  uri: string,
  descripcion?: string,
  categoria?: string,
  nombre?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-ignore — React Native FormData
    formData.append('archivo', {
      uri,
      type: 'application/octet-stream',
      name: nombre || `doc_${Date.now()}`,
    });

    if (descripcion) formData.append('descripcion', descripcion);
    if (categoria) formData.append('categoria', categoria);

    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.DOCUMENTOS + '/subir',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }
    );

    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Documentos] Offline — documento guardado solo localmente');
      return null;
    }
    console.error('[Documentos] Error:', error);
    return null;
  }
};

/**
 * Subir múltiples documentos
 */
export const subirMultiplesDocumentos = async (
  archivos: { uri: string; nombre?: string; descripcion?: string }[]
): Promise<{ estado: string; documentos?: any[] } | null> => {
  try {
    const formData = new FormData();

    for (const archivo of archivos) {
      // @ts-ignore — React Native FormData
      formData.append('archivos', {
        uri: archivo.uri,
        type: 'application/octet-stream',
        name: archivo.nombre || `doc_${Date.now()}`,
      });
    }

    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.DOCUMENTOS + '/subir-multiple',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }
    );

    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Documentos] Offline — documentos guardados solo localmente');
      return null;
    }
    console.error('[Documentos] Error:', error);
    return null;
  }
};

/**
 * Obtener lista de documentos del usuario
 */
export const listarDocumentos = async (): Promise<any[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.DOCUMENTOS);
    return response.data?.documentos || [];
  } catch (error) {
    if (isOfflineError(error)) return [];
    console.error('[Documentos] Error al listar:', error);
    return [];
  }
};
