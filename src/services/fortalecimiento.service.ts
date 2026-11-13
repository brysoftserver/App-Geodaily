// ============================================================
// GEODAILY — Fortalecimiento de Capacidades (ECAS)
// ============================================================
// Archivos compartidos por ECA y grupo de veredas. Ver
// backend/src/routes/fortalecimiento.js.
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { SeccionEca } from '../data/fortalecimiento';

const ENDPOINT = API_CONFIG.ENDPOINTS.FORTALECIMIENTO;

export interface ArchivoFortalecimiento {
  id: number;
  nombre: string | null;
  tipo: 'pdf' | 'imagen';
  tamano: number | null;
  subidoPor: string | null;
  fecha: string;
  puedeEliminar: boolean;
}

export interface ArchivosGrupoEca {
  /** Lo decide el servidor según el rol (técnico o admin). */
  puedeSubir: boolean;
  secciones: Record<SeccionEca, ArchivoFortalecimiento[]>;
}

/** Archivos por ECA y grupo: { "1": { "2": 5 } }. */
export const obtenerResumenEcas = async (): Promise<Record<string, Record<string, number>>> => {
  const r = await apiClient.get(`${ENDPOINT}/ecas/resumen`);
  return r.data.conteos ?? {};
};

export const obtenerArchivosGrupoEca = async (eca: number, grupo: number): Promise<ArchivosGrupoEca> => {
  const r = await apiClient.get(`${ENDPOINT}/ecas/${eca}/${grupo}`);
  return { puedeSubir: !!r.data.puedeSubir, secciones: r.data.secciones };
};

export const subirArchivoEca = async (
  eca: number,
  grupo: number,
  seccion: SeccionEca,
  archivo: { uri: string; nombre: string; mimeType?: string }
): Promise<void> => {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // En el navegador FormData solo acepta Blob/File.
    const blob = await (await fetch(archivo.uri)).blob();
    formData.append('archivo', blob, archivo.nombre);
  } else {
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri: archivo.uri, type: archivo.mimeType || 'application/octet-stream', name: archivo.nombre });
  }
  await apiClient.post(`${ENDPOINT}/ecas/${eca}/${grupo}/${seccion}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  });
};

export const eliminarArchivoFortalecimiento = async (id: number): Promise<void> => {
  await apiClient.delete(`${ENDPOINT}/archivo/${id}`);
};

/**
 * Fuente para <Image>: en nativo va con la cabecera Authorization; en web las
 * imágenes no pueden enviar cabeceras, así que el token viaja en la URL.
 */
export const fuenteArchivoFortalecimiento = async (id: number): Promise<{ uri: string; headers?: Record<string, string> }> => {
  const uri = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivo/${id}`;
  const token = await getApiAuthToken();
  if (!token) return { uri };
  return Platform.OS === 'web'
    ? { uri: `${uri}?token=${encodeURIComponent(token)}` }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
};

/**
 * PDF listo para el visor: en nativo se descarga a caché y se devuelve la URI
 * local; en web se devuelve la URL con el token (el navegador lo muestra).
 */
export const descargarPdfFortalecimiento = async (id: number): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivo/${id}`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const destino = `${FileSystem.cacheDirectory}fortalecimiento_${id}_${Date.now()}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  return uri;
};

/**
 * PDF con todo lo del grupo (protocolo, informes, listado de asistencia y
 * fotos), armado por el servidor. En nativo se descarga a caché; en web se
 * devuelve la URL con el token.
 */
export const descargarExpedienteGrupo = async (eca: number, grupo: number): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/ecas/${eca}/${grupo}/expediente`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const destino = `${FileSystem.cacheDirectory}ECA_${eca}_Grupo_${grupo}_${Date.now()}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) {
    let mensaje = `Descarga fallida (${status})`;
    try {
      mensaje = JSON.parse(await FileSystem.readAsStringAsync(uri))?.mensaje || mensaje;
    } catch {}
    await FileSystem.deleteAsync(destino, { idempotent: true });
    throw new Error(mensaje);
  }
  return uri;
};

/**
 * Descarga un archivo con su nombre original para guardarlo o editarlo fuera
 * de la app (la interventoría corrige el PDF y sube la versión nueva).
 * Nativo: lo baja a caché y abre la hoja de compartir (Archivos, Drive…).
 * Web: el navegador lo descarga directamente.
 */
export const descargarArchivoFortalecimiento = async (archivo: ArchivoFortalecimiento): Promise<void> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivo/${archivo.id}`;
  const token = await getApiAuthToken();
  const ext = archivo.tipo === 'pdf' ? '.pdf' : '.jpg';
  const base = (archivo.nombre || `archivo_${archivo.id}`).replace(/\.[^.]*$/, '');
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = `${url}?descargar=1${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    a.download = `${base}${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const seguro = base.replace(/[^\w\-. áéíóúÁÉÍÓÚñÑ]/g, '_').slice(0, 80) || `archivo_${archivo.id}`;
  const carpeta = `${FileSystem.cacheDirectory}descargas_fort_${archivo.id}_${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  const { uri, status } = await FileSystem.downloadAsync(url, `${carpeta}${seguro}${ext}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este dispositivo no permite guardar o compartir archivos.');
  await Sharing.shareAsync(uri, archivo.tipo === 'pdf'
    ? { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Guardar PDF' }
    : { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle: 'Guardar imagen' });
};

// ─── Informe consolidado de una ECA ─────────────────────────
// El servidor lo arma con los informes de los 7 grupos (formato PM. 2 FO. 12)
// y todas las fotos; tarda hasta un par de minutos, así que se pide y se
// consulta el avance. Si ningún archivo cambió, devuelve el último al instante.

export interface ConsolidadoEca {
  id: number;
  eca: number;
  estado: 'generando' | 'listo' | 'error';
  etapa: string | null;
  error: string | null;
  paginas: number | null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pide el consolidado y espera a que esté listo. `onEtapa` recibe el avance. */
export const generarConsolidadoEca = async (
  eca: number,
  onEtapa?: (etapa: string) => void
): Promise<ConsolidadoEca> => {
  const r = await apiClient.post(`${ENDPOINT}/ecas/${eca}/consolidado`, {});
  let c: ConsolidadoEca = r.data.consolidado;
  const limite = Date.now() + 8 * 60 * 1000;
  while (c.estado === 'generando') {
    if (c.etapa) onEtapa?.(c.etapa);
    if (Date.now() > limite) throw new Error('El informe está tardando demasiado. Inténtalo de nuevo en unos minutos.');
    await esperar(3000);
    try {
      c = (await apiClient.get(`${ENDPOINT}/consolidado/${c.id}`)).data.consolidado;
    } catch (e: any) {
      // Un corte de red momentáneo no cancela la espera.
      if (e?.response) throw e;
    }
  }
  if (c.estado === 'error') throw new Error(c.error || 'No se pudo generar el informe consolidado.');
  return c;
};

/**
 * PDF del consolidado listo para el visor: en nativo se descarga a caché; en
 * web se devuelve la URL con el token.
 */
export const descargarConsolidadoEca = async (c: ConsolidadoEca): Promise<string> => {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/consolidado/${c.id}/pdf`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const destino = `${FileSystem.cacheDirectory}Consolidado_ECA_${c.eca}_${c.id}.pdf`;
  const info = await FileSystem.getInfoAsync(destino);
  if (info.exists && (info.size ?? 0) > 0) return destino;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) {
    await FileSystem.deleteAsync(destino, { idempotent: true });
    throw new Error(`Descarga fallida (${status})`);
  }
  return uri;
};
