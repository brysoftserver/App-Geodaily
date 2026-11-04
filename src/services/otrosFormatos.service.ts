// ============================================================
// GEODAILY — Servicio de "Otros Formatos" (sincronización)
// ============================================================
// Acta de Compromiso, Autorizaciones de Imagen, Consentimiento de Datos y
// Evaluación ECA se diligencian en campo, beneficiario por beneficiario.
//
// Hasta ahora solo existían en el dispositivo (AsyncStorage) y el PDF se
// entregaba con el "Compartir" del sistema: coordinación, interventoría,
// gerencia y admin no podían verlos nunca.
//
// Este servicio cierra ese hueco sin romper el offline-first:
//   1. El técnico termina el formato → se guarda SIEMPRE en SQLite.
//   2. Si hay red, se sube enseguida; si no, queda `sincronizado = 0` y el
//      auto-sync (o el botón manual) lo sube al recuperar señal.
//   3. Los roles superiores lo leen desde el servidor y regeneran el PDF con
//      el mismo generador que usó el técnico.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import apiClient from './api';
import { API_CONFIG } from '../theme';
import { buscarActividad } from '../data/actividades';
import { cabecerasDeArchivo } from './archivos.service';
import {
  generarPDFActaCompromiso,
  construirHtmlActaCompromiso,
  generarPDFAutorizacionImagen,
  construirHtmlAutorizacionImagen,
  generarPDFAutorizacionImagenMenor,
  construirHtmlAutorizacionImagenMenor,
  generarPDFConsentimientoDatos,
  construirHtmlConsentimientoDatos,
  generarPDFEvaluacionEca,
  construirHtmlEvaluacionEca,
  generarPDFActaEntregaIndividual,
  construirHtmlActaEntregaIndividual,
} from './pdfLocal.service';
import {
  idOtroFormato,
  saveOtroFormatoLocal,
  getOtrosFormatosLocales,
  getOtrosFormatosNoSincronizados,
  marcarSincronizado,
  OtroFormatoLocal,
} from './database';
import type { Usuario } from '../types';

export type TipoOtroFormatoSync =
  | 'acta_compromiso'
  | 'autorizacion_imagen'
  | 'autorizacion_imagen_menor'
  | 'consentimiento_datos'
  | 'evaluacion_eca'
  | 'acta_entrega_individual';

/** Etiqueta legible de cada formato (para la UI de supervisión). */
export const ETIQUETAS_OTROS_FORMATOS: Record<string, { titulo: string; codigo: string; icono: string }> = {
  acta_compromiso: { titulo: 'Acta de Compromiso', codigo: 'PA. 2 FO. 30', icono: '📝' },
  autorizacion_imagen: { titulo: 'Autorización de Imagen', codigo: 'PA. 2 FO. 32', icono: '📷' },
  autorizacion_imagen_menor: { titulo: 'Autorización de Imagen (Menor)', codigo: 'PA. 2 FO. 33', icono: '🧒' },
  consentimiento_datos: { titulo: 'Consentimiento de Datos', codigo: 'PA. 2 FO. 34', icono: '🔐' },
  evaluacion_eca: { titulo: 'Evaluación ECA', codigo: 'PA. 2 FO. 35', icono: '📊' },
  acta_entrega_individual: { titulo: 'Acta de Entrega y Recibo', codigo: 'PA. 2 FO. 39', icono: '📦' },
};

/** Orden en el que se listan los formatos en la ficha del beneficiario. */
export const ORDEN_OTROS_FORMATOS: TipoOtroFormatoSync[] = [
  'acta_compromiso',
  'autorizacion_imagen',
  'autorizacion_imagen_menor',
  'consentimiento_datos',
  'evaluacion_eca',
  'acta_entrega_individual',
];

export const etiquetaOtroFormato = (tipo: string): { titulo: string; codigo: string; icono: string } =>
  ETIQUETAS_OTROS_FORMATOS[tipo] || { titulo: tipo, codigo: '', icono: '📄' };

