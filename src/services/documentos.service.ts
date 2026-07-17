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
  nombre?: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-expect-error — React Native FormData
    formData.append('archivo', {
      uri,
      type: 'application/octet-stream',
      name: nombre || `doc_${Date.now()}`,
    });

    if (descripcion) formData.append('descripcion', descripcion);
    if (categoria) formData.append('categoria', categoria);
    if (beneficiarioCedula) formData.append('beneficiario_cedula', beneficiarioCedula);
    if (beneficiarioNombre) formData.append('beneficiario_nombre', beneficiarioNombre);
    if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);

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
  archivos: { uri: string; nombre?: string; descripcion?: string }[],
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string
): Promise<{ estado: string; documentos?: Record<string, any>[] } | null> => {
  try {
    const formData = new FormData();

    for (const archivo of archivos) {
      // @ts-expect-error — React Native FormData
      formData.append('archivos', {
        uri: archivo.uri,
        type: 'application/octet-stream',
        name: archivo.nombre || `doc_${Date.now()}`,
      });
    }

    if (beneficiarioCedula) formData.append('beneficiario_cedula', beneficiarioCedula);
    if (beneficiarioNombre) formData.append('beneficiario_nombre', beneficiarioNombre);
    if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);

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
export const listarDocumentos = async (): Promise<Record<string, any>[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.DOCUMENTOS);
    return response.data?.documentos || [];
  } catch (error) {
    if (isOfflineError(error)) return [];
    console.error('[Documentos] Error al listar:', error);
    return [];
  }
};
