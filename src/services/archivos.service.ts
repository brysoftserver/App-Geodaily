// ============================================================
// GEODAILY — Servicio de Evidencias remotas (MinIO vía API)
// ============================================================
// Las fotos y videos se guardan en el formulario con la ruta LOCAL del
// teléfono que los capturó (file:///data/user/0/...). Al abrir ese
// formulario desde otro dispositivo esa ruta no existe.
//
// Este servicio recupera las evidencias desde el servidor para que la
// visita se pueda revisar completa desde cualquier teléfono.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { FotoGeotag } from '../types';

export interface ArchivoRemoto {
  id: string;
  tipo: 'foto' | 'video' | 'firma' | 'pdf' | string;
  filename: string;
  mimetype: string;
  latitud: number | null;
  longitud: number | null;
  created_at: string;
  /** Ruta relativa en la API, p.ej. /api/archivos/<id>/contenido */
  url: string;
  /** Solo presente en tipo 'firma': distingue beneficiario/técnico. */
  tipo_firma?: 'beneficiario' | 'tecnico' | null;
}

/** Firma lista para usar en <Image>: URI + cabeceras de autenticación si aplica */
export interface FirmaResuelta {
  uri: string;
  headers: Record<string, string>;
}

/** URL absoluta para descargar una evidencia */
export const urlDeArchivo = (archivo: ArchivoRemoto): string =>
  `${API_CONFIG.BASE_URL}${archivo.url}`;

/**
 * Cabeceras necesarias para que <Image> y <VideoView> puedan descargar
 * la evidencia (hacen la petición fuera de axios, sin el interceptor).
 */
