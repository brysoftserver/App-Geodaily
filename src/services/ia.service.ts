// ============================================================
// GEODAILY — Servicio de Análisis con IA (DeepSeek)
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';
import { PuntoDato, TipoGrafica } from '../utils/encuestaStats';

const IA_ENDPOINT = API_CONFIG.ENDPOINTS.IA;

/** La llamada a DeepSeek desde el backend puede tardar más que un CRUD normal. */
const TIMEOUT_ANALISIS_MS = 30000;

export interface ConfigIA {
  configurado: boolean;
  ultimosDigitos: string | null;
}

/** Solo admin. Nunca devuelve la key completa, solo si está configurada. */
export const getConfigIA = async (): Promise<ConfigIA> => {
  const response = await apiClient.get(`${IA_ENDPOINT}/config`);
  return { configurado: !!response.data?.configurado, ultimosDigitos: response.data?.ultimosDigitos ?? null };
};

/** Solo admin. Guarda/reemplaza la API key de DeepSeek. */
export const guardarApiKeyIA = async (apiKey: string): Promise<void> => {
  await apiClient.put(`${IA_ENDPOINT}/config`, { apiKey });
};

/** Solo admin. Borra la key (desactiva el análisis con IA en toda la app). */
export const eliminarApiKeyIA = async (): Promise<void> => {
  await apiClient.delete(`${IA_ENDPOINT}/config`);
};

export interface SolicitudAnalisisGrafico {
  titulo: string;
  tipo: TipoGrafica;
  seccion?: string;
  datos: PuntoDato[];
  totalRespuestas: number;
  unidad?: string;
}

/**
 * Pide el análisis en texto de una gráfica individual. Devuelve `null` si la
 * IA no está configurada o la llamada falla — nunca lanza, para que el PDF
 * se pueda generar igual sin el análisis.
 */
export const analizarGrafico = async (solicitud: SolicitudAnalisisGrafico): Promise<string | null> => {
  try {
    const response = await apiClient.post(`${IA_ENDPOINT}/analizar-grafico`, solicitud, {
      timeout: TIMEOUT_ANALISIS_MS,
    });
    return response.data?.analisis || null;
  } catch (error: any) {
    console.warn(`[IA] Sin análisis para "${solicitud.titulo}":`, error?.message || error);
    return null;
  }
};