/**
 * Registrar un formato diligenciado: guarda local y, si hay red, lo sube.
 *
 * Se llama cuando el técnico pulsa "Generar PDF" — ese paso ya exige firmas y
 * datos completos, así que lo que llega a supervisión nunca es un borrador a
 * medias. Devuelve `true` si quedó sincronizado.
 *
 * NUNCA lanza: si la red falla, el formato queda guardado localmente y
 * pendiente para el próximo sync. Perder el trabajo de campo no es opción.
 */
export const registrarOtroFormato = async (params: {
  tipo: TipoOtroFormatoSync;
  beneficiarioCedula: string;
  beneficiarioNombre?: string | null;
  datos: Record<string, any>;
  user?: Usuario | null;
}): Promise<{ guardado: boolean; sincronizado: boolean }> => {
  const { tipo, beneficiarioCedula, beneficiarioNombre, datos, user } = params;

  if (!beneficiarioCedula) {
    console.warn('[OtrosFormatos] Sin cédula de beneficiario — no se puede registrar el formato');
    return { guardado: false, sincronizado: false };
  }

  let guardado = false;
  try {
    await saveOtroFormatoLocal({
      tecnico_id: user?.id || null,
      tecnico_nombre: user?.nombre || null,
      tecnico_usuario: user?.email || null,
      beneficiario_cedula: beneficiarioCedula,
      beneficiario_nombre: beneficiarioNombre || (datos?.nombre as string) || null,
      tipo,
      datos,
      completo: true,
    });
    guardado = true;
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo guardar localmente:', e);
  }

  // Intento inmediato: si hay red se sube ya; si no, queda pendiente.
  try {
    // Timeout corto: con señal débil no se retiene el PDF; lo pendiente lo sube el auto-sync.
    const fallaron = await sincronizarOtrosFormatos(10000);
    const id = idOtroFormato(tipo, beneficiarioCedula, datos?.instancia);
    return { guardado, sincronizado: !fallaron.includes(id) && guardado };
  } catch {
    return { guardado, sincronizado: false };
  }
};

/**
 * Subir al servidor todos los formatos pendientes.
 * Devuelve los ids que NO se pudieron subir (mismo contrato que el resto de
 * `sincronizarX()` de SyncContext).
 */
export const sincronizarOtrosFormatos = async (timeoutMs: number = 30000): Promise<string[]> => {
  const fallaron: string[] = [];
  let pendientes: OtroFormatoLocal[] = [];

  try {
    pendientes = await getOtrosFormatosNoSincronizados();
    if (pendientes.length === 0) {
      await subirPdfsPendientes();
      return fallaron;
    }

    console.log(`[Sync] Subiendo ${pendientes.length} otro(s) formato(s)...`);

    const response = await apiClient.post(
      `${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/sync`,
      {
        formatos: pendientes.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          instancia: f.datos?.instancia || '',
          beneficiario_cedula: f.beneficiario_cedula,
          beneficiario_nombre: f.beneficiario_nombre,
          datos: f.datos,
          completo: f.completo,
          created_at: f.created_at,
        })),
      },
      { timeout: timeoutMs }
    );

    if (response.data?.estado === 'ok') {
      const rechazados: string[] = (response.data?.rechazados || []).map(
        (r: { id?: string }) => String(r.id || '')
      );
      for (const f of pendientes) {
        if (rechazados.includes(f.id)) {
          fallaron.push(f.id);
          console.warn(`[Sync] Formato rechazado por el servidor: ${f.id}`);
        } else {
          await marcarSincronizado('otros_formatos_locales', f.id);
        }
      }
      console.log(
        `[Sync] ${pendientes.length - fallaron.length} otro(s) formato(s) sincronizado(s)`
      );
      // Los PDF van DESPUÉS de los datos: el servidor necesita el formato para colgarles el archivo.
      await subirPdfsPendientes();
    } else {
      pendientes.forEach((f) => fallaron.push(f.id));
    }
  } catch (err: any) {
    console.warn('[Sync] Error sincronizando otros formatos:', err?.message);
    fallaron.push(...(pendientes.length ? pendientes.map((f) => f.id) : ['error']));
  }

  return fallaron;
};

/**
 * Obtener los "Otros Formatos" de un beneficiario para la ficha de
 * supervisión. Devuelve primero lo que haya en el servidor (es lo que ven
 * coordinación/interventoría/gerencia) y completa con lo local aún pendiente
 * de subir, para que un formato recién hecho no "desaparezca".
 */