export const cabecerasDeArchivo = async (): Promise<Record<string, string>> => {
  const token = await getApiAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Evidencias que el servidor tiene asociadas a un formulario */
export const fetchArchivosDeFormulario = async (
  formularioId: string
): Promise<ArchivoRemoto[]> => {
  try {
    const response = await apiClient.get(
      `${API_CONFIG.ENDPOINTS.ARCHIVOS}/formulario/${encodeURIComponent(formularioId)}`,
      { timeout: 15000 }
    );
    if (response.data?.estado === 'ok' && Array.isArray(response.data?.archivos)) {
      return response.data.archivos as ArchivoRemoto[];
    }
    return [];
  } catch (error) {
    const err = error as any;
    if (err?.isOffline) {
      console.warn('[Archivos] Sin conexión — no se pueden traer evidencias remotas');
    } else {
      console.warn('[Archivos] Error obteniendo evidencias:', err?.message || error);
    }
    return [];
  }
};

/** ¿El archivo local sigue existiendo en este dispositivo? */
const existeLocalmente = async (uri?: string): Promise<boolean> => {
  if (!uri) return false;
  // Las URIs http(s) y data: no son archivos locales: se asumen válidas
  if (!uri.startsWith('file://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
};

/**
 * 'tipo' no siempre viene informado — formularios sincronizados antes de
 * este fix quedaron con ese campo ausente en el servidor (ver nota en
 * SyncContext.tsx). La extensión del archivo es una señal de respaldo
 * fiable: nunca cambia aunque falte el campo.
 */
const inferirTipo = (uri: string, tipoOriginal?: string): 'foto' | 'video' => {
  if (tipoOriginal === 'video' || tipoOriginal === 'foto') return tipoOriginal;
  const limpia = uri.toLowerCase().split('?')[0];
  const esVideo = ['.mp4', '.mov', '.avi', '.mkv', '.3gp'].some((ext) => limpia.endsWith(ext));
  return esVideo ? 'video' : 'foto';
};

/**
 * Devuelve las evidencias de un formulario listas para mostrar.
 *
 * Si TODOS los archivos locales existen (el mismo teléfono que capturó la
 * visita) se usan tal cual — funciona sin conexión. Si falta AUNQUE SEA
 * UNO, se reconstruye la lista completa desde el servidor: antes bastaba
 * con que UNA sola evidencia existiera localmente para usar las demás tal
 * cual, aunque no existieran en este dispositivo — eso hacía que, desde un
 * teléfono distinto al que capturó la visita, se intentaran cargar rutas
 * file:// que nunca existieron ahí (miniaturas en blanco).
 *
 * @returns `null` si no hizo falta sustituir nada (usar `form.fotos`)
 */
export const resolverEvidenciasRemotas = async (
  formularioId: string,
  fotos: FotoGeotag[] | undefined
): Promise<FotoGeotag[] | null> => {
  const lista = fotos || [];

  if (lista.length > 0) {
    const disponibles = await Promise.all(lista.map((f) => existeLocalmente(f.uri)));
    if (disponibles.every(Boolean)) {
      // Todo existe en este dispositivo — es el teléfono original. Se
      // normaliza 'tipo' por si el formulario se sincronizó antes del fix.
      return lista.map((f) => ({ ...f, tipo: inferirTipo(f.uri, f.tipo) }));
    }
  }

  const remotos = await fetchArchivosDeFormulario(formularioId);
  // Firmas y PDFs se muestran aparte; aquí solo fotos y videos
  const evidencias = remotos.filter((a) => a.tipo === 'foto' || a.tipo === 'video');
  if (evidencias.length === 0) return null;

  console.log(
    `[Archivos] ${evidencias.length} evidencia(s) recuperadas del servidor para ${formularioId}`
  );

  return evidencias.map((a) => ({
    id: a.id,
    uri: urlDeArchivo(a),
    tipo: a.tipo === 'video' ? 'video' : 'foto',
    timestamp: a.created_at,
    coordenadas: {
      latitud: a.latitud ?? 0,
      longitud: a.longitud ?? 0,
    },
  })) as FotoGeotag[];
};

/** ¿El valor ya es directamente usable como <Image source={{uri}}>? */
const esUriDirectamenteUsable = (v?: string): boolean =>
  !!v && (v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://'));

/**
 * Resuelve las firmas de beneficiario/técnico para mostrarlas en pantalla o
 * en el PDF. Recién completado el formulario, `firma_beneficiario`/
 * `firma_tecnico` son base64 (data URI) y se usan tal cual. Tras sincronizar,
 * el backend las reemplaza por la ruta INTERNA de MinIO (no es data: ni
 * http) — en ese caso hay que buscarlas en `archivos` (donde quedan
 * registradas desde el fix de firmas) y servirlas con el token de auth,
 * igual que fotos y documentos.
 */
export const resolverFirmasRemotas = async (
  formularioId: string,
  firmaBeneficiario?: string,
  firmaTecnico?: string
): Promise<{ beneficiario: FirmaResuelta | null; tecnico: FirmaResuelta | null }> => {
  const directoBenef = esUriDirectamenteUsable(firmaBeneficiario);
  const directoTec = esUriDirectamenteUsable(firmaTecnico);

  const resultado: { beneficiario: FirmaResuelta | null; tecnico: FirmaResuelta | null } = {
    beneficiario: directoBenef ? { uri: firmaBeneficiario!, headers: {} } : null,
    tecnico: directoTec ? { uri: firmaTecnico!, headers: {} } : null,
  };

  const faltaBenef = firmaBeneficiario && !directoBenef;
  const faltaTec = firmaTecnico && !directoTec;
  if (!faltaBenef && !faltaTec) return resultado;

  const remotos = await fetchArchivosDeFormulario(formularioId);
  const firmas = remotos.filter((a) => a.tipo === 'firma');
  if (firmas.length === 0) return resultado;

  const headers = await cabecerasDeArchivo();
  const masReciente = (tipoFirma: 'beneficiario' | 'tecnico'): ArchivoRemoto | undefined =>
    firmas
      .filter((f) => f.tipo_firma === tipoFirma)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  if (faltaBenef) {
    const encontrada = masReciente('beneficiario');
    if (encontrada) resultado.beneficiario = { uri: urlDeArchivo(encontrada), headers };
  }
  if (faltaTec) {
    const encontrada = masReciente('tecnico');
    if (encontrada) resultado.tecnico = { uri: urlDeArchivo(encontrada), headers };
  }

  return resultado;
};
