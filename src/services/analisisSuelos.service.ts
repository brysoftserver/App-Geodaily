// ============================================================
// GEODAILY — Servicio del Análisis de Suelos por predio
// ============================================================
// Un PDF de laboratorio por beneficiario, guardado en el servidor. El técnico
// sube/ve/quita los suyos; los roles superiores consultan todos.
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.ANALISIS_SUELOS;

/** El informe lee varios PDF y llama a la IA: tarda bastante más que un CRUD. */
const TIMEOUT_INFORME_MS = 120000;

export interface BeneficiarioSuelos {
  item: number;
  nombre: string;
  cedula: string;
  corregimiento: string;
  vereda: string;
  tieneArchivo: boolean;
  nombreArchivo: string | null;
  /** Visita 1 (caracterización) del beneficiario; null si aún no la hace. */
  formularioId: string | null;
  /** Texto de la IA sobre el resultado de laboratorio (solo en el informe). */
  resultado?: string | null;
}

export interface TecnicoResumenSuelos {
  usuario: string;
  nombre: string;
  asignados: number;
  subidos: number;
}

export interface ResumenSuelos {
  meta: number;
  total: number;
  tecnicos: TecnicoResumenSuelos[];
}

export interface InformeSuelosTecnico {
  alcance: 'tecnico';
  tecnico: { usuario: string; nombre: string };
  meta: number;
  asignados: number;
  subidos: number;
  analisis: string | null;
  /** PDF que quedaron sin leer por el límite de la IA por informe. */
  sinLeer?: number;
  beneficiarios: BeneficiarioSuelos[];
}

export interface InformeSuelosTecnicos extends ResumenSuelos {
  alcance: 'tecnicos';
  analisis: string | null;
}

export const listarMisBeneficiariosSuelos = async (): Promise<BeneficiarioSuelos[]> => {
  const r = await apiClient.get(`${ENDPOINT}/mis-beneficiarios`);
  return r.data.beneficiarios;
};

export const obtenerResumenSuelos = async (): Promise<ResumenSuelos> => {
  const r = await apiClient.get(`${ENDPOINT}/resumen`);
  return { meta: r.data.meta, total: r.data.total, tecnicos: r.data.tecnicos };
};

export const listarBeneficiariosSuelosDeTecnico = async (usuario: string): Promise<BeneficiarioSuelos[]> => {
  const r = await apiClient.get(`${ENDPOINT}/tecnico/${encodeURIComponent(usuario)}`);
  return r.data.beneficiarios;
};

export const subirPdfSuelos = async (
  item: number,
  archivo: { uri: string; nombre: string; mimeType?: string }
): Promise<void> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // En el navegador FormData solo acepta Blob/File: el objeto {uri,type,name}
    // de React Native se enviaría como texto "[object Object]".
    const blob = await (await fetch(archivo.uri)).blob();
    formData.append('archivo', blob, archivo.nombre);
  } else {
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri: archivo.uri, type: archivo.mimeType || 'application/pdf', name: archivo.nombre });
  }
  await apiClient.post(`${ENDPOINT}/${item}/pdf`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
};

export const quitarPdfSuelos = async (item: number): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/${item}/pdf`);
};

/**
 * Descarga el PDF a caché y devuelve su URI local, listo para el visor
 * interno (PdfViewer). En web no hay sistema de archivos: se devuelve la URL
 * con el token como query param.
 */
export const descargarPdfSuelos = async (item: number): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/${item}/pdf`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  // Con marca de tiempo: la caché del visor no debe servir un PDF reemplazado.
  const destino = `${FileSystem.cacheDirectory}suelos_${item}_${Date.now()}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  return uri;
};

/** Datos + texto de la IA. `tecnico` ausente = informe comparativo (solo roles superiores). */
export const pedirInformeSuelos = async (
  tecnico?: string
): Promise<InformeSuelosTecnico | InformeSuelosTecnicos> => {
  const r = await apiClient.post(`${ENDPOINT}/informe`, tecnico ? { tecnico } : {}, {
    timeout: TIMEOUT_INFORME_MS,
  });
  return r.data;
};

/** Avance global (análisis subidos en todo el proyecto). Lanza si no hay conexión. */
export const obtenerAvanceSuelos = async (): Promise<number> => {
  const r = await apiClient.get(`${ENDPOINT}/avance`);
  return r.data.total;
};