export const obtenerOtrosFormatosBeneficiario = async (
  cedula: string
): Promise<OtroFormatoLocal[]> => {
  if (!cedula) return [];

  const locales = await getOtrosFormatosLocales(cedula);
  let remotos: OtroFormatoLocal[] = [];

  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.OTROS_FORMATOS, {
      params: { cedula },
      timeout: 15000,
    });
    if (response.data?.estado === 'ok' && Array.isArray(response.data.formatos)) {
      remotos = response.data.formatos.map((r: Record<string, any>) => ({
        id: r.id,
        tecnico_id: r.tecnico_id || null,
        tecnico_nombre: r.tecnico_nombre || null,
        tecnico_usuario: r.tecnico_usuario || null,
        beneficiario_cedula: r.beneficiario_cedula,
        beneficiario_nombre: r.beneficiario_nombre || null,
        tipo: r.tipo,
        datos: typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos || {},
        completo: r.completo !== false,
        sincronizado: true,
        created_at: r.created_at,
        updated_at: r.updated_at,
        tiene_pdf: r.tiene_pdf === true,
      }));
    }
  } catch (err: any) {
    // Sin red: se devuelve lo local (la supervisión en campo también aplica).
    console.warn('[OtrosFormatos] No se pudo consultar el servidor:', err?.message);
  }

  // Merge por id: el servidor manda; lo local pendiente se agrega si no está
  // arriba. (Por id y no por tipo: el Acta de Entrega puede tener varias.)
  const porId = new Map<string, OtroFormatoLocal>();
  for (const r of remotos) porId.set(r.id, r);
  for (const l of locales) {
    const existente = porId.get(l.id);
    if (!existente) {
      porId.set(l.id, l);
    } else if (!l.sincronizado) {
      // Borrador local más reciente que lo publicado: se prefiere el local.
      porId.set(l.id, { ...l, sincronizado: false, tiene_pdf: existente.tiene_pdf });
    }
  }

  const orden = (t: string) => {
    const k = ORDEN_OTROS_FORMATOS.indexOf(t as TipoOtroFormatoSync);
    return k < 0 ? 99 : k;
  };
  return Array.from(porId.values())
    .filter((f) => f.completo)
    .sort((a, b) => orden(a.tipo) - orden(b.tipo) || (b.updated_at || '').localeCompare(a.updated_at || ''));
};

/**
 * La interventoría firma el Acta de Entrega y Recibo que el técnico ya
 * generó. Necesita red: la firma se guarda en el servidor, que es la fuente
 * de lo que ven los roles superiores. Devuelve los campos a mezclar en `datos`.
 */
export const firmarActaInterventoria = async (params: {
  formatoId: string;
  firma: string;
  nombre: string;
  cargo: string;
}): Promise<Record<string, any>> => {
  const response = await apiClient.post(
    `${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(params.formatoId)}/firma-interventoria`,
    { firma: params.firma, nombre: params.nombre, cargo: params.cargo },
    { timeout: 30000 }
  );
  if (response.data?.estado !== 'ok') {
    throw new Error(response.data?.mensaje || 'No se pudo registrar la firma');
  }
  return response.data.datos || {};
};

// ============================================================
// PDF de cada formato completado — copia local + copia en el servidor
// ============================================================
// El PDF se genera en el dispositivo; antes solo se compartía y se perdía.
// Ahora se conserva una copia local, se sube al servidor cuando hay red
// (cola `PDFS_PENDIENTES`, mismo criterio offline-first que los datos) y la
// app puede volver a abrirlo dentro del visor interno desde el Historial.

const PDFS_PENDIENTES = 'geodaily.otros_formatos.pdfs_pendientes';

const carpetaPdf = (): string => `${FileSystem.documentDirectory}otros_formatos_pdf/`;
const rutaPdfLocal = (id: string): string => `${carpetaPdf()}${id}.pdf`;
const rutaPdfServidor = (id: string): string => `${carpetaPdf()}srv-${id}.pdf`;

const leerPendientes = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(PDFS_PENDIENTES);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
};

