// ============================================================
// GEODAILY — Servicio del Análisis de Suelos por predio
// ============================================================
// Un PDF de laboratorio por beneficiario, guardado en el servidor. El técnico
// sube/ve/quita los suyos; los roles superiores consultan todos.
// ============================================================

import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { descargarBlobEnNavegador } from '../utils/webDownload';

const ENDPOINT = API_CONFIG.ENDPOINTS.ANALISIS_SUELOS;

/** El informe arma todos los predios y llama a la IA: tarda bastante más que un CRUD. */
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
  /** Técnico asignado (solo en la lista de todos los beneficiarios con análisis). */
  tecnico?: string | null;
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

/** Una variable del laboratorio con la interpretación oficial (ej. pH 4,72 · Muy fuertemente ácido). */
export interface VariableSuelo {
  clave: string;
  etiqueta: string;
  valor: number | null;
  interpretacion: string;
}

/** Datos leídos del PDF del laboratorio (sin IA). */
export interface DatosPredioSuelos {
  formato: 'resumen' | 'laboratorio' | 'desconocido';
  codigo?: string;
  areaHa?: number;
  densidad?: number;
  distancia?: string | null;
  plantas?: number;
  variables?: VariableSuelo[];
  preparacion?: string;
  totalAnioGPlanta?: number;
  nutrientes?: string;
  insumosTexto?: string;
  insumos?: Record<string, number>;
  observaciones?: string;
}

export interface BeneficiarioInformeSuelos extends BeneficiarioSuelos {
  datos: DatosPredioSuelos | null;
  diagnostico: string | null;
  lecturaIa: string | null;
}

export interface EstadisticaVariableSuelos {
  clave: string;
  etiqueta: string;
  n: number;
  promedio: number | null;
  min: number | null;
  max: number | null;
  conteos: Record<string, number>;
}

export interface EstadisticasSuelos {
  predios: number;
  areaHa: number;
  plantas: number;
  requierenEncalado: number;
  variables: EstadisticaVariableSuelos[];
  insumos: Record<string, number>;
}

/** Metadatos del informe guardado en el historial. */
export interface InformeGuardadoMeta {
  id: number;
  creadoEn: string;
  generadoPor: string;
  generadoPorRol: string;
}

/** Informe completo (igual al guardado en el historial). */
export interface InformeSuelos {
  version: number;
  alcance: 'tecnico' | 'tecnicos';
  tecnico: { usuario: string; nombre: string } | null;
  meta: number;
  asignados: number;
  subidos: number;
  tecnicos: TecnicoResumenSuelos[] | null;
  estadisticas: EstadisticasSuelos;
  analisis: string | null;
  sinLeer?: number;
  beneficiarios: BeneficiarioInformeSuelos[];
  informe: InformeGuardadoMeta;
}

/** Fila del historial de informes. */
export interface InformeHistorialSuelos {
  id: number;
  alcance: 'tecnico' | 'tecnicos';
  tecnicoNombre: string | null;
  generadoPor: string;
  generadoPorRol: string;
  beneficiariosConAnalisis: number;
  conIa: boolean;
  creadoEn: string;
}

export const listarMisBeneficiariosSuelos = async (): Promise<BeneficiarioSuelos[]> => {
  const r = await apiClient.get(`${ENDPOINT}/mis-beneficiarios`);
  return r.data.beneficiarios;
};

export const obtenerResumenSuelos = async (): Promise<ResumenSuelos> => {
  const r = await apiClient.get(`${ENDPOINT}/resumen`);
  return { meta: r.data.meta, total: r.data.total, tecnicos: r.data.tecnicos };
};

/** Superiores: TODOS los beneficiarios que ya tienen el análisis subido (sin filtrar por técnico). */
export const listarBeneficiariosConAnalisis = async (): Promise<{ meta: number; beneficiarios: BeneficiarioSuelos[] }> => {
  const r = await apiClient.get(`${ENDPOINT}/con-analisis`);
  return { meta: r.data.meta, beneficiarios: r.data.beneficiarios };
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

/**
 * Descarga el PDF de laboratorio y lo guarda en el dispositivo:
 *  - Web: descarga directa del navegador.
 *  - Android: selector de carpetas (Storage Access Framework) — descarga real.
 *  - iOS: menú de compartir ("Guardar en Archivos").
 * Devuelve false si el usuario canceló el selector.
 */
export const guardarPdfSuelosEnDispositivo = async (item: number, nombreBeneficiario: string): Promise<boolean> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/${item}/pdf`;
  const token = await getApiAuthToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const base = `Estudio_suelos_${String(nombreBeneficiario || item).trim()}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
  const nombreArchivo = `${base}.pdf`;

  if (Platform.OS === 'web') {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(r.status === 404 ? 'No hay PDF cargado.' : `Descarga fallida (${r.status})`);
    descargarBlobEnNavegador(await r.blob(), nombreArchivo);
    return true;
  }

  const enCache = `${FileSystem.cacheDirectory}${base}_${Date.now()}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, enCache, { headers });
  if (status === 404) throw new Error('No hay PDF cargado.');
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);

  if (Platform.OS === 'android') {
    try {
      const permiso = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permiso.granted) return false;
      const destino = await FileSystem.StorageAccessFramework.createFileAsync(permiso.directoryUri, base, 'application/pdf');
      const contenido = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(destino, contenido, { encoding: FileSystem.EncodingType.Base64 });
      Alert.alert('PDF descargado', `El archivo se guardó como ${nombreArchivo}.`);
      return true;
    } catch (error) {
      console.warn('[AnalisisSuelos] No se pudo guardar con el selector de carpetas:', error);
    }
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Guardar PDF de estudio de suelos' });
  } else {
    Alert.alert('PDF descargado', `Archivo guardado en: ${uri}`);
  }
  return true;
};

/**
 * Matriz consolidada de resultados de laboratorio (Excel), solo superiores.
 * Web: devuelve la URL con token para que el navegador la descargue.
 * Nativo: la baja a caché y devuelve la URI local, lista para compartir/abrir.
 */
export const descargarMatrizExcelSuelos = async (): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/matriz-excel`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const destino = `${FileSystem.cacheDirectory}Matriz_resultados_estudio_de_suelos.xlsx`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status === 404) throw new Error('La matriz aún no está disponible.');
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  return uri;
};

/**
 * Genera un informe nuevo (datos de cada predio + análisis global con IA).
 * Queda guardado en el servidor. `tecnico` ausente = todos (solo superiores).
 */
export const pedirInformeSuelos = async (tecnico?: string): Promise<InformeSuelos> => {
  const r = await apiClient.post(`${ENDPOINT}/informe`, tecnico ? { tecnico } : {}, {
    timeout: TIMEOUT_INFORME_MS,
  });
  return r.data;
};

/** Historial de informes generados (técnico: los suyos · superiores: todos). */
export const listarInformesSuelos = async (): Promise<InformeHistorialSuelos[]> => {
  const r = await apiClient.get(`${ENDPOINT}/informes`);
  return r.data.informes;
};

/** Elimina un informe del historial (solo admin). */
export const eliminarInformeSuelos = async (id: number): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/informes/${id}`);
};

/** Un informe del historial, exactamente como se generó. */
export const obtenerInformeSuelos = async (id: number): Promise<InformeSuelos> => {
  const r = await apiClient.get(`${ENDPOINT}/informes/${id}`);
  return r.data;
};

/** Avance global (análisis subidos en todo el proyecto). Lanza si no hay conexión. */
export const obtenerAvanceSuelos = async (): Promise<number> => {
  const r = await apiClient.get(`${ENDPOINT}/avance`);
  return r.data.total;
};
