// ============================================================
// GEODAILY — Servicio del Explorador de Anexos (MinIO)
// ============================================================
// Espacio de archivos libre por usuario, tipo "explorador de Windows".
// Los técnicos gestionan su propio espacio (crear/renombrar/eliminar
// carpetas, subir cualquier archivo). Los roles superiores solo revisan
// (lectura + descarga) los anexos de los técnicos.
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import apiClient, { isOfflineError, getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.ANEXOS;

/** Elemento (carpeta o archivo) del explorador de anexos */
export interface AnexoItem {
  nombre: string;
  esCarpeta: boolean;
  tamaño: number;
  modificado: string | null;
}

/** Técnico entre los que un rol superior puede elegir para revisar */
export interface AnexoTecnico {
  usuario: string;
  nombre: string;
  cedula?: string;
}

/** Archivo local listo para subir */
export interface AnexoParaSubir {
  uri: string;
  nombre: string;
  mimeType?: string;
}

/**
 * Lista las carpetas y archivos de una ruta del explorador.
 * @param path ruta relativa ('' = raíz)
 * @param tecnico solo para roles superiores: usuario del técnico a revisar
 */
export const listarAnexos = async (
  path = '',
  tecnico?: string
): Promise<AnexoItem[]> => {
  try {
    const response = await apiClient.get(`${ENDPOINT}/listar`, {
      params: { path, ...(tecnico ? { tecnico } : {}) },
      timeout: 20000,
    });
    if (response.data?.estado === 'ok' && Array.isArray(response.data?.elementos)) {
      return response.data.elementos as AnexoItem[];
    }
    return [];
  } catch (error) {
    const err = error as any;
    if (isOfflineError(err)) {
      console.warn('[Anexos] Sin conexión — no se puede listar');
    } else {
      console.warn('[Anexos] Error al listar:', err?.response?.data?.mensaje || err?.message || error);
    }
    throw error;
  }
};

/** Técnicos activos para que un rol superior revise sus anexos. */
export const listarTecnicosAnexos = async (): Promise<AnexoTecnico[]> => {
  try {
    const response = await apiClient.get(`${ENDPOINT}/tecnicos`, { timeout: 15000 });
    if (response.data?.estado === 'ok' && Array.isArray(response.data?.tecnicos)) {
      return response.data.tecnicos as AnexoTecnico[];
    }
    return [];
  } catch (error) {
    console.warn('[Anexos] Error al listar técnicos:', (error as any)?.message || error);
    return [];
  }
};

/** Crea una carpeta en la ruta indicada. */
export const crearCarpetaAnexo = async (path: string, nombre: string): Promise<boolean> => {
  try {
    const response = await apiClient.post(
      `${ENDPOINT}/carpeta`,
      { path, nombre },
      { timeout: 20000 }
    );
    return response.data?.estado === 'ok';
  } catch (error) {
    console.error('[Anexos] Error al crear carpeta:', (error as any)?.response?.data?.mensaje || error);
    return false;
  }
};

/** Sube uno o varios archivos a la ruta indicada. */
export const subirAnexos = async (
  path: string,
  archivos: AnexoParaSubir[]
): Promise<{ ok: boolean; subidos: number }> => {
  try {
    const formData = new FormData();
    for (const archivo of archivos) {
      // @ts-expect-error — React Native FormData
      formData.append('archivos', {
        uri: archivo.uri,
        type: archivo.mimeType || 'application/octet-stream',
        name: archivo.nombre,
      });
    }
    formData.append('path', path);

    const response = await apiClient.post(`${ENDPOINT}/subir`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Cada archivo puede pesar hasta 50 MB; se da margen amplio.
      timeout: 180000,
    });
    return {
      ok: response.data?.estado === 'ok',
      subidos: response.data?.archivos?.length || 0,
    };
  } catch (error) {
    const err = error as any;
    if (isOfflineError(err)) {
      console.warn('[Anexos] Sin conexión — no se pudieron subir los archivos');
    } else {
      console.error('[Anexos] Error al subir:', err?.response?.data?.mensaje || err?.message || error);
    }
    return { ok: false, subidos: 0 };
  }
};

/** Renombra un archivo o carpeta. */
export const renombrarAnexo = async (path: string, nuevoNombre: string): Promise<boolean> => {
  try {
    const response = await apiClient.post(
      `${ENDPOINT}/renombrar`,
      { path, nuevoNombre },
      { timeout: 30000 }
    );
    return response.data?.estado === 'ok';
  } catch (error) {
    console.error('[Anexos] Error al renombrar:', (error as any)?.response?.data?.mensaje || error);
    return false;
  }
};