const guardarPendientes = async (ids: string[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(PDFS_PENDIENTES, JSON.stringify(Array.from(new Set(ids))));
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo guardar la cola de PDFs:', e);
  }
};

/** Sube un PDF local al servidor. Devuelve true si quedó guardado. */
const subirPdf = async (id: string, uri: string): Promise<boolean> => {
  try {
    const formData = new FormData();
    // @ts-expect-error — React Native FormData
    formData.append('archivo', { uri, type: 'application/pdf', name: `${id}.pdf` });
    const response = await apiClient.post(
      `${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(id)}/pdf`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
    );
    return response.data?.estado === 'ok';
  } catch (err: any) {
    console.warn('[OtrosFormatos] No se pudo subir el PDF:', id, err?.response?.status || err?.message);
    return false;
  }
};

/**
 * Sube los PDF en cola. Solo los de formatos cuyos datos ya están en el
 * servidor (sincronizados): si no, el servidor no tendría a qué colgarlos.
 */
export const subirPdfsPendientes = async (): Promise<void> => {
  const ids = await leerPendientes();
  if (ids.length === 0) return;

  const locales = await getOtrosFormatosLocales();
  const sincronizados = new Set(locales.filter((l) => l.sincronizado).map((l) => l.id));
  const quedan: string[] = [];

  for (const id of ids) {
    const uri = rutaPdfLocal(id);
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!info || !info.exists) continue; // ya no hay nada que subir
    if (!sincronizados.has(id)) {
      quedan.push(id);
      continue;
    }
    if (!(await subirPdf(id, uri))) quedan.push(id);
  }
  await guardarPendientes(quedan);
};

/**
 * Conservar el PDF recién generado: copia local + subida (inmediata si hay
 * red, o en la cola). NUNCA lanza — el PDF ya se le entregó al técnico.
 */
export const adjuntarPdfOtroFormato = async (params: {
  tipo: TipoOtroFormatoSync;
  beneficiarioCedula: string;
  instancia?: string | null;
  pdfUri: string;
}): Promise<void> => {
  try {
    const id = idOtroFormato(params.tipo, params.beneficiarioCedula, params.instancia);
    await FileSystem.makeDirectoryAsync(carpetaPdf(), { intermediates: true }).catch(() => {});
    await FileSystem.copyAsync({ from: params.pdfUri, to: rutaPdfLocal(id) });
    await guardarPendientes([...(await leerPendientes()), id]);
    await subirPdfsPendientes();
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo conservar el PDF:', e);
  }
};

/** PDF ya generado por otro usuario (ej. la interventoría tras firmar): se sube directo. */
export const subirPdfDeFormato = async (formatoId: string, pdfUri: string): Promise<boolean> =>
  subirPdf(formatoId, pdfUri);

/**
 * URI local de un PDF listo para abrir, o null si no hay ninguno y hay que
 * regenerarlo desde los datos. Prioridad: el del servidor (es el vigente,
 * p. ej. ya con la firma de interventoría) y, sin red, la copia local.
 */
export const obtenerPdfOtroFormato = async (formato: OtroFormatoLocal): Promise<string | null> => {
  try {
    await FileSystem.makeDirectoryAsync(carpetaPdf(), { intermediates: true }).catch(() => {});
    if (formato.tiene_pdf && formato.sincronizado) {
      try {
        const destino = rutaPdfServidor(formato.id);
        const res = await FileSystem.downloadAsync(
          `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(formato.id)}/pdf`,
          destino,
          { headers: await cabecerasDeArchivo() }
        );
        if (res.status === 200) return res.uri;
        await FileSystem.deleteAsync(destino, { idempotent: true });
      } catch (e) {
        console.warn('[OtrosFormatos] No se pudo descargar el PDF del servidor:', e);
      }
      // Sin red: lo último que se descargó sirve mejor que nada.
      const previo = await FileSystem.getInfoAsync(rutaPdfServidor(formato.id));
      if (previo.exists) return rutaPdfServidor(formato.id);
    }
    if (!formato.sincronizado || !formato.tiene_pdf) {
      const local = await FileSystem.getInfoAsync(rutaPdfLocal(formato.id));
      if (local.exists) return rutaPdfLocal(formato.id);
    }
  } catch (e) {
    console.warn('[OtrosFormatos] Error resolviendo el PDF:', e);
  }
  return null;
};

