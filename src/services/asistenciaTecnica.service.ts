// ============================================================
// GEODAILY — Servicio de Asistencia Técnica (visitas por técnico)
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.ASISTENCIA_TECNICA;

export interface VisitaAsistencia {
  id: string;
  tipo: 'caracterizacion' | 'visita_tecnica';
  /** Número de visita (1 = caracterización); null en visitas del formato antiguo. */
  numero: number | null;
  nombre: string;
  cedula: string;
  vereda: string;
  corregimiento: string;
  fecha: string;
}

export interface TecnicoAsistencia {
  usuario: string;
  nombre: string;
  visitas: number;
  beneficiarios: number;
}

export const obtenerResumenAsistencia = async (): Promise<{ total: number; tecnicos: TecnicoAsistencia[] }> => {
  const r = await apiClient.get(`${ENDPOINT}/resumen`);
  return { total: r.data.total, tecnicos: r.data.tecnicos };
};

export const listarMisVisitas = async (): Promise<VisitaAsistencia[]> => {
  const r = await apiClient.get(`${ENDPOINT}/mis-visitas`);
  return r.data.visitas;
};

export const listarVisitasDeTecnico = async (usuario: string): Promise<VisitaAsistencia[]> => {
  const r = await apiClient.get(`${ENDPOINT}/tecnico/${encodeURIComponent(usuario)}`);
  return r.data.visitas;
};

/** "Visita 2"; "Visita Técnica" para las del formato antiguo sin número. */
export const etiquetaVisita = (v: Pick<VisitaAsistencia, 'numero'>): string =>
  v.numero != null ? `Visita ${v.numero}` : 'Visita Técnica';
