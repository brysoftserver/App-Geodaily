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

import { Platform } from 'react-native';
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
  /**
   * Marca de tiempo de la última modificación del binario en el servidor.
   * Se usa como cache-buster (`?v=`) para que <Image> re-descargue la foto
   * cuando se re-sube (p. ej. re-estampado de marca de agua). Si el backend
   * no la envía, se cae a `created_at`.
   */
  updated_at?: string;
  /** Ruta relativa en la API, p.ej. /api/archivos/<id>/contenido */
  url: string;
  /** Solo presente en tipo 'firma': distingue beneficiario/técnico. */
  tipo_firma?: 'beneficiario' | 'tecnico' | null;
  /**
   * Id generado en el celular al capturar la evidencia. Es el mismo id que
   * llevan las fotos del formulario (`formulario.fotos[].id`), así que sirve
   * para reconocer si esa evidencia ya fue eliminada en el servidor.
   */
  evidencia_local_id?: string | null;
}

/** Evidencia eliminada individualmente (tumba en el servidor) */
export interface EvidenciaEliminada {
  archivo_id: number | null;
  evidencia_local_id: string | null;
}

interface PayloadArchivos {
  archivos: ArchivoRemoto[];
  eliminadas: EvidenciaEliminada[];
}

/**
 * Roles que pueden eliminar una evidencia desde el detalle del formulario.
 * Debe coincidir con ROLES_PUEDEN_ELIMINAR_EVIDENCIA en backend/src/routes/archivos.js
 */
export const ROLES_PUEDEN_ELIMINAR_EVIDENCIA: string[] = ['admin', 'coordinador'];

/** Firma lista para usar en <Image>: URI + cabeceras de autenticación si aplica */
export interface FirmaResuelta {
  uri: string;
  headers: Record<string, string>;
}

/** URL absoluta para descargar una evidencia */
export const urlDeArchivo = (archivo: ArchivoRemoto): string => {
  const base = `${API_CONFIG.BASE_URL}${archivo.url}`;
  // Cache-buster: la URI de una evidencia es siempre la misma
  // (/api/archivos/<id>/contenido), así que React Native <Image> y
  // FileSystem.downloadAsync la cachean por URI e ignoran el ETag. Al
  // agregar `?v=<updated_at>` la URI cambia cuando el binario se re-sube
  // (p. ej. re-estampado de marca de agua) y el cliente re-descarga.
  const version = archivo.updated_at || archivo.created_at;
  if (!version) return base;
  const separador = base.includes('?') ? '&' : '?';
  return `${base}${separador}v=${encodeURIComponent(version)}`;
};

/**
 * Cabeceras necesarias para que <Image> y <VideoView> puedan descargar
 * la evidencia (hacen la petición fuera de axios, sin el interceptor).
 */
