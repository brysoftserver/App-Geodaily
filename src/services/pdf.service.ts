// ============================================================
// GEODAILY — Servicio de PDF
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';
import { Formulario } from '../types';

/**
 * Generar PDF del formulario en el servidor QGIS
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

    if (response.data?.pdf_url) {
      return `${API_CONFIG.BASE_URL}${response.data.pdf_url}`;
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
