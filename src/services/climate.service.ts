// ============================================================
// GEODAILY — Servicio de Clima
// ============================================================

import apiClient, { isOfflineError } from './api';
import { ClimaActual, ResumenClimatico } from '../types';
import { API_CONFIG } from '../theme';

/**
 * Obtener clima actual desde el servidor QGIS
 */
export const getClimaActual = async (
  lat: number,
  lon: number
): Promise<ClimaActual | null> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.CLIMATE + '/actual', {
      params: { lat, lon },
    });
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Clima] Offline — no hay datos de clima actual');
      return null;
    }
    console.error(
      '[Clima] Error en getClimaActual:',
      error instanceof Error ? error.message : error,
      (error as any)?.response?.status ? `HTTP ${(error as any).response.status}` : '',
      (error as any)?.response?.data ? JSON.stringify((error as any).response.data) : ''
    );
    return null;
  }
};

/**
 * Obtener resumen climático completo (actual + histórico)
 */
export const getResumenClimatico = async (
  lat: number,
  lon: number
): Promise<ResumenClimatico | null> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.CLIMATE + '/resumen', {
      params: { lat, lon },
    });
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Clima] Offline — no hay resumen climático');
      return null;
    }
    const status = (error as any)?.response?.status;
    const data = (error as any)?.response?.data;
    const message = error instanceof Error ? error.message : String(error);

    // 🔍 Caso especial: 401 Token requerido — el token JWT no se está enviando
    if (status === 401) {
      console.warn(
        `[Clima] 401 en getResumenClimatico — el token JWT no fue aceptado. ` +
        `Respuesta: ${JSON.stringify(data)}. ` +
        `Verifica que el token esté presente en SecureStore.`
      );
    } else {
      console.error(
        `[Clima] Error en getResumenClimatico: ${message}${status ? ` (HTTP ${status})` : ''}`,
        data ? JSON.stringify(data) : ''
      );
    }
    return null;
  }
};

/**
 * Obtener datos climáticos históricos (WorldClim offline)
 */
export const getClimaHistorico = async (
  lat: number,
  lon: number,
  variable: string = 'tavg'
): Promise<any> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.CLIMATE + '/historico', {
      params: { lat, lon, variable },
    });
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) return null;
    console.error(
      '[Clima] Error en getClimaHistorico:',
      error instanceof Error ? error.message : error,
      (error as any)?.response?.status ? `HTTP ${(error as any).response.status}` : ''
    );
    return null;
  }
};
