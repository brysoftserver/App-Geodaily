// ============================================================
// GEODAILY — Servicio de Georreferenciación
// ============================================================

import apiClient, { isOfflineError } from './api';
import { GeoReferencia, Coordenadas } from '../types';
import { API_CONFIG } from '../theme';

/**
 * Obtener información de georreferenciación desde el servidor QGIS
 */
export const getGeoreference = async (
  lat: number,
  lon: number,
  alt?: number
): Promise<GeoReferencia | null> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.GEOREFERENCE, {
      params: { lat, lon, alt },
    });

    const data = response.data;
    return {
      coordenadas: { latitud: data.latitud, longitud: data.longitud, altitud: data.altitud },
      huso_utm: data.huso_utm,
      banda_utm: data.banda_utm,
      codigo_mgrs: data.codigo_mgrs,
      zona_horaria: data.zona_horaria,
      pais: data.pais,
    };
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Geo] Offline — calculando UTM/MGRS localmente');
      return calcularGeoreferenciaLocal(lat, lon, alt);
    }
    // También fallback local si el servidor responde con error (404, 500, etc.)
    console.warn('[Geo] Error del servidor — usando cálculo local:', (error as any)?.response?.status || (error as any)?.message);
    return calcularGeoreferenciaLocal(lat, lon, alt);
  }
};

/**
 * Guardar un punto en PostGIS
 */
export const guardarPunto = async (
  latitud: number,
  longitud: number,
  altitud?: number,
  nombre?: string,
  descripcion?: string
): Promise<{ id: string } | null> => {
  try {
    const response = await apiClient.post(API_CONFIG.ENDPOINTS.GEOREFERENCE + '/guardar', {
      latitud,
      longitud,
      altitud,
      nombre,
      descripcion,
    });
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Geo] Offline — punto no guardado en servidor');
      return null;
    }
    throw error;
  }
};

/**
 * Buscar puntos cercanos
 */
export const getPuntosCercanos = async (
  lat: number,
  lon: number,
  radioKm: number = 5
): Promise<any[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.GEOREFERENCE + '/cercanos', {
      params: { lat, lon, radio_km: radioKm },
    });
    return response.data.puntos || [];
  } catch (error) {
    if (isOfflineError(error)) return [];
    throw error;
  }
};

// --- Cálculos locales offline (fallback sin servidor) ---

function calcularHusoUTM(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

function calcularBandaUTM(lat: number): string {
  const bandas = 'CDEFGHJKLMNPQRSTUVWXX';
  const idx = Math.min(Math.max(Math.floor((lat + 80) / 8), 0), bandas.length - 1);
  return bandas[idx];
}

function calcularMGRS(lat: number, lon: number): string {
  const huso = calcularHusoUTM(lon);
  const banda = calcularBandaUTM(lat);
  const letrasEste = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letrasNorte = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const col = Math.floor((lon + 180) / 6) % 20;
  const row = Math.floor((lat + 80) / 8) % 20;
  const este = letrasEste[col % letrasEste.length];
  const norte = letrasNorte[row % letrasNorte.length];
  return `${huso}${banda}${este}${norte}`;
}

function calcularZonaHoraria(lon: number): string {
  const offset = Math.round(lon / 15);
  const signo = offset >= 0 ? '+' : '';
  return `UTC${signo}${offset}`;
}

function calcularGeoreferenciaLocal(
  lat: number,
  lon: number,
  alt?: number
): GeoReferencia {
  const huso = calcularHusoUTM(lon);
  const banda = calcularBandaUTM(lat);
  return {
    coordenadas: { latitud: lat, longitud: lon, altitud: alt },
    huso_utm: huso,
    banda_utm: banda,
    codigo_mgrs: calcularMGRS(lat, lon),
    zona_horaria: calcularZonaHoraria(lon),
    pais: 'Colombia',
  };
}
