// ============================================================
// GEODAILY — Edición de la Visita 2 por un admin autorizado
// ============================================================
// La lista de usuarios autorizados vive SOLO en el backend
// (routes/edicionVisitas.js): la app pregunta /permiso y muestra el panel de
// edición si la respuesta es sí. Editar requiere conexión.
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';
import { ActividadRealizada, MedicionAdjunta } from '../types';

const ENDPOINT = API_CONFIG.ENDPOINTS.EDICION_VISITAS;

export type CampoVisita2 =
  | 'objetivo'
  | 'descripcion'
  | 'seguimiento_compromisos'
  | 'valoracion_cumplimiento'
  | 'recomendaciones'
  | 'observaciones'
  | 'area_intervencion'
  | 'compromisos_siguiente_visita';

export interface DefCampoVisita2 {
  campo: CampoVisita2;
  titulo: string;
  tipo: 'texto' | 'porcentaje' | 'area' | 'lista';
  /** Valor actual tal como se muestra/edita. */
  leer: (a: ActividadRealizada) => string;
}

/** Campos corregibles, en el orden del formulario de la Visita 2. */
export const CAMPOS_VISITA_2: DefCampoVisita2[] = [
  { campo: 'objetivo', titulo: 'Objetivo', tipo: 'texto', leer: (a) => a.objetivo || '' },
  { campo: 'descripcion', titulo: 'Descripción de la visita', tipo: 'texto', leer: (a) => a.descripcion || '' },
  { campo: 'area_intervencion', titulo: 'Área a intervenir (ha)', tipo: 'area', leer: (a) => a.area_intervencion || '' },
  { campo: 'seguimiento_compromisos', titulo: 'Seguimiento de compromisos', tipo: 'texto', leer: (a) => a.seguimiento_compromisos || '' },
  { campo: 'valoracion_cumplimiento', titulo: 'Valoración del cumplimiento (0–100)', tipo: 'porcentaje', leer: (a) => a.valoracion_cumplimiento || '' },
  { campo: 'recomendaciones', titulo: 'Recomendaciones', tipo: 'texto', leer: (a) => a.recomendaciones || '' },
  {
    campo: 'compromisos_siguiente_visita',
    titulo: 'Compromisos para la siguiente visita (uno por línea)',
    tipo: 'lista',
    leer: (a) => (a.compromisos_siguiente_visita || []).join('\n'),
  },
  { campo: 'observaciones', titulo: 'Observaciones', tipo: 'texto', leer: (a) => a.observaciones || '' },
];

export interface MedicionDisponible extends MedicionAdjunta {
  /** La medición se tomó para el beneficiario de esta visita. */
  delBeneficiario: boolean;
  /** Sin cédula de beneficiario, pero queda cerca del punto de la visita. */
  cercana?: boolean;
  /** Distancia (m) al punto de la visita, cuando `cercana`. */
  distancia_m?: number;
}

let permisoCache: { valor: boolean; hasta: number } | null = null;

/** ¿El usuario actual puede editar la Visita 2? Sin conexión → false. Cache de 5 min. */
export const obtenerPermisoEdicionVisita2 = async (): Promise<boolean> => {
  if (permisoCache && permisoCache.hasta > Date.now()) return permisoCache.valor;
  try {
    const r = await apiClient.get(`${ENDPOINT}/permiso`, { timeout: 8000 });
    const valor = !!r.data?.puedeEditarVisita2;
    permisoCache = { valor, hasta: Date.now() + 5 * 60 * 1000 };
    return valor;
  } catch {
    return false;
  }
};

/** Para pruebas o al cerrar sesión. */
export const olvidarPermisoEdicionVisita2 = () => {
  permisoCache = null;
};

export const corregirCampoVisita2 = async (formularioId: string, campo: CampoVisita2, valor: string): Promise<ActividadRealizada> => {
  const r = await apiClient.patch(`${ENDPOINT}/${encodeURIComponent(formularioId)}/campo`, { campo, valor }, { timeout: 15000 });
  return r.data.actividad;
};

export const listarMedicionesVisita2 = async (
  formularioId: string
): Promise<{ actuales: string[]; mediciones: MedicionDisponible[] }> => {
  const r = await apiClient.get(`${ENDPOINT}/${encodeURIComponent(formularioId)}/mediciones`, { timeout: 15000 });
  const actuales: string[] = Array.isArray(r.data.actuales)
    ? r.data.actuales
    : [r.data.actual, r.data.actual2].filter(Boolean);
  return { actuales, mediciones: r.data.mediciones || [] };
};

/**
 * Carga un polígono desde una medición del técnico o desde los puntos de un
 * KML/KMZ. `posicion` (1..N) reemplaza ese polígono; `null` agrega uno nuevo.
 */
export const cargarPoligonoVisita2 = async (
  formularioId: string,
  posicion: number | null,
  origen: { medicionId: string } | { kml: { nombre: string; puntos: { latitud: number; longitud: number }[] } }
): Promise<ActividadRealizada> => {
  const r = await apiClient.put(
    `${ENDPOINT}/${encodeURIComponent(formularioId)}/poligono`,
    { ...(posicion != null ? { posicion } : {}), ...origen },
    { timeout: 20000 }
  );
  return r.data.actividad;
};

/**
 * Selección múltiple: deja como polígonos de la visita las mediciones
 * marcadas (las desmarcadas de la lista se quitan; los KML se conservan).
 */
export const guardarSeleccionPoligonosVisita2 = async (formularioId: string, medicionIds: string[]): Promise<ActividadRealizada> => {
  const r = await apiClient.put(`${ENDPOINT}/${encodeURIComponent(formularioId)}/poligonos`, { medicionIds }, { timeout: 20000 });
  return r.data.actividad;
};

/** Quita el polígono N (1..N) de la visita. */
export const quitarPoligonoVisita2 = async (formularioId: string, posicion: number): Promise<ActividadRealizada> => {
  const r = await apiClient.delete(`${ENDPOINT}/${encodeURIComponent(formularioId)}/poligono/${posicion}`, { timeout: 15000 });
  return r.data.actividad;
};
