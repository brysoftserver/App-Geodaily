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
  getOtroFormatoLocalPorId,
  marcarOtroFormatoSincronizadoSiSinCambios,
  OtroFormatoLocal,
} from './database';
import type { Usuario } from '../types';
import { cargarBorradorOtroFormato, listarClavesBorradorOtroFormato } from '../store/OtrosFormatosDraftStore';

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
  // Solo ESTE formato (no todo lo pendiente) y con espera acotada: si ya hay
  // una subida en curso, se pone en la cola detrás de ella; si tarda, el
  // técnico sigue y el formato termina de subir en segundo plano.
  const id = idOtroFormato(tipo, beneficiarioCedula, datos?.instancia);
  if (!guardado) return { guardado, sincronizado: false };
  try {
    const habiaOtraEnCurso = subidasEnCola > 0;
    // Timeout corto: con señal débil no se retiene al técnico; lo pendiente lo sube el auto-sync.
    const tarea = sincronizarOtrosFormatos(10000, [id]);
    const fallaron = habiaOtraEnCurso
      ? await Promise.race([tarea, new Promise<null>((r) => setTimeout(() => r(null), 15000))])
      : await tarea;
    return { guardado, sincronizado: !!fallaron && !fallaron.includes(id) };
  } catch {
    return { guardado, sincronizado: false };
  }
};

// ─── Subida al servidor ─────────────────────────────────────
// · En COLA: nunca corren dos subidas a la vez (la inmediata de "Completar"
//   y la del auto-sync). Antes podían cruzarse y la respuesta de una subida
//   vieja marcaba como subida la versión nueva (con la firma), que ya nunca
//   se enviaba.
// · Una por una: un acta pesada (firmas en base64) con señal débil ya no
//   tumba el lote entero; las demás siguen subiendo.
// · Solo se marca como subida si no cambió mientras se subía (`updated_at`).
// · Viaja el `updated_at` local: el servidor no acepta una versión más vieja
//   que la que ya tiene.

let colaSubidas: Promise<unknown> = Promise.resolve();
let subidasEnCola = 0;

/**
 * Subir al servidor los formatos pendientes (o solo `soloIds`).
 * Devuelve los ids que NO se pudieron subir (mismo contrato que el resto de
 * `sincronizarX()` de SyncContext). Nunca lanza.
 */
export const sincronizarOtrosFormatos = (timeoutMs: number = 30000, soloIds?: string[]): Promise<string[]> => {
  subidasEnCola++;
  const tarea = colaSubidas
    .then(() => subirOtrosFormatosPendientes(timeoutMs, soloIds))
    .catch((err: any): string[] => {
      console.warn('[Sync] Error sincronizando otros formatos:', err?.message);
      return soloIds?.length ? [...soloIds] : ['error'];
    })
    .finally(() => {
      subidasEnCola--;
    });
  colaSubidas = tarea;
  return tarea;
};

const esErrorSinRed = (err: any): boolean =>
  !err?.response && err?.code !== 'ECONNABORTED' && err?.code !== 'ETIMEDOUT' && !/timeout/i.test(String(err?.message || ''));

