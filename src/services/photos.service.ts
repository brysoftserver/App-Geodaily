// ============================================================
// GEODAILY — Servicio de Fotos / Cámara
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';

/**
 * Subir una foto georreferenciada al servidor QGIS
 */
export const uploadPhoto = async (
  photoUri: string,
  latitud?: number,
  longitud?: number,
  altitud?: number,
  nombre?: string,
  descripcion?: string
): Promise<{ id: string; estado: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-ignore — React Native FormData
    formData.append('archivo', {
      uri: photoUri,
      type: 'image/jpeg',
      name: `foto_${Date.now()}.jpg`,
    });

    if (latitud !== undefined) formData.append('latitud', String(latitud));
    if (longitud !== undefined) formData.append('longitud', String(longitud));
    if (altitud !== undefined) formData.append('altitud', String(altitud));
    if (nombre) formData.append('nombre', nombre);
    if (descripcion) formData.append('descripcion', descripcion);

    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.PHOTOS + '/subir',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      }
    );

    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Fotos] Offline — foto guardada solo localmente');
      return null;
    }
    console.error('[Fotos] Error:', error);
    return null;
  }
};

/**
 * Obtener información de una foto por ID
 */
export const getPhotoInfo = async (puntoId: string): Promise<any> => {
  try {
    const response = await apiClient.get(
      `${API_CONFIG.ENDPOINTS.PHOTOS}/${puntoId}`
    );
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) return null;
    throw error;
  }
};
