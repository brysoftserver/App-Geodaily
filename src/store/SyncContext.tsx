// ============================================================
// GEODAILY — Contexto de Sincronización Offline→Online
// ============================================================
// Sincroniza formularios locales con el backend cuando hay
// conexión. Flujo completo: subir fotos → guardar formulario
// en PostGIS → generar PDF → marcar como sincronizado.
// Incluye reintentos con backoff progresivo.
// ============================================================

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { SyncStatus, Formulario } from '../types';
import {
  getPendingSyncForms,
  markAsSynced,
  clearSyncQueueByFormId,
  getUnsyncedPhotos,
  markFotoAsSynced,
  getUnsyncedVideos,
  markVideoAsSynced,
  updateSyncAttempts,
  getSyncQueueItemByFormId,
  resetSyncAttempts,
  getPlantacionesNoSincronizadas,
  getMedicionesNoSincronizadas,
  getTrackingNoSincronizado,
  getVisitasProgramadasNoSincronizadas,
  getDocumentosNoSincronizados,
  getEvidenciasPendientes,
  marcarDocumentoSincronizado,
  marcarSincronizado,
  getFormulariosLocales,
  saveFormularioLocal,
} from '../services/database';
import { uploadPhoto } from '../services/photos.service';
import { uploadVideo } from '../services/videos.service';
import { subirDocumento } from '../services/documentos.service';
import { generarPDF } from '../services/pdf.service';
import { limpiarEvidenciasAntiguas } from '../services/mediaStorage.service';
import { resolverClimaYUbicacion } from '../services/climate.service';
import apiClient from '../services/api';
import { API_CONFIG } from '../theme';

// ==================================================================
// Constantes
// ==================================================================

/**
 * Máximo de reintentos por formulario antes de abandonar.
 *
 * Era 3 con backoff lineal de 5/10/15 s: con señal intermitente los tres
 * intentos se consumían en menos de un minuto y el formulario quedaba
 * abandonado hasta que el técnico encontrara el botón de reintento manual.
 * En campo eso es trabajo de un día en riesgo, así que se amplía el margen.
 */
const MAX_RETRIES = 10;

// ==================================================================
// Estado
// ==================================================================

interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSync: string | null;
  error: string | null;
  /** IDs de formularios que fallaron en el último ciclo */
  failedForms: string[];
}

type SyncAction =
  | { type: 'SET_SYNCING' }
  | { type: 'SYNC_SUCCESS'; timestamp: string }
  | { type: 'SYNC_ERROR'; error: string }
  | { type: 'SET_PENDING'; count: number }
  | { type: 'SET_IDLE' }
  | { type: 'SET_FAILED'; ids: string[] };

const initialState: SyncState = {
  status: 'idle',
  pendingCount: 0,
  lastSync: null,
  error: null,
  failedForms: [],
};

// ==================================================================
// Reducer
// ==================================================================

function syncReducer(state: SyncState, action: SyncAction): SyncState {
  switch (action.type) {
    case 'SET_SYNCING':
      return { ...state, status: 'syncing', error: null };
    case 'SYNC_SUCCESS':
      return {
        ...state,
        status: 'completed',
        lastSync: action.timestamp,
        pendingCount: 0,
        error: null,
      };
    case 'SYNC_ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'SET_PENDING':
      return { ...state, pendingCount: action.count };
    case 'SET_IDLE':
      return { ...state, status: 'idle' };
    case 'SET_FAILED':
      return { ...state, failedForms: action.ids };
    default:
      return state;
  }
}

// ==================================================================
// Context
// ==================================================================

