// ============================================================
// useSyncMapData — Sincronización de datos del mapa general
// (Plantaciones, tracking, mediciones)
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { API_CONFIG } from '../theme';
import { useAuth } from '../store/AuthContext';
import {
  getPlantacionesNoSincronizadas,
  getTrackingNoSincronizado,
  getMedicionesNoSincronizadas,
  marcarSincronizado,
  getPlantaciones,
  getUltimasPosicionesTecnicos,
  getMediciones,
  deletePlantacionLocal,
  deleteMedicionLocal,
} from '../services/database';

interface SyncMapDataState {
  syncing: boolean;
  error: string | null;
  plantaciones: any[];
  posiciones: any[];
  mediciones: any[];
  loading: boolean;
}

export function useSyncMapData() {
  const { user, isAdmin, isSupervisor, isGerente } = useAuth();
  const canViewAll = isAdmin || isSupervisor || isGerente;
  const syncingRef = useRef(false);

  const [state, setState] = useState<SyncMapDataState>({
    syncing: false,
    error: null,
    plantaciones: [],
    posiciones: [],
    mediciones: [],
    loading: false,
  });

  /**
   * Sincronizar datos locales pendientes hacia el servidor
   */
  const syncAll = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    setState(prev => ({ ...prev, syncing: true, error: null }));

    try {
      const token = user?.token;
      if (!token) throw new Error('Sin token de autenticación');

      // 1. Sincronizar plantaciones
      const plantacionesPendientes = await getPlantacionesNoSincronizadas();
      if (plantacionesPendientes.length > 0) {
        const resPlant = await fetch(`${API_CONFIG.BASE_URL}/api/plantaciones/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plantaciones: plantacionesPendientes }),
        });
        if (resPlant.ok) {
          for (const p of plantacionesPendientes) {
            await marcarSincronizado('plantaciones', p.id);
          }
        }
      }

      // 2. Sincronizar posiciones de tracking
      const trackingPendiente = await getTrackingNoSincronizado();
      if (trackingPendiente.length > 0) {
        const resTrack = await fetch(`${API_CONFIG.BASE_URL}/api/tracking/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ posiciones: trackingPendiente }),
        });
        if (resTrack.ok) {
          for (const t of trackingPendiente) {
            await marcarSincronizado('tracking_posiciones', t.id);
          }
        }
      }

      // 3. Sincronizar mediciones de terreno
      const medicionesPendientes = await getMedicionesNoSincronizadas();
      if (medicionesPendientes.length > 0) {
        const resMed = await fetch(`${API_CONFIG.BASE_URL}/api/mediciones/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mediciones: medicionesPendientes }),
        });
        if (resMed.ok) {
          for (const m of medicionesPendientes) {
            await marcarSincronizado('mediciones_terreno', m.id);
          }
        }
      }

      setState(prev => ({ ...prev, syncing: false }));
    } catch (error: any) {
      console.error('[SyncMapData] Error:', error);
      setState(prev => ({ ...prev, syncing: false, error: error.message }));
    } finally {
      syncingRef.current = false;
    }
  }, [user?.token]);

  /**
   * Cargar todas las plantaciones
   * - Para supervisores/gerentes/admin: desde el servidor (ve TODAS)
   * - Para técnicos: desde BD local (solo sus propias)
   */
  const fetchAllPlantaciones = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      if (canViewAll && user?.token) {
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/plantaciones`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.plantaciones) {
            setState(prev => ({ ...prev, plantaciones: data.plantaciones, loading: false }));
            return;
          }
        }
      }
      // Fallback a BD local
      const data = await getPlantaciones();
      setState(prev => ({ ...prev, plantaciones: data, loading: false }));
    } catch (error) {
      console.error('[SyncMapData] Error al cargar plantaciones:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [canViewAll, user?.token]);

  /**
   * Cargar últimas posiciones de técnicos
   * - Para supervisores/gerentes/admin: desde el servidor (ve TODOS los técnicos)
   * - Para técnicos: desde BD local (solo sus propias posiciones)
   */
  const fetchUltimasPosiciones = useCallback(async () => {
    try {
      if (canViewAll && user?.token) {
        // Supervisor/gerente/admin → obtener de todos los técnicos desde el servidor
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/tracking/ultimas`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.posiciones) {
            setState(prev => ({ ...prev, posiciones: data.posiciones }));
            return;
          }
        }
      }
      // Fallback a BD local
      const data = await getUltimasPosicionesTecnicos();
      setState(prev => ({ ...prev, posiciones: data }));
    } catch (error) {
      console.error('[SyncMapData] Error al cargar posiciones:', error);
    }
  }, [canViewAll, user?.token]);

  /**
   * Cargar todas las mediciones
   * - Para supervisores/gerentes/admin: desde el servidor (ve TODAS)
   * - Para técnicos: desde BD local (solo sus propias)
   */
  const fetchAllMediciones = useCallback(async () => {
    try {
      if (canViewAll && user?.token) {
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/mediciones`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.mediciones) {
            setState(prev => ({ ...prev, mediciones: data.mediciones }));
            return;
          }
        }
      }
      // Fallback a BD local
      const data = await getMediciones();
      setState(prev => ({ ...prev, mediciones: data }));
    } catch (error) {
      console.error('[SyncMapData] Error al cargar mediciones:', error);
    }
  }, [canViewAll, user?.token]);

  /**
   * Cargar todos los datos del mapa
   */
  const loadAll = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    await Promise.all([
      fetchAllPlantaciones(),
      fetchUltimasPosiciones(),
      fetchAllMediciones(),
    ]);
    setState(prev => ({ ...prev, loading: false }));
  }, [fetchAllPlantaciones, fetchUltimasPosiciones, fetchAllMediciones]);

  /**
   * Eliminar una plantación (solo admin — local + servidor)
   */
  const eliminarPlantacion = useCallback(async (id: string) => {
    if (!isAdmin) return;
    try {
      const token = user?.token;
      if (token) {
        await fetch(`${API_CONFIG.BASE_URL}/api/plantaciones/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await deletePlantacionLocal(id);
      setState(prev => ({
        ...prev,
        plantaciones: prev.plantaciones.filter(p => p.id !== id),
      }));
    } catch (error) {
      console.error('[SyncMapData] Error al eliminar plantación:', error);
    }
  }, [isAdmin, user?.token]);

  /**
   * Eliminar una medición (solo admin — local + servidor)
   */
  const eliminarMedicion = useCallback(async (id: string) => {
    if (!isAdmin) return;
    try {
      const token = user?.token;
      if (token) {
        await fetch(`${API_CONFIG.BASE_URL}/api/mediciones/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await deleteMedicionLocal(id);
      setState(prev => ({
        ...prev,
        mediciones: prev.mediciones.filter(m => m.id !== id),
      }));
    } catch (error) {
      console.error('[SyncMapData] Error al eliminar medición:', error);
    }
  }, [isAdmin, user?.token]);

  return {
    ...state,
    syncAll,
    loadAll,
    fetchAllPlantaciones,
    fetchUltimasPosiciones,
    fetchAllMediciones,
    eliminarPlantacion,
    eliminarMedicion,
  };
}
