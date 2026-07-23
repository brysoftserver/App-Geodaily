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
  tipoFormulario?: string,
  /** MIME real del archivo; sin esto todo viajaba como octet-stream */
  mimeType?: string,
  /** Vincula el documento al formulario para poder recuperarlo desde otro
   *  dispositivo. Antes se omitía y el servidor no tenía forma de saber a
   *  qué visita pertenecía cada documento — un supervisor jamás podía
   *  verlos, aunque estuvieran correctamente subidos a MinIO. */
  formularioId?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-expect-error — React Native FormData
    formData.append('archivo', {
      uri,
      type: mimeType || 'application/octet-stream',
      name: nombre || `doc_${Date.now()}`,
    });

    if (descripcion) formData.append('descripcion', descripcion);
    if (categoria) formData.append('categoria', categoria);
    if (beneficiarioCedula) formData.append('beneficiario_cedula', beneficiarioCedula);
    if (beneficiarioNombre) formData.append('beneficiario_nombre', beneficiarioNombre);
    if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);
    if (formularioId) formData.append('formulario_id', formularioId);

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

export interface DocumentoDeFormulario {
  id: string;
  nombre: string;
  mimetype: string;
  size_bytes: number;
  created_at: string;
  descripcion: string | null;
  categoria: string | null;
  /** Ruta relativa en la API, p.ej. /api/archivos/<id>/contenido */
  url: string;
}

/**
 * Documentos de finca vinculados a un formulario — para mostrarlos en el
 * resumen del formulario a cualquier rol de supervisión, no solo al
 * técnico que los subió.
 */
export const fetchDocumentosDeFormulario = async (
  formularioId: string
): Promise<DocumentoDeFormulario[]> => {
  try {
    const response = await apiClient.get(
      `${API_CONFIG.ENDPOINTS.DOCUMENTOS}/formulario/${encodeURIComponent(formularioId)}`,
      { timeout: 15000 }
    );
    if (response.data?.estado === 'ok' && Array.isArray(response.data?.documentos)) {
      return response.data.documentos as DocumentoDeFormulario[];
    }
    return [];
  } catch (error) {
    const err = error as any;
    if (isOfflineError(err)) {
      console.warn('[Documentos] Sin conexión — no se pueden traer documentos del formulario');
    } else {
      console.warn('[Documentos] Error obteniendo documentos del formulario:', err?.message || error);
    }
    return [];
  }
};
