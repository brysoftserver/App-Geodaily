// ============================================================
// GEODAILY — Servicio de Formularios (API remota)
// ============================================================

import { Formulario } from '../types';
import apiClient from './api';
import { API_CONFIG } from '../theme';

/**
 * Obtener todos los formularios desde el servidor
 */
export const fetchFormulariosDelServidor = async (): Promise<Formulario[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.FORMS, {
      timeout: 15000,
    });

    if (response.data?.estado === 'ok' && Array.isArray(response.data?.formularios)) {
      const forms = response.data.formularios as Formulario[];
      console.log(`[API Forms] ${forms.length} formularios obtenidos del servidor`);
      return forms;
    }

    console.warn('[API Forms] Respuesta inesperada:', response.data);
    return [];
  } catch (error: any) {
    if (error?.isOffline) {
      console.warn('[API Forms] Sin conexión — no se pueden obtener formularios del servidor');
    } else {
      console.error('[API Forms] Error:', error?.message || error);
    }
    return [];
  }
};

/**
 * Obtener un formulario por ID desde el servidor
 */
export const fetchFormularioDelServidor = async (id: string): Promise<Formulario | null> => {
  try {
    const response = await apiClient.get(`${API_CONFIG.ENDPOINTS.FORMS}/${id}`, {
      timeout: 15000,
    });

    if (response.data?.estado === 'ok' && response.data?.formulario) {
      return response.data.formulario as Formulario;
    }

    return null;
  } catch (error: any) {
    console.warn('[API Forms] Error obteniendo formulario:', id, error?.message || error);
    return null;
  }
};
