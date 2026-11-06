// ============================================================
// GEODAILY — Servicio de la Bitácora del Beneficiario (interventoría)
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.BITACORA;

export interface BitacoraResumen {
  item: number;
  nombre: string;
  cedula: string;
  corregimiento: string;
  vereda: string;
  tecnico: string | null;
  /** Visitas distintas realizadas (Visita 1, 2…). */
  visitas: number;
  /** Ya tiene el PDF del análisis de suelos. */
  suelos: boolean;
}

export interface BitacoraVisita {
  id: string;
  tipo: 'caracterizacion' | 'visita_tecnica';
  /** Número de visita (1 = caracterización); null en visitas del formato antiguo. */
  numero: number | null;
  fecha: string;
  tecnico: string | null;
  /** false = este usuario no puede abrir el formulario (ej. un técnico con la visita de otro). */
  abrible?: boolean;
}

export interface BitacoraActividadHectareas {
  id: string;
  hectareas: number;
  /** Visita que respalda las hectáreas (null = se digitan). */
  respaldadaPorVisita: number | null;
  actas: number;
  observacionesPendientes: number;
  fotos: { antes: number; durante: number; despues: number };
}

export interface Coordenada {
  latitud: number;
  longitud: number;
}

export interface BitacoraFicha {
  beneficiario: {
    item: number;
    nombre: string;
    cedula: string;
    telefono: string | null;
    correo: string | null;
    departamento: string | null;
    municipio: string | null;
    corregimiento: string;
    vereda: string;
    tecnico: string | null;
  };
  predio: { nombre: string | null; area: number | null; calidad: string | null };
  ubicacion: {
    registrada: Coordenada | null;
    gpsVisita1: (Coordenada & { precision: number | null; lugar: string | null }) | null;
  };
  visitas: BitacoraVisita[];
  /** false = no puede abrir el panel de actividad ni el PDF de suelos (técnico con beneficiario ajeno). */
  detalleActividades?: boolean;
  actividades: {
    analisisSuelos: { subido: boolean; nombreArchivo?: string | null; fecha?: string };
    enHectareas: BitacoraActividadHectareas[];
  };
}

export const listarBitacora = async (): Promise<BitacoraResumen[]> => {
  const r = await apiClient.get(`${ENDPOINT}/beneficiarios`);
  return r.data.beneficiarios;
};

export const obtenerFichaBitacora = async (item: number): Promise<BitacoraFicha> => {
  const r = await apiClient.get(`${ENDPOINT}/beneficiarios/${item}`);
  const { beneficiario, predio, ubicacion, visitas, detalleActividades, actividades } = r.data;
  return { beneficiario, predio, ubicacion, visitas, detalleActividades, actividades };
};

/** "Visita 2"; "Visita Técnica" para las del formato antiguo sin número. */
export const etiquetaVisitaBitacora = (v: Pick<BitacoraVisita, 'numero'>): string =>
  v.numero != null ? `Visita ${v.numero}` : 'Visita Técnica';

// ─── Informe general (todos los beneficiarios) ─────────────

export interface BitacoraFilaInforme {
  item: number;
  nombre: string;
  cedula: string;
  corregimiento: string;
  vereda: string;
  tecnico: string | null;
  /** Una entrada por número de visita realizada (con su fecha más reciente). */
  visitas: Array<{ numero: number | null; fecha: string }>;
  suelos: { fecha: string } | null;
  enHectareas: BitacoraActividadHectareas[];
}

export const obtenerInformeGeneral = async (): Promise<BitacoraFilaInforme[]> => {
  const r = await apiClient.get(`${ENDPOINT}/informe-general`, { timeout: 60000 });
  return r.data.beneficiarios;
};
