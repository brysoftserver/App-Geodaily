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
  tipoFormulario?: string
): Promise<{ id: string; estado: string } | null> => {
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
    if (isOfflineError(error)) {
      console.warn('[Videos] Offline — video guardado solo localmente');
      return null;
    }
    console.error('[Videos] Error al subir:', error);
    return null;
  }
};
