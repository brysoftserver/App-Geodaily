// ============================================================
// GEODAILY — Servicio de actividades medidas en hectáreas
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.ACTIVIDADES_HECTAREAS;

export interface BeneficiarioHectareas {
  item: number;
  nombre: string;
  cedula: string;
  corregimiento: string;
  vereda: string;
  hectareas: number;
  /** Visita que respalda las hectáreas (null = aún no la tiene). */
  formularioId: string | null;
}

export interface TecnicoHectareas {
  usuario: string;
  nombre: string;
  asignados: number;
  hectareas: number;
}

export interface ResumenHectareas {
  meta: number;
  total: number;
  tecnicos: TecnicoHectareas[];
}

/** Hectáreas con hasta 2 decimales y coma decimal: 2,5 · 1.250 */
export const formatearHectareas = (n: number): string =>
  Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });

export const obtenerResumenHectareas = async (actividad: string): Promise<ResumenHectareas> => {
  const r = await apiClient.get(`${ENDPOINT}/${actividad}/resumen`);
  return { meta: r.data.meta, total: r.data.total, tecnicos: r.data.tecnicos };
};

export const listarMisBeneficiariosHectareas = async (actividad: string): Promise<BeneficiarioHectareas[]> => {
  const r = await apiClient.get(`${ENDPOINT}/${actividad}/mis-beneficiarios`);
  return r.data.beneficiarios;
};

export const listarBeneficiariosHectareasDeTecnico = async (
  actividad: string,
  usuario: string
): Promise<BeneficiarioHectareas[]> => {
  const r = await apiClient.get(`${ENDPOINT}/${actividad}/tecnico/${encodeURIComponent(usuario)}`);
  return r.data.beneficiarios;
};

/** Total de hectáreas por actividad en todo el proyecto (tarjetas de la lista de actividades). */
export const obtenerAvanceHectareas = async (): Promise<Record<string, number>> => {
  const r = await apiClient.get(`${ENDPOINT}/avance`);
  return r.data.avance || {};
};