const subirOtrosFormatosPendientes = async (timeoutMs: number, soloIds?: string[]): Promise<string[]> => {
  const fallaron: string[] = [];
  let pendientes: OtroFormatoLocal[] = await getOtrosFormatosNoSincronizados();
  if (soloIds) pendientes = pendientes.filter((f) => soloIds.includes(f.id));

  if (pendientes.length === 0) {
    await subirPdfsPendientes();
    return fallaron;
  }

  console.log(`[Sync] Subiendo ${pendientes.length} otro(s) formato(s)...`);
  let sinRed = false;

  for (const f of pendientes) {
    // Sin conexión no tiene caso esperar el timeout de cada uno.
    if (sinRed) {
      fallaron.push(f.id);
      continue;
    }
    try {
      const response = await apiClient.post(
        `${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/sync`,
        {
          formatos: [
            {
              id: f.id,
              tipo: f.tipo,
              instancia: f.datos?.instancia || '',
              beneficiario_cedula: f.beneficiario_cedula,
              beneficiario_nombre: f.beneficiario_nombre,
              datos: f.datos,
              completo: f.completo,
              created_at: f.created_at,
              updated_at: f.updated_at,
            },
          ],
        },
        { timeout: timeoutMs }
      );
      if (response.data?.estado !== 'ok') {
        fallaron.push(f.id);
        continue;
      }
      const rechazado = (response.data?.rechazados || []).some(
        (r: { id?: string }) => String(r.id || '') === f.id
      );
      if (rechazado) {
        fallaron.push(f.id);
        console.warn(`[Sync] Formato rechazado por el servidor: ${f.id}`);
        continue;
      }
      if (!(await marcarOtroFormatoSincronizadoSiSinCambios(f.id, f.updated_at))) {
        // Se volvió a guardar mientras subía: queda pendiente con lo nuevo.
        fallaron.push(f.id);
        console.log(`[Sync] ${f.id} cambió mientras subía; queda pendiente para subir la versión nueva`);
      }
    } catch (err: any) {
      fallaron.push(f.id);
      console.warn('[Sync] No se pudo subir el formato', f.id, err?.response?.status || err?.message);
      if (esErrorSinRed(err)) sinRed = true;
    }
  }

  console.log(`[Sync] ${pendientes.length - fallaron.length} otro(s) formato(s) sincronizado(s)`);
  // Los PDF van DESPUÉS de los datos: el servidor necesita el formato para colgarles el archivo.
  if (!sinRed) await subirPdfsPendientes();
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

// ============================================================
// Acta de Entrega: cambios hechos DESPUÉS de completarla
// ============================================================
// Al reabrir un acta completada ("Ver / editar acta") lo que se cambia —p. ej.
// la firma del beneficiario que faltaba— quedaba solo en el borrador del
// teléfono: si el técnico salía sin volver a pulsar "Completar" o "Generar
// PDF", el servidor nunca lo recibía y en el navegador el acta seguía sin
// firma. Ahora esos cambios se republican solos (al salir del acta y, para
// lo que ya quedó atrapado en borradores, en cada sincronización).
// Regla de oro: una firma nunca se reemplaza por vacío.

const TIPO_ACTA = 'acta_entrega_individual' as const;

const esFirmaImagen = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image');
const txt = (v: unknown): string => String(v ?? '').trim();

/** Lo que el técnico dejó pendiente al completar un acta (mismo criterio que la pantalla). */
export const calcularFaltantesActa = (d: Record<string, any>): string[] => {
  const faltantes: string[] = [];
  const actividades = Array.isArray(d.actividades) ? d.actividades : [];
  if (!actividades.some((a: any) => txt(a?.descripcion))) faltantes.push('Actividades entregadas');
  if (!txt(d.predio)) faltantes.push('Predio');
  if (!txt(d.vereda)) faltantes.push('Vereda');
  if (!txt(d.corregimiento)) faltantes.push('Corregimiento');
  if (!esFirmaImagen(d.firmaBeneficiario)) faltantes.push('Firma del beneficiario');
  if (!esFirmaImagen(d.firmaTecnico)) faltantes.push('Firma del contratista (técnico)');
  return faltantes;
};

/**
 * Datos publicables de un acta a partir de lo que hay en pantalla (o en el
 * borrador), sobre la versión ya publicada `base`. Conserva fecha, instancia
 * y actividad de la base; una firma vacía o ilegible toma la de la base.
 */
export const construirDatosActa = (actual: Record<string, any>, base: Record<string, any>): Record<string, any> => {
  const actividadesActuales = Array.isArray(actual.actividades) ? actual.actividades : base.actividades || [];
  const actividades = actividadesActuales
    .filter((a: any) => txt(a?.descripcion))
    .map((a: any) => ({ descripcion: txt(a.descripcion), actividad: txt(a.actividad), cantidad: txt(a.cantidad), unidad: txt(a.unidad) }));
  const firma = (campo: string, vacio: '' | null) =>
    esFirmaImagen(actual[campo]) ? actual[campo] : esFirmaImagen(base[campo]) ? base[campo] : vacio;
  const texto = (campo: string) => (actual[campo] !== undefined && actual[campo] !== null ? txt(actual[campo]) : txt(base[campo]));

  const datos: Record<string, any> = {
    ...base,
    nombre: texto('nombre') || txt(base.nombre),
    cedula: texto('cedula') || txt(base.cedula),
    tipoDocumento: texto('tipoDocumento') || base.tipoDocumento || 'CC',
    corregimiento: texto('corregimiento'),
    vereda: texto('vereda'),
    predio: texto('predio'),
    actividades,
    contratistaNombre: texto('contratistaNombre'),
    contratistaCargo: texto('contratistaCargo'),
    interventoriaNombre: texto('interventoriaNombre'),
    interventoriaCargo: texto('interventoriaCargo'),
    firmaBeneficiario: firma('firmaBeneficiario', ''),
    firmaTecnico: firma('firmaTecnico', ''),
    firmaInterventoria: firma('firmaInterventoria', null),
  };
  // Un acta generada con "Generar PDF" no lleva pendientes; una "completada"
  // con pendientes se recalcula (la firma que faltaba ya no lo está).
  datos.faltantes = Array.isArray(base.faltantes) && base.faltantes.length ? calcularFaltantesActa(datos) : base.faltantes ?? [];
  return datos;
};

const CAMPOS_COMPARABLES_ACTA = [
  'nombre', 'cedula', 'tipoDocumento', 'corregimiento', 'vereda', 'predio', 'actividades',
  'contratistaNombre', 'contratistaCargo', 'interventoriaNombre', 'interventoriaCargo',
  'firmaBeneficiario', 'firmaTecnico', 'firmaInterventoria',
];

const huellaActa = (d: Record<string, any>): string =>
  JSON.stringify(CAMPOS_COMPARABLES_ACTA.map((c) => d?.[c] ?? null));

/**
 * Si lo que hay en pantalla difiere del acta ya completada, la vuelve a
 * publicar (guardado local + subida en segundo plano). Si el acta nunca se
 * completó, no hace nada: sigue siendo un borrador del técnico.
 * `base` = la versión publicada cuando el acta no está en este teléfono
 * (se completó en otro). Nunca lanza.
 */
export const republicarActaSiCambio = async (params: {
  cedula: string;
  instancia: string;
  actual: Record<string, any>;
  base?: Record<string, any> | null;
  user?: Usuario | null;
}): Promise<'publicada' | 'sin_cambios' | 'no_completada' | 'error'> => {
  try {
    const { cedula, instancia, actual, user } = params;
    if (!cedula || !instancia) return 'no_completada';
    const id = idOtroFormato(TIPO_ACTA, cedula, instancia);
    const local = await getOtroFormatoLocalPorId(id);
    const base = local?.completo ? local.datos : params.base;
    if (!base) return 'no_completada';

    const datos = construirDatosActa(actual, { ...base, instancia });
    if (huellaActa(datos) === huellaActa(base)) return 'sin_cambios';

    await saveOtroFormatoLocal({
      tecnico_id: local?.tecnico_id ?? user?.id ?? null,
      tecnico_nombre: local?.tecnico_nombre ?? user?.nombre ?? null,
      tecnico_usuario: local?.tecnico_usuario ?? user?.email ?? null,
      beneficiario_cedula: cedula,
      beneficiario_nombre: local?.beneficiario_nombre || datos.nombre || null,
      tipo: TIPO_ACTA,
      datos,
      completo: true,
    });
    console.log(`[OtrosFormatos] Acta ${id} republicada con los cambios hechos tras completarla`);
    void sincronizarOtrosFormatos(15000, [id]);
    return 'publicada';
  } catch (e) {
    console.warn('[OtrosFormatos] No se pudo republicar el acta:', e);
    return 'error';
  }
};

/** ¿El borrador de esta acta completada tiene cambios que aún no se publicaron? */
export const actaTieneCambiosSinPublicar = async (cedula: string, instancia: string): Promise<boolean> => {
  try {
    const local = await getOtroFormatoLocalPorId(idOtroFormato(TIPO_ACTA, cedula, instancia));
    if (!local?.completo) return false;
    const borrador = await cargarBorradorOtroFormato<Record<string, any>>(TIPO_ACTA, `${cedula}__${instancia}`);
    if (!borrador) return false;
    if (borrador.updated_at && local.updated_at && borrador.updated_at <= local.updated_at) return false;
    return huellaActa(construirDatosActa(borrador.datos, local.datos)) !== huellaActa(local.datos);
  } catch {
    return false;
  }
};

/**
 * Recupera los cambios que quedaron atrapados en borradores de actas ya
 * completadas (firmas hechas al reabrir el acta, antes de este arreglo) y los
 * publica. Solo si el borrador es MÁS NUEVO que lo publicado en este
 * teléfono. No borra ningún borrador. Devuelve cuántas actas republicó.
 */
export const publicarBorradoresDeActasCompletadas = async (): Promise<number> => {
  let publicadas = 0;
  try {
    for (const clave of await listarClavesBorradorOtroFormato(TIPO_ACTA)) {
      const corte = clave.lastIndexOf('__');
      if (corte <= 0) continue;
      const cedula = clave.slice(0, corte);
      const instancia = clave.slice(corte + 2);
      if (!(await actaTieneCambiosSinPublicar(cedula, instancia))) continue;
      const borrador = await cargarBorradorOtroFormato<Record<string, any>>(TIPO_ACTA, clave);
      if (!borrador) continue;
      if ((await republicarActaSiCambio({ cedula, instancia, actual: borrador.datos })) === 'publicada') publicadas++;
    }
  } catch (e) {
    console.warn('[OtrosFormatos] Error recuperando borradores de actas:', e);
  }
  if (publicadas) console.log(`[OtrosFormatos] ${publicadas} acta(s) recuperada(s) desde borradores`);
  return publicadas;
};
