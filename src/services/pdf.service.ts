// ============================================================
// GEODAILY — Servicio de PDF
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';
import { Formulario } from '../types';

/**
 * Generar PDF del formulario en el backend Express (no en QGIS)
 * y devolver la URL del PDF generado
 */
export const generarPDF = async (
  formulario: Formulario
): Promise<string | null> => {
  try {
    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.PDF + '/generar',
      formulario,
      { responseType: 'json', timeout: 30000 }
    );

    // El backend responde `pdf_ruta` (ruta en MinIO). Leer `pdf_url` daba
    // siempre null: el PDF sí se generaba y subía, pero el sync lo daba por
    // fallido y `formularios.pdf_url` se quedaba vacío para siempre.
    const ruta = response.data?.pdf_ruta || response.data?.pdf_url;
    if (ruta) {
      return typeof ruta === 'string' && ruta.startsWith('http')
        ? ruta
        : `${API_CONFIG.BASE_URL}${ruta}`;
    }
    return null;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[PDF] Offline — no se puede generar PDF');
      return null;
    }
    console.error('[PDF] Error:', error);
    return null;
  }
};

/**
 * Obtener URL del informe PDF
 */
export const getPDFUrl = (pdfPath: string): string => {
  if (pdfPath.startsWith('http')) return pdfPath;
  return `${API_CONFIG.BASE_URL}${pdfPath}`;
};
