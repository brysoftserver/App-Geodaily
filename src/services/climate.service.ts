// ============================================================
// GEODAILY — Servicio de Clima
// ============================================================

import apiClient, { isOfflineError } from './api';
import { ClimaActual, ResumenClimatico, ClimaEnMomento } from '../types';
import { API_CONFIG } from '../theme';

export interface ResultadoClimaUbicacion {
  /** Nombre de lugar (municipio/departamento), o null si no se pudo resolver nada en absoluto */
  lugar: string | null;
  /** Clima listo para guardar en el formulario, o null si no se pudo obtener */
  resumen: ResumenClimatico | null;
}

/**
 * Obtener clima actual desde el backend Express (no desde QGIS)
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
 * Nombre de lugar + clima para un instante específico. Se usa tanto en
 * captura en línea (sin `fecha`, equivale a "ahora") como para resolver
 * después, durante el sync, el clima de una visita capturada sin señal —
 * pasando la fecha/hora REAL de la captura, no la del momento de sync.
 *
 * A diferencia de `getClimaActual`, si el clima no se pudo obtener pero sí
 * se resolvió el nombre del lugar, esta función devuelve igual esa parte
 * en vez de perder todo el resultado.
 */
export const resolverClimaEnMomento = async (
  lat: number,
  lon: number,
  fechaISO?: string
): Promise<ClimaEnMomento | null> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.CLIMATE + '/en-momento', {
      params: { lat, lon, fecha: fechaISO },
      timeout: 15000,
    });
    return response.data as ClimaEnMomento;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Clima] Offline — no se puede resolver ubicación/clima en este momento');
      return null;
    }
    console.warn(
      '[Clima] Error en resolverClimaEnMomento:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

/**
 * Envuelve `resolverClimaEnMomento` y arma directamente un `ResumenClimatico`
 * listo para `setClima(...)`, más el nombre de lugar por separado — así las
 * pantallas de captura no repiten el mismo mapeo cada una.
 */
export const resolverClimaYUbicacion = async (
  lat: number,
  lon: number,
  fechaISO?: string
): Promise<ResultadoClimaUbicacion> => {
  const resultado = await resolverClimaEnMomento(lat, lon, fechaISO);
  if (!resultado) return { lugar: null, resumen: null };

  const lugar = resultado.ubicacion?.nombre || null;
  if (!resultado.clima) return { lugar, resumen: null };

  const c = resultado.clima;
  const resumen: ResumenClimatico = {
    ubicacion: { latitud: resultado.ubicacion.latitud, longitud: resultado.ubicacion.longitud },
    actual: {
      fuente: resultado.fuente,
      timestamp: c.timestamp,
      ubicacion: resultado.ubicacion,
      temperatura: {
        actual: c.temperatura.actual,
        sensacion_termica: c.temperatura.sensacion_termica,
        // La API horaria no trae mínima/máxima del día — se usa la
        // temperatura del momento como mejor aproximación disponible.
        minima: c.temperatura.minima ?? c.temperatura.actual,
        maxima: c.temperatura.maxima ?? c.temperatura.actual,
      },
      humedad: c.humedad,
      presion: c.presion,
      viento: c.viento,
      nubosidad: c.nubosidad,
      visibilidad: c.visibilidad,
      clima: c.clima,
      icono: c.icono,
      pais: resultado.pais,
    },
    historico: null,
  };
  return { lugar, resumen };
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