/** Elimina un archivo o carpeta (recursiva). */
export const eliminarAnexo = async (path: string): Promise<boolean> => {
  try {
    const response = await apiClient.delete(ENDPOINT, {
      params: { path },
      timeout: 60000,
    });
    return response.data?.estado === 'ok';
  } catch (error) {
    console.error('[Anexos] Error al eliminar:', (error as any)?.response?.data?.mensaje || error);
    return false;
  }
};

/** URL absoluta para descargar/visualizar un anexo. */
export const urlDescargaAnexo = (path: string, tecnico?: string): string => {
  // Se arma la query a mano: URLSearchParams no está garantizado en Hermes.
  let query = `path=${encodeURIComponent(path)}`;
  if (tecnico) query += `&tecnico=${encodeURIComponent(tecnico)}`;
  return `${API_CONFIG.BASE_URL}${ENDPOINT}/descargar?${query}`;
};

/** Tipos de anexo que la app puede previsualizar por sí misma. */
export type TipoAnexo = 'imagen' | 'video' | 'otro';

const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif'];
const EXTENSIONES_VIDEO = ['mp4', 'mov', 'm4v', 'webm', '3gp', 'avi', 'mkv'];

/** Extensión en minúsculas de un nombre de archivo ('' si no tiene). */
const extensionDe = (nombre: string): string => {
  const partes = String(nombre).toLowerCase().split('.');
  return partes.length > 1 ? partes.pop()! : '';
};

/**
 * Determina si un anexo se puede mostrar dentro de la app.
 * Las imágenes y los videos se abren en los visores internos; el resto
 * (PDF, Office, ZIP…) se sigue entregando a apps externas, porque su
 * previsualización dependería de visores que no vienen en la APK.
 */
export const tipoAnexo = (item: AnexoItem): TipoAnexo => {
  if (item.esCarpeta) return 'otro';
  const ext = extensionDe(item.nombre);
  if (EXTENSIONES_IMAGEN.includes(ext)) return 'imagen';
  if (EXTENSIONES_VIDEO.includes(ext)) return 'video';
  return 'otro';
};

/**
 * Cabeceras necesarias para que <Image>/<VideoView> descarguen un anexo de
 * la API (esas etiquetas hacen la petición fuera de axios, así que no pasan
 * por el interceptor que añade el token).
 */
export const cabecerasAnexo = async (): Promise<Record<string, string>> => {
  const token = await getApiAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Abre un anexo con apps externas: en web abre una pestaña nueva con el
 * token como query param (el navegador sí sabe mostrar PDF e imágenes); en
 * nativo lo descarga a caché con la cabecera de auth y delega la apertura al
 * selector de apps del sistema.
 *
 * Se usa como respaldo para los tipos que el visor interno no soporta
 * (PDF, Word, Excel, ZIP…) o cuando el visor falla.
 */
export const abrirAnexoExterno = async (
  item: AnexoItem,
  path: string,
  tecnico?: string
): Promise<void> => {
  const rutaCompleta = path ? `${path}/${item.nombre}` : item.nombre;
  const url = urlDescargaAnexo(rutaCompleta, tecnico);

  if (Platform.OS === 'web') {
    const ventana = window.open('', '_blank');
    try {
      const token = await getApiAuthToken();
      const separador = url.includes('?') ? '&' : '?';
      const urlConToken = token ? `${url}${separador}token=${encodeURIComponent(token)}` : url;
      if (ventana) ventana.location.href = urlConToken;
    } catch (error) {
      console.error('[Anexos] No se pudo abrir en web:', error);
      ventana?.close();
    }
    return;
  }

  const extension = item.nombre.includes('.') ? item.nombre.split('.').pop() : 'dat';
  const destino = `${FileSystem.cacheDirectory}anexo_${Date.now()}.${extension}`;
  const headers = await cabecerasAnexo();
  const { uri } = await FileSystem.downloadAsync(url, destino, { headers });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: undefined });
  }
};

/** Ruta relativa completa de un anexo dentro de su carpeta actual. */
export const rutaCompletaAnexo = (item: AnexoItem, path: string): string =>
  path ? `${path}/${item.nombre}` : item.nombre;

/** Formatea un tamaño en bytes de forma legible. */
export const formatearTamano = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(valor >= 10 || i === 0 ? 0 : 1)} ${unidades[i]}`;
};

/** Devuelve el ícono según el tipo de archivo/carpeta. */
export const iconoDeAnexo = (item: AnexoItem): string => {
  if (item.esCarpeta) return '📁';
  const ext = item.nombre.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'm4a'].includes(ext)) return '🎵';
  if (['kml', 'kmz'].includes(ext)) return '🗺️';
  return '📄';
};