export const cabecerasDeArchivo = async (): Promise<Record<string, string>> => {
  const token = await getApiAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Fuente lista para <Image>/<VideoView> a partir de una URL de la API y las
 * cabeceras de `cabecerasDeArchivo()`.
 *
 * En nativo (iOS/Android), <Image>/<VideoView> usan networking nativo y sí
 * pueden adjuntar la cabecera Authorization. En web (react-native-web), esas
 * mismas etiquetas se convierten en <img>/<video> del navegador, que NO
 * pueden enviar cabeceras personalizadas — la petición llegaba sin token y
 * el archivo no cargaba (foto/firma/video en blanco). Por eso en web el
 * token se manda como query param en vez de cabecera; el backend acepta
 * ambas formas en /api/archivos/:id/contenido.
 */
export const fuenteConAuth = (
  uri: string,
  headers: Record<string, string>
): { uri: string; headers: Record<string, string> } => {
  if (!uri.startsWith('http')) return { uri, headers: {} };
  if (Platform.OS !== 'web') return { uri, headers };
  const token = headers.Authorization?.replace('Bearer ', '');
  if (!token) return { uri, headers: {} };
  const separador = uri.includes('?') ? '&' : '?';
  return { uri: `${uri}${separador}token=${encodeURIComponent(token)}`, headers: {} };
};

/** Evidencias que el servidor tiene asociadas a un formulario */
export const fetchArchivosDeFormulario = async (
  formularioId: string
): Promise<ArchivoRemoto[]> => {
  const payload = await fetchPayloadArchivos(formularioId);
  return payload.archivos;
};

/**
 * Lista de archivos + tumbas de evidencias borradas individualmente.
 * Se pide en una sola llamada: el backend ya devuelve ambas cosas en
 * GET /api/archivos/formulario/:id (ver `eliminadas` en archivos.js).
 */
const fetchPayloadArchivos = async (formularioId: string): Promise<PayloadArchivos> => {
  const vacio: PayloadArchivos = { archivos: [], eliminadas: [] };
  try {
    const response = await apiClient.get(
      `${API_CONFIG.ENDPOINTS.ARCHIVOS}/formulario/${encodeURIComponent(formularioId)}`,
      { timeout: 15000 }
    );
    if (response.data?.estado === 'ok') {
      return {
        archivos: Array.isArray(response.data?.archivos)
          ? (response.data.archivos as ArchivoRemoto[])
          : [],
        eliminadas: Array.isArray(response.data?.eliminadas)
          ? (response.data.eliminadas as EvidenciaEliminada[])
          : [],
      };
    }
    return vacio;
  } catch (error) {
    const err = error as { isOffline?: boolean; message?: string };
    if (err?.isOffline) {
      console.warn('[Archivos] Sin conexión — no se pueden traer evidencias remotas');
    } else {
      console.warn('[Archivos] Error obteniendo evidencias:', err?.message || error);
    }
    return vacio;
  }
};

/**
 * ¿Esta evidencia ya fue eliminada en el servidor?
 *
 * El DELETE /api/archivos/:id deja una "tumba" (tabla `evidencias_eliminadas`)
 * para que un dispositivo que conserva la foto en local deje de mostrarla.
 */
const estaEliminada = (
  eliminadas: EvidenciaEliminada[],
  archivo: Pick<ArchivoRemoto, 'id' | 'evidencia_local_id'>
): boolean =>
  eliminadas.some((e) => {
    if (e.archivo_id !== null && e.archivo_id !== undefined && String(e.archivo_id) === String(archivo.id)) {
      return true;
    }
    if (e.evidencia_local_id && archivo.evidencia_local_id === e.evidencia_local_id) {
      return true;
    }
    return false;
  });

/**
 * Elimina una evidencia (foto o video) en el servidor.
 *
 * Solo admin y coordinador (ver ROLES_PUEDEN_ELIMINAR_EVIDENCIA). El backend
 * borra el objeto de MinIO, la fila de `archivos`, la entrada del fotos_json
 * del formulario y deja la tumba anti-resurrección.
 *
 * @returns true si el servidor confirmó el borrado
 */
export const eliminarEvidenciaRemota = async (
  archivoId: string | number
): Promise<boolean> => {
  try {
    const response = await apiClient.delete(
      `${API_CONFIG.ENDPOINTS.ARCHIVOS}/${encodeURIComponent(String(archivoId))}`,
      { timeout: 20000 }
    );
    return response.data?.estado === 'ok';
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { mensaje?: string } }; message?: string };
    // 404 = ya no existe en el servidor: se considera borrado.
    if (err?.response?.status === 404) return true;
    console.error(
      '[Archivos] Error eliminando evidencia:',
      err?.response?.data?.mensaje || err?.message || error
    );
    return false;
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
 * Se combinan SIEMPRE las dos fuentes:
 *
 *  1. Las de `formulario.fotos` — las que TODAVÍA EXISTEN en este
 *     dispositivo se usan tal cual, sin descargar nada: es lo que permite ver
 *     las fotos sin conexión. Las que ya no están en disco se descartan en
 *     vez de mostrarse rotas (antes se descartaba la lista entera si faltaba
 *     UNA sola, y se reconstruía desde el servidor: desde un teléfono
 *     distinto al que capturó la visita se intentaban cargar rutas file://
 *     que nunca existieron ahí — miniaturas en blanco).
 *  2. Las del servidor (`GET /api/archivos/formulario/:id`).
 *
 * Antes la fuente 1 CORTOCIRCUITABA a la 2. Eso dejaba invisible cualquier
 * evidencia agregada DESPUÉS de guardarse el formulario: `formulario.fotos`
 * es una foto fija del momento en que se guardó y no conoce las capturas del
 * botón «＋ Agregar» del detalle (modo "evidencia dirigida"), así que una foto
 * recién tomada sobre una visita ya completada desaparecía de la pantalla en
 * cuanto se subía al servidor. Ahora se unen (sin duplicar) para que el
 * usuario pueda comprobar que la foto quedó guardada, con o sin conexión.
 *
 * @returns `null` si no hizo falta sustituir nada (usar `form.fotos`)
 */
export const resolverEvidenciasRemotas = async (
  formularioId: string,
  fotos: FotoGeotag[] | undefined
): Promise<FotoGeotag[] | null> => {
  const lista = fotos || [];

  // ¿Qué evidencias del formulario siguen existiendo en ESTE dispositivo?
  // (`existeLocalmente` devuelve true para http/data:, que no son archivos).
  const disponibles = await Promise.all(lista.map((f) => existeLocalmente(f.uri)));

  const remotos = await fetchPayloadArchivos(formularioId);

  const fueEliminadaEnServidor = (id: string) =>
    remotos.eliminadas.some((e) => e.evidencia_local_id && String(e.evidencia_local_id) === String(id));

  // Las locales: solo las que existen en disco (si falta el archivo no se
  // puede mostrar) y que no hayan sido borradas desde el detalle en el
  // servidor — la copia local seguiría ahí y no debe reaparecer.
  const localesVigentes = lista
    .filter((f, i) => disponibles[i] && !fueEliminadaEnServidor(f.id))
    .map((f) => ({ ...f, tipo: inferirTipo(f.uri, f.tipo) }));

  // Solo se descarta una evidencia del servidor si YA se está mostrando la
  // copia local (archivo presente en este teléfono). Si el archivo local
  // falta —visita abierta desde otro teléfono— la del servidor es la única
  // forma de verla.
  const idsVigentes = new Set(localesVigentes.map((f) => String(f.id)));

  // Firmas y PDFs se muestran aparte; aquí solo fotos y videos. Se descartan
  // las que ya están en la lista local (por id de `archivos` o por
  // `evidencia_local_id`, que es el id que generó el celular al capturar).
  const evidencias = remotos.archivos.filter(
    (a) =>
      (a.tipo === 'foto' || a.tipo === 'video') &&
      !estaEliminada(remotos.eliminadas, a) &&
      !idsVigentes.has(String(a.id)) &&
      !(a.evidencia_local_id && idsVigentes.has(String(a.evidencia_local_id)))
  );

  if (evidencias.length === 0) {
    // Sin conexión, formulario aún no sincronizado o sin archivos en el
    // servidor: la lista del formulario (o null si tampoco hay ninguna).
    if (lista.length === 0) return null;
    return localesVigentes.length > 0 ? localesVigentes : null;
  }

  console.log(
    `[Archivos] ${evidencias.length} evidencia(s) recuperadas del servidor para ${formularioId}`
  );

  const delServidor = evidencias.map((a) => ({
    id: a.id,
    uri: urlDeArchivo(a),
    tipo: a.tipo === 'video' ? 'video' : 'foto',
    timestamp: a.created_at,
    coordenadas: {
      latitud: a.latitud ?? 0,
      longitud: a.longitud ?? 0,
    },
  })) as FotoGeotag[];

  // Las locales van primero: se muestran al instante, sin descargar nada.
  return [...localesVigentes, ...delServidor];
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
    if (encontrada) resultado.beneficiario = fuenteConAuth(urlDeArchivo(encontrada), headers);
  }
  if (faltaTec) {
    const encontrada = masReciente('tecnico');
    if (encontrada) resultado.tecnico = fuenteConAuth(urlDeArchivo(encontrada), headers);
  }

  return resultado;
};