/** Genera el PDF de un formato desde sus datos con el mismo generador del técnico. */
export const generarPdfDeFormato = (tipo: string, datos: Record<string, any>): Promise<string | null> => {
  switch (tipo) {
    case 'acta_compromiso':
      return generarPDFActaCompromiso(datos as any);
    case 'autorizacion_imagen':
      return generarPDFAutorizacionImagen(datos as any);
    case 'autorizacion_imagen_menor':
      return generarPDFAutorizacionImagenMenor(datos as any);
    case 'consentimiento_datos':
      return generarPDFConsentimientoDatos(datos as any);
    case 'evaluacion_eca':
      return generarPDFEvaluacionEca(datos as any);
    case 'acta_entrega_individual':
      return generarPDFActaEntregaIndividual(datos as any);
    default:
      return Promise.resolve(null);
  }
};

/** HTML institucional de un formato (impresión en web). */
export const construirHtmlDeFormato = (tipo: string, datos: Record<string, any>): string | null => {
  switch (tipo) {
    case 'acta_compromiso':
      return construirHtmlActaCompromiso(datos as any);
    case 'autorizacion_imagen':
      return construirHtmlAutorizacionImagen(datos as any);
    case 'autorizacion_imagen_menor':
      return construirHtmlAutorizacionImagenMenor(datos as any);
    case 'consentimiento_datos':
      return construirHtmlConsentimientoDatos(datos as any);
    case 'evaluacion_eca':
      return construirHtmlEvaluacionEca(datos as any);
    case 'acta_entrega_individual':
      return construirHtmlActaEntregaIndividual(datos as any);
    default:
      return null;
  }
};

/**
 * PDF listo para ver/compartir de un formato completado: el guardado (servidor
 * o copia local) y, si no hay ninguno, el regenerado desde los datos.
 */
export const resolverPdfFormato = async (formato: OtroFormatoLocal): Promise<string | null> =>
  (await obtenerPdfOtroFormato(formato)) ?? (await generarPdfDeFormato(formato.tipo, formato.datos || {}));

/** Nombre legible de un documento del historial (el Acta de Entrega lleva su fecha y actividad). */
export const tituloDocumentoFormato = (f: OtroFormatoLocal): string => {
  const base = etiquetaOtroFormato(f.tipo).titulo;
  if (f.tipo !== 'acta_entrega_individual') return base;
  const fecha = f.datos?.fecha || f.created_at;
  const dia = fecha
    ? new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  // Las actas hechas dentro de una actividad se rotulan con ella para no confundirlas.
  const actividad = buscarActividad(f.datos?.actividadId)?.nombre;
  const titulo = actividad ? `${base} (${actividad})` : base;
  return dia ? `${titulo} · ${dia}` : titulo;
};

/** Resumen de una línea del contenido (solo Acta de Entrega: qué se entregó). */
export const resumenDocumentoFormato = (f: OtroFormatoLocal): string => {
  if (f.tipo !== 'acta_entrega_individual') return '';
  const acts: Array<{ descripcion?: string }> = Array.isArray(f.datos?.actividades) ? f.datos.actividades : [];
  return acts.map((a) => a.descripcion).filter(Boolean).join(', ');
};

/**
 * Datos de un acta ya completada para volver a editarla: primero la copia
 * local de este dispositivo y, si el acta se hizo en otro, la del servidor.
 */
export const cargarActaExistente = async (cedula: string, instancia: string): Promise<Record<string, any> | null> => {
  const id = idOtroFormato('acta_entrega_individual', cedula, instancia);
  try {
    const local = (await getOtrosFormatosLocales(cedula)).find((f) => f.id === id);
    if (local?.datos) return local.datos;
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo leer el acta local:', e);
  }
  try {
    const r = await apiClient.get(`${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(id)}`);
    const d = r.data.formato?.datos;
    return typeof d === 'string' ? JSON.parse(d) : d || null;
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo leer el acta del servidor:', e);
    return null;
  }
};
