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
} from 'react';
import { SyncStatus, Formulario } from '../types';
import {
  getPendingSyncForms,
  markAsSynced,
  clearSyncQueueByFormId,
  getUnsyncedPhotos,
  markFotoAsSynced,
  updateSyncAttempts,
  getSyncQueueItemByFormId,
} from '../services/database';
import { uploadPhoto } from '../services/photos.service';
import { generarPDF } from '../services/pdf.service';
import apiClient from '../services/api';
import { API_CONFIG } from '../theme';

// ==================================================================
// Constantes
// ==================================================================

/** Máximo de reintentos por formulario antes de abandonar */
const MAX_RETRIES = 3;

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

  // ------------------------------------------------------------------
  // Utilitarios
  // ------------------------------------------------------------------

  /** Tiempo de backoff: intentos × 5 segundos, máximo 60 */
  const getBackoffSeconds = useCallback(async (formId: string): Promise<number> => {
    try {
      const item = await getSyncQueueItemByFormId(formId);
      if (!item) return 0;
      return Math.min((item.intentos || 0) * 5, 60);
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
            );

            if (resultado) {
              await markFotoAsSynced(foto.id);
              console.log('[Sync] Foto subida:', foto.id);
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
          coordenadas: {
            latitud: form.coordenadas.latitud,
            longitud: form.coordenadas.longitud,
            altitud: form.coordenadas.altitud,
            precision_gps: form.coordenadas.precision_gps,
            timestamp: form.coordenadas.timestamp,
          },
          georeferencia: form.georeferencia || null,
          clima: form.clima || null,
          fotos: form.fotos.map((f) => ({
            id: f.id,
            uri: f.uri,
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
    async (form: Formulario): Promise<boolean> => {
      console.log('[Sync] Sincronizando formulario:', form.id);

      // 1. Subir fotos
      const fotosOk = await subirFotosPendientes(form);
      if (!fotosOk) {
        console.warn('[Sync] Algunas fotos no se subieron — continuando de todas formas');
      }

      // 2. Guardar formulario en PostGIS
      const formOk = await guardarFormularioEnServidor(form);
      if (!formOk) {
        console.error('[Sync] Error crítico: formulario no guardado en servidor');
        return false;
      }

      // 3. Generar PDF (no crítico — puede fallar y reintentarse)
      await generarPDFServidor(form);

      return true;
    },
    [subirFotosPendientes, guardarFormularioEnServidor, generarPDFServidor],
  );

  // ------------------------------------------------------------------
  // checkPending — contar formularios pendientes
  // ------------------------------------------------------------------

  const checkPending = useCallback(async () => {
    try {
      const pending = await getPendingSyncForms();
      dispatch({ type: 'SET_PENDING', count: pending.length });
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
      const pendingForms = await getPendingSyncForms();

      if (pendingForms.length === 0) {
        dispatch({
          type: 'SYNC_SUCCESS',
          timestamp: new Date().toISOString(),
        });
        isSyncing.current = false;
        return;
      }

      console.log(`[Sync] Iniciando sync de ${pendingForms.length} formulario(s)`);

      // Sincronizar uno por uno
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

        // Backoff: esperar si ha fallado antes
        if (intentosActuales > 0) {
          const espera = Math.min(intentosActuales * 5, 60);
          console.log(
            `[Sync] Reintento ${intentosActuales}/${MAX_RETRIES} para ${form.id}. Esperando ${espera}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, espera * 1000));
        }

        const success = await sincronizarFormulario(form);

        if (success) {
          await markAsSynced(form.id);
          await clearSyncQueueByFormId(form.id);
          console.log('[Sync] Formulario sincronizado OK:', form.id);
        } else {
          const nuevosIntentos = intentosActuales + 1;
          await updateSyncAttempts(form.id, nuevosIntentos);
          failedIds.push(form.id);
          console.warn(
            `[Sync] Formulario ${form.id} falló. Intento ${nuevosIntentos}/${MAX_RETRIES}`,
          );
        }
      }

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
    } catch (err: any) {
      dispatch({
        type: 'SYNC_ERROR',
        error: err?.message || 'Error de conexión durante la sincronización',
      });
    } finally {
      isSyncing.current = false;
    }
  }, [checkPending, sincronizarFormulario]);

  // ------------------------------------------------------------------
  // Efecto: verificar pendientes al montar el provider
  // ------------------------------------------------------------------

  useEffect(() => {
    checkPending();
  }, [checkPending]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      abortController.current?.abort();
    };
  }, []);

  // ================================================================
  // Render
  // ================================================================

  return (
    <SyncContext.Provider
      value={{
        ...state,
        syncNow,
        checkPending,
        getBackoffSeconds,
      }}
    >
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