interface SyncContextType extends SyncState {
  syncNow: () => Promise<void>;
  checkPending: () => Promise<void>;
  /** Devuelve el tiempo de espera recomendado (segundos) para un formulario */
  getBackoffSeconds: (formId: string) => Promise<number>;
  /** Reintento manual: reinicia el contador de intentos de un formulario y relanza el sync */
  reintentarFormulario: (formId: string) => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

// ==================================================================
// Provider
// ==================================================================

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(syncReducer, initialState);
  const isSyncing = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  /** Último estado de conectividad conocido — para detectar offline→online */
  const wasConnected = useRef<boolean | null>(null);

  // ------------------------------------------------------------------
  // Utilitarios
  // ------------------------------------------------------------------

  /** Backoff exponencial: 5, 10, 20, 40… segundos, con tope de 5 minutos */
  const getBackoffSeconds = useCallback(async (formId: string): Promise<number> => {
    try {
      const item = await getSyncQueueItemByFormId(formId);
      if (!item) return 0;
      const intentos = item.intentos || 0;
      if (intentos === 0) return 0;
      return Math.min(5 * Math.pow(2, intentos - 1), 300);
    } catch {
      return 0;
    }
  }, []);

  // ------------------------------------------------------------------
  // Subir fotos pendientes de un formulario
  // ------------------------------------------------------------------

