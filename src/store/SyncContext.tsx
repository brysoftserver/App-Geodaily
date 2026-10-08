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
import { useAuth } from './AuthContext';
import { cargarBorradores, sincronizarBorradoresConServidor } from './FormDraftStore';
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
  deleteFormularioLocal,
  getSeguimientosNoSincronizados,
  saveSeguimientoLocal,
  deleteEvidenciaLocal,
} from '../services/database';
import { uploadPhoto } from '../services/photos.service';
import { uploadVideo } from '../services/videos.service';
import { subirDocumento } from '../services/documentos.service';
import { subirFirma } from '../services/firmas.service';
import { registrarSeguimiento } from '../services/seguimientos.service';
import { generarPDF } from '../services/pdf.service';
import { limpiarEvidenciasAntiguas } from '../services/mediaStorage.service';
import { resolverClimaYUbicacion } from '../services/climate.service';
import apiClient from '../services/api';
import { API_CONFIG } from '../theme';

// ==================================================================
// Constantes
// ==================================================================

const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

// ==================================================================
// Estado
// ==================================================================

interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSync: string | null;
  error: string | null;
  stage: string | null;
  /** IDs de formularios que fallaron en el último ciclo */
  failedForms: string[];
}

type SyncAction =
  | { type: 'SET_SYNCING' }
  | { type: 'SET_STAGE'; stage: string }
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
  stage: null,
  failedForms: [],
};

// ==================================================================
// Reducer
// ==================================================================

