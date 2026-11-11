// ============================================================
// GEODAILY — Evidencia de una actividad por beneficiario
// ============================================================
// Actas de entrega de la actividad + fotos del antes / durante / después
// (máx. 3 por momento). Ver backend/src/routes/actividadesEvidencias.js.
// ============================================================

import { Platform } from 'react-native';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.ACTIVIDADES_EVIDENCIAS;

export type MomentoEvidencia = 'antes' | 'durante' | 'despues';

export const MOMENTOS_EVIDENCIA: Array<{ id: MomentoEvidencia; titulo: string }> = [
  { id: 'antes', titulo: 'Evidencia Fotográfica del Antes de la Actividad' },
  { id: 'durante', titulo: 'Evidencia Fotográfica del Durante la Actividad' },
  { id: 'despues', titulo: 'Evidencia Fotográfica del Después de la Actividad' },
];

export interface FotoEvidencia {
  id: number;
  nombre: string | null;
  fecha: string;
}

export interface ObservacionActa {
  id: number;
  autor: string | null;
  rol: string;
  comentario: string;
  resuelta: boolean;
  fecha: string;
  /** Quien la dejó (o un admin) puede marcarla como resuelta. */
  puedeResolver: boolean;
}

export interface ActaDeActividad {
  id: string;
  instancia: string;
  fecha: string;
  tienePdf: boolean;
  firmadaInterventoria: boolean;
  /** Qué se entregó (descripciones separadas por coma). */
  resumen: string;
  /** Datos que el técnico dejó pendientes al completar el acta. */
  faltantes: string[];
  observaciones: ObservacionActa[];
}

export interface EvidenciaBeneficiario {
  maxPorMomento: number;
  actas: ActaDeActividad[];
  fotos: Record<MomentoEvidencia, FotoEvidencia[]>;
}

export const obtenerEvidenciaBeneficiario = async (actividad: string, item: number): Promise<EvidenciaBeneficiario> => {
  const r = await apiClient.get(`${ENDPOINT}/${actividad}/${item}`);
  return { maxPorMomento: r.data.maxPorMomento ?? 3, actas: r.data.actas, fotos: r.data.fotos };
};

export const subirFotoEvidencia = async (
  actividad: string,
  item: number,
  momento: MomentoEvidencia,
  archivo: { uri: string; nombre: string; mimeType?: string }
): Promise<void> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // En el navegador FormData solo acepta Blob/File.
    const blob = await (await fetch(archivo.uri)).blob();
    formData.append('archivo', blob, archivo.nombre);
  } else {
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri: archivo.uri, type: archivo.mimeType || 'image/jpeg', name: archivo.nombre });
  }
  await apiClient.post(`${ENDPOINT}/${actividad}/${item}/${momento}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
};

/** Solo admin: sube un acta en PDF. Con `actaId` reemplaza el PDF de esa acta; sin él crea una nueva. */
export const subirActaPdfAdmin = async (
  actividad: string,
  item: number,
  archivo: { uri: string; nombre: string; mimeType?: string },
  actaId?: string
): Promise<void> => {
  const formData = new FormData();
  if (actaId) formData.append('actaId', actaId);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(archivo.uri)).blob();
    formData.append('archivo', blob, archivo.nombre);
  } else {
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri: archivo.uri, type: archivo.mimeType || 'application/pdf', name: archivo.nombre });
  }
  await apiClient.post(`${ENDPOINT}/${actividad}/${item}/acta`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
};

/** Solo admin: elimina un acta de la actividad (con su PDF y observaciones). */
export const eliminarActaAdmin = async (actividad: string, item: number, actaId: string): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/${actividad}/${item}/acta/${encodeURIComponent(actaId)}`);
};

export const eliminarFotoEvidencia = async (id: number): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/foto/${id}`);
};

/**
 * Fuente para <Image>: en nativo va con la cabecera Authorization; en web las
 * imágenes no pueden enviar cabeceras, así que el token viaja en la URL.
 */
export const fuenteFotoEvidencia = async (id: number): Promise<{ uri: string; headers?: Record<string, string> }> => {
  const uri = `${API_CONFIG.BASE_URL}${ENDPOINT}/foto/${id}`;
  const token = await getApiAuthToken();
  if (!token) return { uri };
  return Platform.OS === 'web'
    ? { uri: `${uri}?token=${encodeURIComponent(token)}` }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
};

/** Un rol superior avisa de un dato errado o faltante en el acta (notifica al técnico). */
export const crearObservacionActa = async (formatoId: string, comentario: string): Promise<void> => {
  await apiClient.post(`${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(formatoId)}/observaciones`, { comentario });
};

export const resolverObservacionActa = async (observacionId: number): Promise<void> => {
  await apiClient.post(`${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/observaciones/${observacionId}/resolver`);
};

/** Acta completa (con firmas) del servidor, para armar su PDF cuando aún no hay uno guardado. */
export const obtenerDatosActaServidor = async (formatoId: string): Promise<Record<string, any>> => {
  const r = await apiClient.get(`${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(formatoId)}`);
  const d = r.data.formato?.datos;
  return typeof d === 'string' ? JSON.parse(d) : d;
};