  const subirFotosPendientes = useCallback(
    async (form: Formulario): Promise<boolean> => {
      try {
        const fotosPendientes = await getUnsyncedPhotos(form.id);
        if (fotosPendientes.length === 0) return true; // sin fotos pendientes

        let todasExitosas = true;

        for (const foto of fotosPendientes) {
          try {
            const resultado = await uploadPhoto(
              foto.uri,
              foto.latitud || form.coordenadas.latitud,
              foto.longitud || form.coordenadas.longitud,
              foto.altitud || form.coordenadas.altitud,
              `Formulario ${form.id}`,
              `Foto de ${form.beneficiario.nombre}`,
              form.beneficiario?.cedula || undefined,
              form.beneficiario?.nombre || undefined,
              foto.timestamp,
              form.tipo,
              form.id,
            );

            if (resultado) {
              await markFotoAsSynced(foto.id, {
                archivoId: resultado.id,
                ruta: resultado.ruta,
              });
              console.log('[Sync] Foto subida:', foto.id, '→', resultado.ruta);
            } else {
              console.warn('[Sync] Foto devolvió null (offline?):', foto.id);
              todasExitosas = false;
            }
          } catch (err) {
            console.warn('[Sync] Error subiendo foto:', foto.id, err);
            todasExitosas = false;
          }
        }

        return todasExitosas;
      } catch (err) {
        console.warn('[Sync] Error obteniendo fotos pendientes:', err);
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Subir videos pendientes de un formulario (videos_locales → /api/videos,
  // carpeta videos/ en MinIO con extensión .mp4 — separados de las fotos)
  // ------------------------------------------------------------------

  const subirVideosPendientes = useCallback(
    async (form: Formulario): Promise<boolean> => {
      try {
        const videosPendientes = await getUnsyncedVideos(form.id);
        if (videosPendientes.length === 0) return true; // sin videos pendientes

        let todasExitosas = true;

        for (const video of videosPendientes) {
          try {
            const resultado = await uploadVideo(
              video.uri,
              video.latitud || form.coordenadas.latitud,
              video.longitud || form.coordenadas.longitud,
              `Formulario ${form.id}`,
              form.beneficiario?.cedula || undefined,
              form.beneficiario?.nombre || undefined,
              form.tipo,
              form.id,
            );

            if (resultado) {
              await markVideoAsSynced(video.id, {
                archivoId: resultado.id,
                ruta: resultado.ruta,
              });
              console.log('[Sync] Video subido:', video.id, '→', resultado.ruta);
            } else {
              console.warn('[Sync] Video devolvió null (offline?):', video.id);
              todasExitosas = false;
            }
          } catch (err) {
            console.warn('[Sync] Error subiendo video:', video.id, err);
            todasExitosas = false;
          }
        }

        return todasExitosas;
      } catch (err) {
        console.warn('[Sync] Error obteniendo videos pendientes:', err);
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Subir evidencias huérfanas
  // ------------------------------------------------------------------
  // Barrido de seguridad: sube las fotos y videos que siguen pendientes
  // aunque su formulario ya esté marcado como sincronizado. Sin esto, una
  // sola foto que fallara quedaba fuera del ciclo para siempre.

  const subirEvidenciasHuerfanas = useCallback(async (): Promise<void> => {
    try {
      const { fotos, videos } = await getEvidenciasPendientes();
      if (fotos.length === 0 && videos.length === 0) return;

      console.log(
        `[Sync] Barrido de evidencias: ${fotos.length} foto(s), ${videos.length} video(s)`,
      );

      for (const foto of fotos) {
        try {
          const r = await uploadPhoto(
            foto.uri,
            foto.latitud ?? undefined,
            foto.longitud ?? undefined,
            foto.altitud ?? undefined,
            `Formulario ${foto.formulario_id}`,
            undefined,
            undefined,
            undefined,
            foto.timestamp,
            undefined,
            foto.formulario_id,
          );
          if (r) {
            await markFotoAsSynced(foto.id, { archivoId: r.id, ruta: r.ruta });
          }
        } catch {
          // se reintenta en el próximo ciclo
        }
      }

      for (const video of videos) {
        try {
          const r = await uploadVideo(
            video.uri,
            video.latitud ?? undefined,
            video.longitud ?? undefined,
            `Formulario ${video.formulario_id}`,
            undefined,
            undefined,
            undefined,
            video.formulario_id,
          );
          if (r) {
            await markVideoAsSynced(video.id, { archivoId: r.id, ruta: r.ruta });
          }
        } catch {
          // se reintenta en el próximo ciclo
        }
      }
    } catch (err) {
      console.warn('[Sync] Error en el barrido de evidencias:', err);
    }
  }, []);

  // ------------------------------------------------------------------
  // Subir documentos de finca pendientes
  // ------------------------------------------------------------------
  // Antes NO existía: los documentos capturados sin señal (el caso normal en
  // campo) se quedaban en SQLite para siempre mientras la app afirmaba
  // "guardado (local + MinIO)". Títulos de predio y cédulas escaneadas que
  // nunca salían del teléfono.

  const sincronizarDocumentos = useCallback(async (): Promise<string[]> => {
    const fallidos: string[] = [];
    try {
      const pendientes = await getDocumentosNoSincronizados();
      if (pendientes.length === 0) return fallidos;

      console.log(`[Sync] ${pendientes.length} documento(s) de finca pendientes`);

      for (const doc of pendientes) {
        try {
          const mimeType =
            doc.tipo === 'pdf'
              ? 'application/pdf'
              : doc.tipo === 'foto'
                ? 'image/jpeg'
                : 'application/octet-stream';

          const resultado = await subirDocumento(
            doc.uri,
            doc.descripcion || undefined,
            doc.tipo,
            doc.nombre,
            doc.beneficiario_cedula || undefined,
            undefined,
            undefined,
            mimeType,
            // Sin esto el servidor guardaba el documento sin saber a qué
            // formulario pertenecía — invisible para cualquier rol de
            // supervisión que quisiera revisarlo desde otro dispositivo.
            doc.formulario_id || undefined
          );

          if (resultado) {
            await marcarDocumentoSincronizado(doc.id);
            console.log('[Sync] Documento subido:', doc.nombre);
          } else {
            fallidos.push(doc.id);
          }
        } catch (err) {
          console.warn('[Sync] Error subiendo documento:', doc.id, err);
          fallidos.push(doc.id);
        }
      }
    } catch (err) {
      console.warn('[Sync] Error obteniendo documentos pendientes:', err);
    }
    return fallidos;
  }, []);

  // ------------------------------------------------------------------
  // Guardar formulario completo en PostGIS
  // ------------------------------------------------------------------

  const guardarFormularioEnServidor = useCallback(
    async (form: Formulario): Promise<boolean> => {
      try {
        const payload = {
          id: form.id,
          tipo: form.tipo,
          tecnico: form.tecnico,
          beneficiario: form.beneficiario,
          actividad: form.actividad,
          // La encuesta completa (52 preguntas) vive aquí. Sin este campo el
          // servidor recibía el formulario vacío de respuestas y el
          // multi-dispositivo mostraba solo el cascarón.
          sociodemografico: form.sociodemografico || null,
          caracterizacion_nueva: (form as any).caracterizacion_nueva || null,
          // Se envía completo, no recortado por campo: la versión anterior
          // elegía los campos a mano y cada vez que se agregaba uno nuevo a
          // Coordenadas (como 'lugar', el municipio resuelto) quedaba
          // huérfano aquí — se perdía en cuanto el formulario pasaba por el
          // servidor, aunque la app ya lo mostrara bien en el mismo dispositivo.
          coordenadas: form.coordenadas || null,
          georeferencia: form.georeferencia || null,
          clima: form.clima || null,
          fotos: (form.fotos || []).map((f) => ({
            id: f.id,
            uri: f.uri,
            // 'tipo' se omitía aquí: el servidor guardaba cada evidencia sin
            // saber si era foto o video. Cualquier rol que revisara el
            // formulario desde OTRO dispositivo (donde no hay copia local
            // que sí conserva 'tipo') veía el video contado y mostrado como
            // una foto más, sin poder reproducirlo.
            tipo: f.tipo,
            coordenadas: f.coordenadas,
            timestamp: f.timestamp,
          })),
          firma_beneficiario: form.firma_beneficiario || null,
          firma_tecnico: form.firma_tecnico || null,
          huella_beneficiario: form.huella_beneficiario,
          pdf_url: form.pdf_url || null,
          created_at: form.created_at,
          updated_at: form.updated_at,
        };

        await apiClient.post(
          API_CONFIG.ENDPOINTS.FORMS + '/guardar',
          payload,
          { timeout: 30000 },
        );

        console.log('[Sync] Formulario guardado en servidor:', form.id);
        return true;
      } catch (err: any) {
        console.warn('[Sync] Error guardando formulario:', form.id, err?.message);
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Generar PDF en el servidor
  // ------------------------------------------------------------------

  const generarPDFServidor = useCallback(
    async (form: Formulario): Promise<boolean> => {
      try {
        const url = await generarPDF(form);
        if (url) {
          console.log('[Sync] PDF generado:', url);
          return true;
        }
        console.warn('[Sync] PDF devolvió null');
        return false;
      } catch (err) {
        console.warn('[Sync] Error generando PDF:', err);
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Sincronizar formulario individual (fotos + form + PDF)
  // ------------------------------------------------------------------

  const sincronizarFormulario = useCallback(
    async (form: Formulario): Promise<{ success: boolean; photosOk: boolean }> => {
      console.log('[Sync] Sincronizando formulario:', form.id);

      // 1. Subir fotos y videos
      const fotosOk = await subirFotosPendientes(form);
      if (!fotosOk) {
        console.warn('[Sync] Algunas fotos no se subieron — el formulario se reintentará');
      }
      const videosOk = await subirVideosPendientes(form);
      if (!videosOk) {
        console.warn('[Sync] Algunos videos no se subieron — el formulario se reintentará');
      }

      // 2. Guardar formulario en PostGIS
      const formOk = await guardarFormularioEnServidor(form);
      if (!formOk) {
        console.error('[Sync] Error crítico: formulario no guardado en servidor');
        return { success: false, photosOk: fotosOk && videosOk };
      }

      // 3. Generar PDF (no crítico — puede fallar y reintentarse)
      await generarPDFServidor(form);

      return { success: true, photosOk: fotosOk && videosOk };
    },
    [subirFotosPendientes, subirVideosPendientes, guardarFormularioEnServidor, generarPDFServidor],
  );

  // ------------------------------------------------------------------
  // Resolver clima/ubicación pendiente
  // ------------------------------------------------------------------
  // Formularios guardados sin señal se quedan sin nombre de lugar ni
  // clima — antes esa información se perdía para siempre (Visita Técnica
  // ni siquiera lo intentaba en línea). Aquí se reintenta usando la fecha
  // REAL de creación del formulario, para que el clima resuelto sea el de
  // la visita y no el del momento del sync.

  /** Formularios locales sin clima/lugar resuelto pero con coordenadas válidas */
  const buscarFormulariosConClimaPendiente = useCallback(async (): Promise<Formulario[]> => {
    try {
      const locales = await getFormulariosLocales();
      return locales.filter((f) => {
        const tieneCoords = !!(f.coordenadas?.latitud || f.coordenadas?.longitud);
        const tieneClima = !!f.clima?.actual;
        const tieneLugar = !!f.coordenadas?.lugar;
        return tieneCoords && (!tieneClima || !tieneLugar);
      });
    } catch (err) {
      console.warn('[Sync] Error buscando formularios con clima pendiente:', err);
      return [];
    }
  }, []);

  const resolverClimaPendiente = useCallback(
    async (pendientes: Formulario[]): Promise<void> => {
      for (const form of pendientes) {
        try {
          const { lugar, resumen } = await resolverClimaYUbicacion(
            form.coordenadas.latitud,
            form.coordenadas.longitud,
            form.created_at
          );
          // Sigue sin señal o Nominatim/Open-Meteo fallaron — se reintenta
          // en el próximo ciclo de sync, no es un error permanente.
          if (!lugar && !resumen) continue;

          const actualizado: Formulario = {
            ...form,
            coordenadas: lugar ? { ...form.coordenadas, lugar } : form.coordenadas,
            clima: resumen || form.clima,
          };

          await saveFormularioLocal(actualizado);

          // Si el formulario ya estaba en el servidor, reflejar el cambio
          // ahí también — sincronizarFormulario es seguro de repetir: las
          // fotos/videos ya subidos se saltan (getUnsyncedPhotos/Videos
          // solo devuelve lo pendiente).
          if (form.sincronizado) {
            await sincronizarFormulario(actualizado);
          }

          console.log('[Sync] Clima/ubicación resuelto para formulario:', form.id);
        } catch (err) {
          console.warn('[Sync] No se pudo resolver clima pendiente para', form.id, err);
        }
      }
    },
    [sincronizarFormulario]
  );

  // ------------------------------------------------------------------
  // Sincronizar plantaciones pendientes
  // ------------------------------------------------------------------

  const sincronizarPlantaciones = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    try {
      const pendientes = await getPlantacionesNoSincronizadas();
      if (pendientes.length === 0) return fallaron;

      console.log(`[Sync] Subiendo ${pendientes.length} plantaciones...`);
      const response = await apiClient.post(
        API_CONFIG.ENDPOINTS.PLANTACIONES + '/sync',
        { plantaciones: pendientes },
        { timeout: 15000 }
      );

      if (response.data?.estado === 'ok') {
        for (const p of pendientes) {
          await marcarSincronizado('plantaciones', p.id);
        }
        console.log(`[Sync] ${pendientes.length} plantaciones sincronizadas`);
      } else {
        pendientes.forEach(p => fallaron.push(p.id));
      }
    } catch (err: any) {
      console.warn('[Sync] Error sincronizando plantaciones:', err?.message);
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar visitas programadas pendientes
  // ------------------------------------------------------------------

  const sincronizarVisitasProgramadas = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    try {
      const pendientes = await getVisitasProgramadasNoSincronizadas();
      if (pendientes.length === 0) return fallaron;

      console.log(`[Sync] Subiendo ${pendientes.length} visita(s) programada(s)...`);
      const response = await apiClient.post(
        API_CONFIG.ENDPOINTS.VISITAS_PROGRAMADAS + '/sync',
        { visitas: pendientes },
        { timeout: 15000 }
      );

      if (response.data?.estado === 'ok') {
        for (const v of pendientes) {
          await marcarSincronizado('visitas_programadas', v.id);
        }
        console.log(`[Sync] ${pendientes.length} visita(s) programada(s) sincronizada(s)`);
      } else {
        pendientes.forEach(v => fallaron.push(v.id));
      }
    } catch (err: any) {
      console.warn('[Sync] Error sincronizando visitas programadas:', err?.message);
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar mediciones de terreno pendientes
  // ------------------------------------------------------------------

  const sincronizarMediciones = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    try {
      const pendientes = await getMedicionesNoSincronizadas();
      if (pendientes.length === 0) return fallaron;

      console.log(`[Sync] Subiendo ${pendientes.length} mediciones...`);
      const response = await apiClient.post(
        API_CONFIG.ENDPOINTS.MEDICIONES + '/sync',
        { mediciones: pendientes },
        { timeout: 15000 }
      );

      if (response.data?.estado === 'ok') {
        for (const m of pendientes) {
          await marcarSincronizado('mediciones_terreno', m.id);
        }
        console.log(`[Sync] ${pendientes.length} mediciones sincronizadas`);
      } else {
        pendientes.forEach(m => fallaron.push(m.id));
      }
    } catch (err: any) {
      console.warn('[Sync] Error sincronizando mediciones:', err?.message);
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar posiciones de tracking pendientes
  // ------------------------------------------------------------------

  const sincronizarTracking = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    try {
      const pendientes = await getTrackingNoSincronizado();
      if (pendientes.length === 0) return fallaron;

      console.log(`[Sync] Subiendo ${pendientes.length} posiciones de tracking...`);
      const response = await apiClient.post(
        API_CONFIG.ENDPOINTS.TRACKING + '/sync',
        { posiciones: pendientes },
        { timeout: 15000 }
      );

      if (response.data?.estado === 'ok') {
        for (const pos of pendientes) {
          await marcarSincronizado('tracking_posiciones', pos.id);
        }
        console.log(`[Sync] ${pendientes.length} posiciones sincronizadas`);
      } else {
        pendientes.forEach(pos => fallaron.push(pos.id));
      }
    } catch (err: any) {
      console.warn('[Sync] Error sincronizando tracking:', err?.message);
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // checkPending — contar todos los items pendientes
  // ------------------------------------------------------------------

  const checkPending = useCallback(async () => {
    try {
      const [forms, plantas, mediciones, tracking, visitas] = await Promise.all([
        getPendingSyncForms(),
        getPlantacionesNoSincronizadas(),
        getMedicionesNoSincronizadas(),
        getTrackingNoSincronizado(),
        getVisitasProgramadasNoSincronizadas(),
      ]);
      const total = forms.length + plantas.length + mediciones.length + tracking.length + visitas.length;
      dispatch({ type: 'SET_PENDING', count: total });
    } catch {
      // Ignorar errores al verificar pendientes
    }
  }, []);

  // ------------------------------------------------------------------
  // syncNow — sincronizar todos los formularios pendientes
  // ------------------------------------------------------------------

  const syncNow = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    dispatch({ type: 'SET_SYNCING' });
    const failedIds: string[] = [];

    try {
      const [pendingForms, pendingPlantaciones, pendingMediciones, pendingTracking, pendingVisitas, pendingDocumentos, climaPendientes] = await Promise.all([
        getPendingSyncForms(),
        getPlantacionesNoSincronizadas(),
        getMedicionesNoSincronizadas(),
        getTrackingNoSincronizado(),
        getVisitasProgramadasNoSincronizadas(),
        getDocumentosNoSincronizados(),
        buscarFormulariosConClimaPendiente(),
      ]);

      if (
        pendingForms.length === 0 &&
        pendingPlantaciones.length === 0 &&
        pendingMediciones.length === 0 &&
        pendingTracking.length === 0 &&
        pendingVisitas.length === 0 &&
        pendingDocumentos.length === 0 &&
        climaPendientes.length === 0
      ) {
        dispatch({
          type: 'SYNC_SUCCESS',
          timestamp: new Date().toISOString(),
        });
        isSyncing.current = false;
        return;
      }

      console.log(`[Sync] Iniciando sync: ${pendingForms.length} formulario(s), ${pendingPlantaciones.length} plantación(es), ${pendingMediciones.length} medición(es), ${pendingTracking.length} posición(es), ${pendingVisitas.length} visita(s) programada(s)`);

      // 1. Sincronizar plantaciones
      const plantacionesFallidas = await sincronizarPlantaciones();
      failedIds.push(...plantacionesFallidas.map(id => `plant-${id}`));

      // 2. Sincronizar mediciones de terreno
      const medicionesFallidas = await sincronizarMediciones();
      failedIds.push(...medicionesFallidas.map(id => `med-${id}`));

      // 3. Sincronizar tracking
      const trackingFallido = await sincronizarTracking();
      failedIds.push(...trackingFallido.map(id => `track-${id}`));

      // 3b. Sincronizar visitas programadas
      const visitasFallidas = await sincronizarVisitasProgramadas();
      failedIds.push(...visitasFallidas.map(id => `visita-${id}`));

      // 3c. Documentos de la finca (títulos de predio, cédulas escaneadas)
      const documentosFallidos = await sincronizarDocumentos();
      failedIds.push(...documentosFallidos.map(id => `doc-${id}`));

      // 3d. Clima/ubicación pendiente de formularios guardados sin señal
      if (climaPendientes.length > 0) {
        console.log(`[Sync] Resolviendo clima/ubicación de ${climaPendientes.length} formulario(s)`);
        await resolverClimaPendiente(climaPendientes);
      }

      // 4. Sincronizar formularios (uno por uno con backoff)
      for (const form of pendingForms) {
        // Verificar reintentos
        const queueItem = await getSyncQueueItemByFormId(form.id);
        const intentosActuales = queueItem?.intentos || 0;

        if (intentosActuales >= MAX_RETRIES) {
          console.error(
            `[Sync] Formulario ${form.id} alcanzó máximo de ${MAX_RETRIES} reintentos. Abandonando.`,
          );
          failedIds.push(form.id);
          continue;
        }

        // Antes había aquí un `await setTimeout(intentos * 5s)` DENTRO del
        // bucle: con 10 formularios en reintento 2 el ciclo se bloqueaba 100
        // segundos y los últimos de la cola no llegaban a intentarse si la
        // ventana de señal era corta. La espera entre reintentos la marca
        // ahora el tiempo entre ciclos de sync, no una pausa bloqueante.
        if (intentosActuales > 0) {
          console.log(
            `[Sync] Reintento ${intentosActuales}/${MAX_RETRIES} para ${form.id}`,
          );
        }

        const { success, photosOk } = await sincronizarFormulario(form);

        if (success) {
          // El formulario YA está en PostGIS. Se marca como sincronizado
          // aunque falte alguna foto: antes se exigía `success && photosOk`,
          // así que una sola foto fallida dejaba el formulario "pendiente"
          // para siempre y cada reintento lo reenviaba entero al servidor.
          await markAsSynced(form.id);
          await clearSyncQueueByFormId(form.id);
          if (photosOk) {
            console.log('[Sync] Formulario sincronizado OK:', form.id);
          } else {
            // Las fotos siguen en su propia cola (`fotos_locales`) y se
            // reintentan solas en el próximo ciclo.
            console.warn(
              `[Sync] Formulario ${form.id} guardado; quedan evidencias por subir`,
            );
          }
        } else {
          const nuevosIntentos = intentosActuales + 1;
          await updateSyncAttempts(form.id, nuevosIntentos);
          failedIds.push(form.id);
          console.warn(
            `[Sync] Formulario ${form.id} falló. Intento ${nuevosIntentos}/${MAX_RETRIES}`,
          );
        }
      }

      // 5. Barrido final de evidencias pendientes (de formularios ya
      //    sincronizados cuyas fotos no llegaron a subir en su momento)
      await subirEvidenciasHuerfanas();

      // Resultado final
      if (failedIds.length === 0) {
        dispatch({
          type: 'SYNC_SUCCESS',
          timestamp: new Date().toISOString(),
        });
      } else if (failedIds.length < pendingForms.length) {
        dispatch({
          type: 'SYNC_ERROR',
          error: `${failedIds.length} de ${pendingForms.length} formularios fallaron`,
        });
        dispatch({ type: 'SET_FAILED', ids: failedIds });
      } else {
        dispatch({
          type: 'SYNC_ERROR',
          error: 'Todos los formularios fallaron al sincronizar',
        });
        dispatch({ type: 'SET_FAILED', ids: failedIds });
      }

      await checkPending();

      // Liberar espacio: borra evidencias de más de 30 días que el
      // servidor ya confirmó. Siguen viéndose en el detalle, que las
      // vuelve a traer de MinIO. Nunca toca lo que está sin sincronizar.
      limpiarEvidenciasAntiguas().catch(() => { /* no es crítico */ });
    } catch (err: any) {
      dispatch({
        type: 'SYNC_ERROR',
        error: err?.message || 'Error de conexión durante la sincronización',
      });
    } finally {
      isSyncing.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkPending, sincronizarFormulario, sincronizarDocumentos, subirEvidenciasHuerfanas, buscarFormulariosConClimaPendiente, resolverClimaPendiente]);

  // ------------------------------------------------------------------
  // reintentarFormulario — reintento manual desde la UI
  // ------------------------------------------------------------------

  const reintentarFormulario = useCallback(async (formId: string) => {
    await resetSyncAttempts(formId);
    await syncNow();
  }, [syncNow]);

  // ------------------------------------------------------------------
  // Efecto: verificar pendientes al montar el provider
  // ------------------------------------------------------------------

  useEffect(() => {
    checkPending();
  }, [checkPending]);

  // ------------------------------------------------------------------
  // Efecto: auto-sincronizar en la transición offline→online.
  // Vive en el provider (siempre montado) y no en una pantalla, para que
  // el técnico en campo suba lo pendiente apenas recupere señal, sin
  // depender de que abra el menú o el mapa.
  // ------------------------------------------------------------------

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const isOnlineNow =
        !!netState.isConnected && netState.isInternetReachable !== false;
      const cameOnline = isOnlineNow && wasConnected.current !== true;
      wasConnected.current = isOnlineNow;

      if (cameOnline) {
        console.log('[Sync] Conexión recuperada — sincronizando pendientes...');
        syncNow().catch(() => { /* la cola reintenta */ });
      }
    });

    return () => unsubscribe();
  }, [syncNow]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      abortController.current?.abort();
    };
  }, []);

  // ================================================================
  // Render
  // ================================================================

  const syncValue = useMemo(() => ({
    ...state,
    syncNow,
    checkPending,
    getBackoffSeconds,
    reintentarFormulario,
  }), [state, syncNow, checkPending, getBackoffSeconds, reintentarFormulario]);

  return (
    <SyncContext.Provider value={syncValue}>
      {children}
    </SyncContext.Provider>
  );
};

// ==================================================================
// Hook
// ==================================================================

export const useSync = (): SyncContextType => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync debe usarse dentro de un SyncProvider');
  }
  return context;
};

export default SyncContext;