function syncReducer(state: SyncState, action: SyncAction): SyncState {
  switch (action.type) {
    case 'SET_SYNCING':
      return { ...state, status: 'syncing', error: null, stage: 'Preparando pendientes...' };
    case 'SET_STAGE':
      return { ...state, stage: action.stage };
    case 'SYNC_SUCCESS':
      return {
        ...state,
        status: 'completed',
        lastSync: action.timestamp,
        pendingCount: 0,
        error: null,
        stage: null,
      };
    case 'SYNC_ERROR':
      return { ...state, status: 'error', error: action.error, stage: null };
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
  const { user } = useAuth();
  const [state, dispatch] = useReducer(syncReducer, initialState);
  const isSyncing = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDraftCount = useRef(0);
  const retryDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncNowRef = useRef<(() => Promise<void>) | null>(null);
  const syncBorradoresRef = useRef<(() => Promise<void>) | null>(null);
  const isSyncingBorradores = useRef(false);
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

  const scheduleSyncRetry = useCallback((): void => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryCount.current += 1;
    const delay = Math.min(5000 * 2 ** (retryCount.current - 1), MAX_RETRY_DELAY_MS);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      syncNowRef.current?.().catch((err) => {
        console.warn('[Sync] Reintento automático falló:', err);
      });
    }, delay);
  }, []);

  const scheduleDraftRetry = useCallback((): void => {
    if (retryDraftTimer.current) clearTimeout(retryDraftTimer.current);
    retryDraftCount.current += 1;
    const delay = Math.min(5000 * 2 ** (retryDraftCount.current - 1), MAX_RETRY_DELAY_MS);
    retryDraftTimer.current = setTimeout(() => {
      retryDraftTimer.current = null;
      syncBorradoresRef.current?.().catch((err) => {
        console.warn('[Sync] Reintento de borradores falló:', err);
      });
    }, delay);
  }, []);

  const sincronizarBorradoresLocales = useCallback(async (): Promise<void> => {
    if (!user?.id || isSyncingBorradores.current) return;
    isSyncingBorradores.current = true;
    if (retryDraftTimer.current) {
      clearTimeout(retryDraftTimer.current);
      retryDraftTimer.current = null;
    }
    try {
      const conexion = await NetInfo.fetch();
      if (!conexion.isConnected || conexion.isInternetReachable === false) return;
      const locales = await cargarBorradores();
      await sincronizarBorradoresConServidor(user.id, user.cedula, locales);
      retryDraftCount.current = 0;
    } catch (err) {
      console.warn('[Sync] No se pudieron sincronizar borradores:', err);
      scheduleDraftRetry();
    } finally {
      isSyncingBorradores.current = false;
    }
  }, [user?.id, user?.cedula, scheduleDraftRetry]);

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
              foto.id,
            );

            // 410 → un admin/coordinador eliminó esta evidencia desde el
            // detalle del formulario. La copia local ya no sirve: se
            // descarta en vez de reintentar la subida en cada ciclo.
            if (resultado?.estado === 'eliminado') {
              await deleteEvidenciaLocal(foto.id);
              console.log('[Sync] Foto descartada (eliminada en el servidor):', foto.id);
              continue;
            }

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
              video.id,
            );

            // 410 → evidencia eliminada en el servidor (ver fotos arriba).
            if (resultado?.estado === 'eliminado') {
              await deleteEvidenciaLocal(video.id);
              console.log('[Sync] Video descartado (eliminado en el servidor):', video.id);
              continue;
            }

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

  const subirEvidenciasHuerfanas = useCallback(async (): Promise<string[]> => {
    const fallidas: string[] = [];
    try {
      const { fotos, videos } = await getEvidenciasPendientes();
      if (fotos.length === 0 && videos.length === 0) return fallidas;

      console.log(
        `[Sync] Barrido de evidencias: ${fotos.length} foto(s), ${videos.length} video(s)`,
      );

      for (const foto of fotos) {
        try {
          // Evidencias capturadas antes de que existiera el formulario en
          // curso llegan aquí con formulario_id = '' (captura en campo con
          // la app recién abierta). Se sube igual —a la carpeta del
          // beneficiario si tiene cédula, o a la del técnico— en vez de
          // dejarla sin subir para siempre.
          const formIdEvidencia = foto.formulario_id || undefined;
          const r = await uploadPhoto(
            foto.uri,
            foto.latitud ?? undefined,
            foto.longitud ?? undefined,
            foto.altitud ?? undefined,
            formIdEvidencia ? `Formulario ${formIdEvidencia}` : 'Evidencia sin formulario asignado',
            undefined,
            foto.beneficiario_cedula ?? undefined,
            foto.beneficiario_nombre ?? undefined,
            foto.timestamp,
            foto.tipo_formulario ?? undefined,
            formIdEvidencia,
            foto.id,
          );
          // 410 → eliminada en el servidor: se borra la copia local.
          if (r?.estado === 'eliminado') {
            await deleteEvidenciaLocal(foto.id);
            console.log('[Sync] Evidencia huérfana descartada (eliminada en el servidor):', foto.id);
            continue;
          }
          if (r) {
            await markFotoAsSynced(foto.id, { archivoId: r.id, ruta: r.ruta });
          } else {
            fallidas.push(`foto-${foto.id}`);
          }
        } catch {
          // se reintenta en el próximo ciclo
          fallidas.push(`foto-${foto.id}`);
        }
      }

      for (const video of videos) {
        try {
          const formIdEvidencia = video.formulario_id || undefined;
          const r = await uploadVideo(
            video.uri,
            video.latitud ?? undefined,
            video.longitud ?? undefined,
            formIdEvidencia ? `Formulario ${formIdEvidencia}` : 'Evidencia sin formulario asignado',
            video.beneficiario_cedula ?? undefined,
            video.beneficiario_nombre ?? undefined,
            video.tipo_formulario ?? undefined,
            formIdEvidencia,
            video.id,
          );
          // 410 → eliminado en el servidor: se borra la copia local.
          if (r?.estado === 'eliminado') {
            await deleteEvidenciaLocal(video.id);
            console.log('[Sync] Evidencia huérfana descartada (eliminada en el servidor):', video.id);
            continue;
          }
          if (r) {
            await markVideoAsSynced(video.id, { archivoId: r.id, ruta: r.ruta });
          } else {
            fallidas.push(`video-${video.id}`);
          }
        } catch {
          // se reintenta en el próximo ciclo
          fallidas.push(`video-${video.id}`);
        }
      }
    } catch (err) {
      console.warn('[Sync] Error en el barrido de evidencias:', err);
      fallidas.push('evidencias');
    }
    return fallidas;
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
            doc.formulario_id || undefined,
            doc.id
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
  // Subir seguimientos de Coordinación/Interventoría pendientes
  // ------------------------------------------------------------------
  // Cada seguimiento guarda sus evidencias embebidas (fotos/videos con uri
  // local + archivo_id una vez subidas; firmas en base64 hasta que se suben,
  // luego se reemplazan por su archivo_id). Se sube todo pendiente primero y
  // solo si TODO queda resuelto se crea/actualiza el seguimiento en el
  // servidor — si algo falla (sigue sin señal), se reintenta completo en el
  // próximo ciclo.

  const sincronizarSeguimientos = useCallback(async (): Promise<string[]> => {
    const fallidos: string[] = [];
    try {
      const pendientes = await getSeguimientosNoSincronizados();
      if (pendientes.length === 0) return fallidos;

      console.log(`[Sync] ${pendientes.length} seguimiento(s) pendientes`);

      for (const s of pendientes) {
        try {
          let algunaFallo = false;

          const fotosFinales: { id: string; uri: string; archivo_id?: string }[] = [];
          for (const foto of s.fotos || []) {
            if (foto.archivo_id) {
              fotosFinales.push(foto);
              continue;
            }
            // Evidencia sin archivo local utilizable (p. ej. el `uri` de otro
            // teléfono): no hay nada que subir desde aquí, así que se descarta
            // en vez de bloquear el seguimiento reintentando para siempre.
            if (!foto.uri?.startsWith('file://')) {
              console.warn('[Sync] Foto de seguimiento sin archivo local, se descarta:', foto.id);
              continue;
            }
            const subida = await uploadPhoto(
              foto.uri,
              undefined,
              undefined,
              undefined,
              `Seguimiento ${s.autor_rol} — ${s.autor_nombre || ''}`,
              undefined,
              s.beneficiario_cedula || undefined,
              s.beneficiario_nombre || undefined,
              s.created_at,
              'seguimiento',
              undefined,
              foto.id
            );
            // 410 → eliminada en el servidor: se omite del seguimiento en
            // vez de dejar el envío bloqueado reintentando para siempre.
            if (subida?.estado === 'eliminado') {
              console.log('[Sync] Foto de seguimiento descartada (eliminada en el servidor):', foto.id);
              continue;
            }
            if (subida) {
              fotosFinales.push({ ...foto, archivo_id: subida.id });
            } else {
              fotosFinales.push(foto);
              algunaFallo = true;
            }
          }

          const videosFinales: { id: string; uri: string; archivo_id?: string }[] = [];
          for (const video of s.videos || []) {
            if (video.archivo_id) {
              videosFinales.push(video);
              continue;
            }
            // Ver nota en las fotos de seguimiento: sin archivo local válido
            // no hay nada que subir desde este dispositivo.
            if (!video.uri?.startsWith('file://')) {
              console.warn('[Sync] Video de seguimiento sin archivo local, se descarta:', video.id);
              continue;
            }
            const subida = await uploadVideo(
              video.uri,
              undefined,
              undefined,
              `Seguimiento ${s.autor_rol} — ${s.autor_nombre || ''}`,
              s.beneficiario_cedula || undefined,
              s.beneficiario_nombre || undefined,
              'seguimiento',
              undefined,
              video.id
            );
            // 410 → eliminado en el servidor (ver fotos de seguimiento arriba).
            if (subida?.estado === 'eliminado') {
              console.log('[Sync] Video de seguimiento descartado (eliminado en el servidor):', video.id);
              continue;
            }
            if (subida) {
              videosFinales.push({ ...video, archivo_id: subida.id });
            } else {
              videosFinales.push(video);
              algunaFallo = true;
            }
          }

          // Firmas: mientras no se hayan subido guardan el base64 ('data:...');
          // una vez subidas se reemplazan por su archivo_id de MinIO.
          let firmaBeneficiarioFinal = s.firma_beneficiario;
          if (firmaBeneficiarioFinal?.startsWith('data:')) {
            const subida = await subirFirma('beneficiario', firmaBeneficiarioFinal, s.beneficiario_cedula, s.beneficiario_nombre, 'seguimiento', `${s.id}:firma-beneficiario`);
            if (subida) firmaBeneficiarioFinal = subida.id;
            else algunaFallo = true;
          }

          let firmaAutorFinal = s.firma_autor;
          if (firmaAutorFinal?.startsWith('data:')) {
            const subida = await subirFirma('revisor', firmaAutorFinal, s.beneficiario_cedula, s.beneficiario_nombre, 'seguimiento', `${s.id}:firma-autor`);
            if (subida) firmaAutorFinal = subida.id;
            else algunaFallo = true;
          }

          if (algunaFallo) {
            // Persistir lo que sí se resolvió para no repetirlo en el próximo ciclo.
            await saveSeguimientoLocal({
              ...s,
              fotos: fotosFinales,
              videos: videosFinales,
              firma_beneficiario: firmaBeneficiarioFinal,
              firma_autor: firmaAutorFinal,
            });
            console.warn(`[Sync] Seguimiento ${s.id}: faltan evidencias por subir, se envía el registro y se reintentan las evidencias`);
          }

          // IMPORTANTE: se envía el seguimiento al servidor AUNQUE falten
          // evidencias. Antes, si una sola foto/video/firma no subía, el
          // registro completo quedaba atrapado en el teléfono y nunca llegaba
          // al servidor (el admin no lo veía). Ahora el registro (actividad,
          // objetivo, descripción, observaciones, geo, beneficiario) se sube
          // siempre; las evidencias que falten se reintentan en el próximo
          // ciclo sin bloquear el registro.
          const guardadoEnServidor = await registrarSeguimiento({
            id: s.id,
            actividad: s.actividad,
            objetivo_visita: s.objetivo_visita,
            descripcion_actividad: s.descripcion_actividad,
            observaciones: s.observaciones,
            fotos: fotosFinales.filter((f) => f.archivo_id).map((f) => ({ archivo_id: f.archivo_id as string, uri: f.uri })),
            videos: videosFinales.filter((v) => v.archivo_id).map((v) => ({ archivo_id: v.archivo_id as string, uri: v.uri })),
            firma_beneficiario: firmaBeneficiarioFinal,
            firma_autor: firmaAutorFinal,
            geo_latitud: s.geo_latitud,
            geo_longitud: s.geo_longitud,
            geo_altitud: s.geo_altitud,
            geo_precision: s.geo_precision,
            huella_beneficiario: s.huella_beneficiario,
            beneficiario_cedula: s.beneficiario_cedula,
            beneficiario_nombre: s.beneficiario_nombre,
            formulario_id: s.formulario_id,
            // Respetar la fecha corregida (o la de creación offline) en vez de
            // dejar que el servidor use NOW() al re-sincronizar.
            created_at: s.created_at,
          });

          if (algunaFallo) {
            // El registro ya está en el servidor, pero quedan evidencias
            // pendientes: se conserva localmente como NO sincronizado para
            // reintentar solo las evidencias en el próximo ciclo.
            await saveSeguimientoLocal({
              ...s,
              fotos: fotosFinales,
              videos: videosFinales,
              firma_beneficiario: firmaBeneficiarioFinal,
              firma_autor: firmaAutorFinal,
              sincronizado: false,
              updated_at: guardadoEnServidor?.updated_at || s.updated_at,
            });
            fallidos.push(s.id);
          } else {
            // Persistir la evidencia YA resuelta (con archivo_id) y el
            // `updated_at` que devolvió el servidor. Antes esta rama solo hacía
            // `marcarSincronizado` (sincronizado = 1) y NO guardaba los
            // archivo_id de las fotos/videos ya subidos: la copia local
            // conservaba eternamente `fotos: [{id, uri}]` SIN archivo_id, así
            // que `getSeguimientosNoSincronizados` la consideraba "pendiente"
            // para siempre (por el rescate de evidencia sin archivo_id) y el
            // teléfono re-subía el seguimiento en CADA ciclo de sync. Ese
            // re-POST es un upsert que reemplaza la fila completa y borraba las
            // correcciones (y la fecha) hechas desde otro dispositivo, como el
            // caso de la laptop de Kelly. Guardar aquí la evidencia resuelta y
            // el updated_at del servidor corta ese bucle y hace que el merge
            // por marca de tiempo funcione (ya no hay "evidencia pendiente"
            // espuria que lo bloquee).
            await saveSeguimientoLocal({
              ...s,
              fotos: fotosFinales,
              videos: videosFinales,
              firma_beneficiario: firmaBeneficiarioFinal,
              firma_autor: firmaAutorFinal,
              sincronizado: true,
              updated_at: guardadoEnServidor?.updated_at || s.updated_at,
            });
            console.log('[Sync] Seguimiento sincronizado:', s.id);
          }
        } catch (err) {
          console.warn('[Sync] Error sincronizando seguimiento:', s.id, err);
          fallidos.push(s.id);
        }
      }
    } catch (err) {
      console.warn('[Sync] Error obteniendo seguimientos pendientes:', err);
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
        // 410 = el admin borró este formulario a propósito (ver
        // formularios_eliminados en el backend). Este dispositivo todavía
        // tenía una copia local pendiente de subir — en vez de reintentarla
        // para siempre (o peor, resucitar la visita en el servidor), se
        // borra la copia local y se da por resuelto: no hay nada más que
        // sincronizar.
        if (err?.response?.status === 410) {
          console.warn('[Sync] Formulario eliminado por un admin, se descarta la copia local:', form.id);
          await deleteFormularioLocal(form.id);
          await clearSyncQueueByFormId(form.id);
          return true;
        }
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
    async (pendientes: Formulario[]): Promise<string[]> => {
      const fallidos: string[] = [];
      for (const form of pendientes) {
        try {
          const { lugar, resumen } = await resolverClimaYUbicacion(
            form.coordenadas.latitud,
            form.coordenadas.longitud,
            form.created_at
          );
          // Sigue sin señal o Nominatim/Open-Meteo fallaron — se reintenta
          // en el próximo ciclo de sync, no es un error permanente.
          if (!lugar && !resumen) {
            fallidos.push(form.id);
            continue;
          }

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
            const resultado = await sincronizarFormulario(actualizado);
            if (!resultado.success) fallidos.push(form.id);
          }

          console.log('[Sync] Clima/ubicación resuelto para formulario:', form.id);
        } catch (err) {
          console.warn('[Sync] No se pudo resolver clima pendiente para', form.id, err);
          fallidos.push(form.id);
        }
      }
      return fallidos;
    },
    [sincronizarFormulario]
  );

  // ------------------------------------------------------------------
  // Sincronizar plantaciones pendientes
  // ------------------------------------------------------------------

  const sincronizarPlantaciones = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    let pendientes: Record<string, any>[] = [];
    try {
      pendientes = await getPlantacionesNoSincronizadas();
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
      fallaron.push(...(pendientes.length ? pendientes.map(p => p.id) : ['error']));
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar visitas programadas pendientes
  // ------------------------------------------------------------------

  const sincronizarVisitasProgramadas = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    let pendientes: Record<string, any>[] = [];
    try {
      pendientes = await getVisitasProgramadasNoSincronizadas();
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
      fallaron.push(...(pendientes.length ? pendientes.map(v => v.id) : ['error']));
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar mediciones de terreno pendientes
  // ------------------------------------------------------------------

  const sincronizarMediciones = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    let pendientes: Record<string, any>[] = [];
    try {
      pendientes = await getMedicionesNoSincronizadas();
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
      fallaron.push(...(pendientes.length ? pendientes.map(m => m.id) : ['error']));
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // Sincronizar posiciones de tracking pendientes
  // ------------------------------------------------------------------

  const sincronizarTracking = useCallback(async (): Promise<string[]> => {
    const fallaron: string[] = [];
    let pendientes: Record<string, any>[] = [];
    try {
      pendientes = await getTrackingNoSincronizado();
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
      fallaron.push(...(pendientes.length ? pendientes.map(pos => pos.id) : ['error']));
    }
    return fallaron;
  }, []);

  // ------------------------------------------------------------------
  // checkPending — contar todos los items pendientes
  // ------------------------------------------------------------------

  const checkPending = useCallback(async () => {
    try {
      const [forms, plantas, mediciones, tracking, visitas, documentos, evidencias, seguimientos] = await Promise.all([
        getPendingSyncForms(),
        getPlantacionesNoSincronizadas(),
        getMedicionesNoSincronizadas(),
        getTrackingNoSincronizado(),
        getVisitasProgramadasNoSincronizadas(),
        getDocumentosNoSincronizados(),
        getEvidenciasPendientes(),
        getSeguimientosNoSincronizados(),
      ]);
      const total = forms.length + plantas.length + mediciones.length + tracking.length + visitas.length + documentos.length + evidencias.fotos.length + evidencias.videos.length + seguimientos.length;
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
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    isSyncing.current = true;

    dispatch({ type: 'SET_SYNCING' });
    const failedIds: string[] = [];

    try {
      const [pendingForms, pendingPlantaciones, pendingMediciones, pendingTracking, pendingVisitas, pendingDocumentos, pendingEvidencias, climaPendientes, pendingSeguimientos] = await Promise.all([
        getPendingSyncForms(),
        getPlantacionesNoSincronizadas(),
        getMedicionesNoSincronizadas(),
        getTrackingNoSincronizado(),
        getVisitasProgramadasNoSincronizadas(),
        getDocumentosNoSincronizados(),
        getEvidenciasPendientes(),
        buscarFormulariosConClimaPendiente(),
        getSeguimientosNoSincronizados(),
      ]);

      if (
        pendingForms.length === 0 &&
        pendingPlantaciones.length === 0 &&
        pendingMediciones.length === 0 &&
        pendingTracking.length === 0 &&
        pendingVisitas.length === 0 &&
        pendingDocumentos.length === 0 &&
        pendingEvidencias.fotos.length === 0 &&
        pendingEvidencias.videos.length === 0 &&
        climaPendientes.length === 0 &&
        pendingSeguimientos.length === 0
      ) {
        dispatch({
          type: 'SYNC_SUCCESS',
          timestamp: new Date().toISOString(),
        });
        retryCount.current = 0;
        isSyncing.current = false;
        return;
      }

      console.log(`[Sync] Iniciando sync: ${pendingForms.length} formulario(s), ${pendingPlantaciones.length} plantación(es), ${pendingMediciones.length} medición(es), ${pendingTracking.length} posición(es), ${pendingVisitas.length} visita(s) programada(s)`);

      // 1. Sincronizar plantaciones
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando plantaciones...' });
      const plantacionesFallidas = await sincronizarPlantaciones();
      failedIds.push(...plantacionesFallidas.map(id => `plant-${id}`));

      // 2. Sincronizar mediciones de terreno
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando mediciones...' });
      const medicionesFallidas = await sincronizarMediciones();
      failedIds.push(...medicionesFallidas.map(id => `med-${id}`));

      // 3. Sincronizar tracking
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando ubicaciones GPS...' });
      const trackingFallido = await sincronizarTracking();
      failedIds.push(...trackingFallido.map(id => `track-${id}`));

      // 3b. Sincronizar visitas programadas
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando visitas programadas...' });
      const visitasFallidas = await sincronizarVisitasProgramadas();
      failedIds.push(...visitasFallidas.map(id => `visita-${id}`));

      // 3c. Documentos de la finca (títulos de predio, cédulas escaneadas)
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando documentos...' });
      const documentosFallidos = await sincronizarDocumentos();
      failedIds.push(...documentosFallidos.map(id => `doc-${id}`));

      // 3e. Seguimientos de Coordinación/Interventoría registrados en campo
      dispatch({ type: 'SET_STAGE', stage: 'Sincronizando seguimientos...' });
      const seguimientosFallidos = await sincronizarSeguimientos();
      failedIds.push(...seguimientosFallidos.map(id => `seg-${id}`));

      // 3d. Clima/ubicación pendiente de formularios guardados sin señal
      if (climaPendientes.length > 0) {
        console.log(`[Sync] Resolviendo clima/ubicación de ${climaPendientes.length} formulario(s)`);
        dispatch({ type: 'SET_STAGE', stage: 'Resolviendo ubicación y clima...' });
        const climaFallidos = await resolverClimaPendiente(climaPendientes);
        failedIds.push(...climaFallidos.map(id => `clima-${id}`));
      }

      // 4. Sincronizar formularios (uno por uno con backoff)
      let formularioIndex = 0;
      for (const form of pendingForms) {
        formularioIndex += 1;
        dispatch({
          type: 'SET_STAGE',
          stage: `Sincronizando formulario ${formularioIndex} de ${pendingForms.length}...`,
        });
        // Verificar reintentos
        const queueItem = await getSyncQueueItemByFormId(form.id);
        const intentosActuales = queueItem?.intentos || 0;

        if (intentosActuales > 0) {
          console.log(
            `[Sync] Reintento ${intentosActuales} para ${form.id}`,
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
            `[Sync] Formulario ${form.id} falló. Intento ${nuevosIntentos}`,
          );
        }
      }

      // 5. Barrido final de evidencias pendientes (de formularios ya
      //    sincronizados cuyas fotos no llegaron a subir en su momento)
      dispatch({ type: 'SET_STAGE', stage: 'Subiendo fotos y videos pendientes...' });
      const evidenciasFallidas = await subirEvidenciasHuerfanas();
      failedIds.push(...evidenciasFallidas);

      // Resultado final
      if (failedIds.length === 0) {
        retryCount.current = 0;
        dispatch({
          type: 'SYNC_SUCCESS',
          timestamp: new Date().toISOString(),
        });
      } else {
        dispatch({
          type: 'SYNC_ERROR',
          error: `${failedIds.length} elemento(s) no se sincronizaron. Se conservaron en el dispositivo; se reintentará automáticamente.`,
        });
        dispatch({ type: 'SET_FAILED', ids: failedIds });
        scheduleSyncRetry();
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
      scheduleSyncRetry();
    } finally {
      isSyncing.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkPending, sincronizarFormulario, sincronizarDocumentos, sincronizarSeguimientos, subirEvidenciasHuerfanas, buscarFormulariosConClimaPendiente, resolverClimaPendiente, scheduleSyncRetry]);

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
    syncNowRef.current = syncNow;
    return () => {
      syncNowRef.current = null;
    };
  }, [syncNow]);

  useEffect(() => {
    syncBorradoresRef.current = sincronizarBorradoresLocales;
    return () => {
      syncBorradoresRef.current = null;
    };
  }, [sincronizarBorradoresLocales]);

  useEffect(() => {
    if (user?.id) void sincronizarBorradoresLocales();
  }, [user?.id, sincronizarBorradoresLocales]);

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
        void sincronizarBorradoresLocales();
      }
    });

    return () => unsubscribe();
  }, [syncNow, sincronizarBorradoresLocales]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      abortController.current?.abort();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (retryDraftTimer.current) clearTimeout(retryDraftTimer.current);
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
