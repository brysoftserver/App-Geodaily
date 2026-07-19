// ============================================================
// GEODAILY — Servicio de Fotos / Cámara
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';

/**
 * Subir una foto georreferenciada al backend Express, que la almacena en MinIO
 */
export const uploadPhoto = async (
  photoUri: string,
  latitud?: number,
  longitud?: number,
  altitud?: number,
  nombre?: string,
  descripcion?: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  timestampCaptura?: string,
  tipoFormulario?: string,
  /** Vincula la evidencia al formulario para poder recuperarla desde otro dispositivo */
  formularioId?: string
): Promise<{ id: string; estado: string; ruta?: string; filename?: string } | null> => {
  try {
    const formData = new FormData();

    // @ts-expect-error — React Native FormData
    formData.append('archivo', {
      uri: photoUri,
      type: 'image/jpeg',
      name: `foto_${Date.now()}.jpg`,
    });

    if (latitud !== undefined) formData.append('latitud', String(latitud));
    if (longitud !== undefined) formData.append('longitud', String(longitud));
    if (altitud !== undefined) formData.append('altitud', String(altitud));
    // Fecha de CAPTURA (no de subida) — el backend la estampa en la marca
    // de agua; esencial para fotos tomadas offline y sincronizadas después
    if (timestampCaptura) formData.append('timestamp_captura', timestampCaptura);
    if (nombre) formData.append('nombre', nombre);
    if (descripcion) formData.append('descripcion', descripcion);
    if (beneficiarioCedula) formData.append('beneficiario_cedula', beneficiarioCedula);
    if (beneficiarioNombre) formData.append('beneficiario_nombre', beneficiarioNombre);
    if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);
    if (formularioId) formData.append('formulario_id', formularioId);

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
export const getPhotoInfo = async (puntoId: string): Promise<Record<string, any> | null> => {
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
