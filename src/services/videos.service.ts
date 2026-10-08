// ============================================================
// GEODAILY — Servicio de Videos
// Sube videos georreferenciados al backend → MinIO (carpeta videos/)
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';

/**
 * Subir un video al backend Express, que lo almacena en MinIO (carpeta videos/)
 */
export const uploadVideo = async (
  videoUri: string,
  latitud?: number,
  longitud?: number,
  descripcion?: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string,
  /** Vincula la evidencia al formulario para poder recuperarla desde otro dispositivo */
  formularioId?: string,
  /** Ver nota en photos.service.ts — deduplica reintentos de subida. */
  evidenciaId?: string
): Promise<{ id: string; estado: string; ruta?: string; filename?: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-expect-error — React Native FormData
    formData.append('archivo', {
      uri: videoUri,
      type: 'video/mp4',
      name: `video_${Date.now()}.mp4`,
    });

    if (latitud !== undefined) formData.append('latitud', String(latitud));
    if (longitud !== undefined) formData.append('longitud', String(longitud));
    if (descripcion) formData.append('descripcion', descripcion);
    if (beneficiarioCedula) formData.append('beneficiario_cedula', beneficiarioCedula);
    if (beneficiarioNombre) formData.append('beneficiario_nombre', beneficiarioNombre);
    if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);
    if (formularioId) formData.append('formulario_id', formularioId);
    if (evidenciaId) formData.append('evidencia_id', evidenciaId);

    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.VIDEOS + '/subir',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000, // 2 min — los videos pesan más
      }
    );

    return response.data;
  } catch (error) {
    // 410 = un admin/coordinador eliminó este video desde el detalle del
    // formulario (ver DELETE /api/archivos/:id). No es un fallo de red: se
    // devuelve estado 'eliminado' para que el sincronizador descarte la copia
    // local en vez de reintentar la subida para siempre.
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 410) {
      console.warn('[Videos] Evidencia eliminada en el servidor — se descarta la copia local');
      return { id: '', estado: 'eliminado' };
    }
    if (isOfflineError(error)) {
      console.warn('[Videos] Offline — video guardado solo localmente');
      return null;
    }
    console.error('[Videos] Error al subir:', error);
    return null;
  }
};
