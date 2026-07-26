// ============================================================
// GEODAILY — Contexto Global de Tracking GPS
// ============================================================
// OPTIMIZADO: usa GPSContext como fuente única de posición GPS
// en lugar de llamar getCurrentPositionAsync cada 15s.
// Vive al nivel del provider — NO se detiene al cambiar de screen.
// Solo se detiene explícitamente con detenerTracking().
//
// Cada ruta (desde iniciarTracking hasta detenerTracking) tiene un
// `sesion_id` propio, guardado junto con cada posición en SQLite — así el
// historial de rutas puede agrupar y volver a dibujar una ruta completa
// después, en vez de tener todas las posiciones de todos los días mezcladas
// en una sola lista plana.
// ============================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useGPS } from './GPSContext';
import { PosicionTracking, Coordenadas } from '../types';
import { getDbSafe } from '../services/database';

const STORAGE_KEY_ACTIVO = '@geodaily/tracking_active';
const STORAGE_KEY_PAUSADO = '@geodaily/tracking_pausado';
const STORAGE_KEY_SESION = '@geodaily/tracking_sesion_id';
const TRACKING_INTERVAL_MS = 15000; // 15 segundos

interface TrackingState {
  activo: boolean;
  pausado: boolean;
  posiciones: PosicionTracking[];
  inicio?: string;
  distanceKm: number;
}

interface TrackingContextType extends TrackingState {
  iniciarTracking: () => Promise<void>;
  pausarTracking: () => Promise<void>;
  reanudarTracking: () => Promise<void>;
  detenerTracking: () => Promise<PosicionTracking[]>;
}

const TrackingContext = createContext<TrackingContextType | undefined>(undefined);

const initDb = async () => {
  const database = await getDbSafe();
  if (!database) {
    throw new Error('BD local no disponible');
  }
  return database;
};

const generarSesionId = () => `sesion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const TrackingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const usuarioId = user?.id;
  const { userLocation: gpsPosition } = useGPS();

  const [state, setState] = useState<TrackingState>({
    activo: false,
    pausado: false,
    posiciones: [],
    distanceKm: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const posicionesRef = useRef<PosicionTracking[]>([]);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const usuarioIdRef = useRef(usuarioId);
  const gpsPositionRef = useRef<Coordenadas | undefined>(undefined);
  const sesionIdRef = useRef<string | null>(null);

  // Sincronizar GPSContext → ref para usar en el intervalo sin llamar GPS cada vez
  useEffect(() => {
    gpsPositionRef.current = gpsPosition;
  }, [gpsPosition]);

  // Mantener ref actualizada del usuario
  useEffect(() => {
    usuarioIdRef.current = usuarioId;
  }, [usuarioId]);

  /** Inserta una posición en SQLite, siempre con el sesion_id de la ruta activa. */
  const persistirPosicion = useCallback(async (pos: PosicionTracking, reemplazar: boolean) => {
    try {
      const database = await initDb();
      await database.runAsync(
        `INSERT ${reemplazar ? 'OR REPLACE' : ''} INTO tracking_posiciones (
          id, usuario_id, latitud, longitud, altitud, precision_gps,
          velocidad, heading, timestamp, sincronizado, sesion_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pos.id, pos.usuario_id, pos.latitud, pos.longitud, pos.altitud ?? null,
          pos.precision_gps ?? null, pos.velocidad ?? null, pos.heading ?? null,
          pos.timestamp, pos.sincronizado ? 1 : 0, sesionIdRef.current,
        ]
      );
    } catch (e) {
      console.warn('[TrackingContext] Error al persistir:', e);
    }
  }, []);

  /** Arranca (o reanuda) el intervalo de 15s que va agregando posiciones a la ruta activa. */
  const iniciarIntervalo = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      if (!usuarioIdRef.current) return;
      const currentGps = gpsPositionRef.current;
      if (!currentGps) return; // Sin GPS aún, esperar próxima iteración

      const posicion: PosicionTracking = {
        id: `track_${Date.now()}`,
        usuario_id: usuarioIdRef.current,
        latitud: currentGps.latitud,
        longitud: currentGps.longitud,
        altitud: currentGps.altitud,
        precision_gps: currentGps.precision_gps,
        heading: currentGps.heading,
        velocidad: undefined,
        timestamp: new Date().toISOString(),
        sincronizado: false,
      };

      if (lastPosRef.current) {
        const dlat = ((posicion.latitud - lastPosRef.current.lat) * Math.PI) / 180;
        const dlon = ((posicion.longitud - lastPosRef.current.lon) * Math.PI) / 180;
        const a =
          Math.sin(dlat / 2) ** 2 +
          Math.cos((lastPosRef.current.lat * Math.PI) / 180) *
            Math.cos((posicion.latitud * Math.PI) / 180) *
            Math.sin(dlon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const dist = 6371 * c;

        posicionesRef.current = [...posicionesRef.current, posicion];
        lastPosRef.current = { lat: posicion.latitud, lon: posicion.longitud };

        setState(prev => ({
          ...prev,
          posiciones: posicionesRef.current,
          distanceKm: prev.distanceKm + dist,
        }));

        await persistirPosicion(posicion, false);
      }
    }, TRACKING_INTERVAL_MS);
  }, [persistirPosicion]);

  const iniciarTrackingInterno = useCallback(async (sesionIdExistente?: string) => {
    if (!usuarioIdRef.current) {
      console.warn('[TrackingContext] Sin usuario — no se inicia tracking');
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[TrackingContext] Permiso denegado');
      return;
    }

    sesionIdRef.current = sesionIdExistente || generarSesionId();
    await AsyncStorage.setItem(STORAGE_KEY_SESION, sesionIdRef.current);

    let latitud: number, longitud: number, altitud: number | undefined, precision: number | undefined, heading: number | undefined;
    if (gpsPositionRef.current) {
      latitud = gpsPositionRef.current.latitud;
      longitud = gpsPositionRef.current.longitud;
      altitud = gpsPositionRef.current.altitud;
      precision = gpsPositionRef.current.precision_gps;
      heading = gpsPositionRef.current.heading;
    } else {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitud = pos.coords.latitude;
        longitud = pos.coords.longitude;
        altitud = pos.coords.altitude ?? undefined;
        precision = pos.coords.accuracy ?? undefined;
        heading = pos.coords.heading ?? undefined;
      } catch (err) {
        console.warn('[TrackingContext] No se pudo obtener posición inicial:', err);
        return;
      }
    }

    const primeraPos: PosicionTracking = {
      id: `track_${Date.now()}`,
      usuario_id: usuarioIdRef.current,
      latitud,
      longitud,
      altitud,
      precision_gps: precision,
      heading,
      velocidad: undefined,
      timestamp: new Date().toISOString(),
      sincronizado: false,
    };

    posicionesRef.current = [primeraPos];
    lastPosRef.current = { lat: primeraPos.latitud, lon: primeraPos.longitud };

    await persistirPosicion(primeraPos, true);

    setState(prev => ({
      ...prev,
      activo: true,
      pausado: false,
      posiciones: [primeraPos],
      inicio: new Date().toISOString(),
    }));

    iniciarIntervalo();

    await AsyncStorage.setItem(STORAGE_KEY_ACTIVO, 'true');
    await AsyncStorage.setItem(STORAGE_KEY_PAUSADO, 'false');
  }, [persistirPosicion, iniciarIntervalo]);

  // Restaurar tracking activo al arrancar la app
  useEffect(() => {
    const checkSavedState = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY_ACTIVO);
        if (saved === 'true' && usuarioIdRef.current) {
          console.log('[TrackingContext] Restaurando tracking persistido...');
          const sesionPrevia = await AsyncStorage.getItem(STORAGE_KEY_SESION);
          const pausadoPrevio = await AsyncStorage.getItem(STORAGE_KEY_PAUSADO);
          await iniciarTrackingInterno(sesionPrevia || undefined);
          if (pausadoPrevio === 'true' && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            setState(prev => ({ ...prev, pausado: true }));
          }
        }
      } catch {
          // Ignorar errores al restaurar estado persistido
        }
    };
    checkSavedState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo al montar

  // Limpiar al desmontar el provider (cierre de app)
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const iniciarTracking = useCallback(async () => {
    await iniciarTrackingInterno();
  }, [iniciarTrackingInterno]);

  /** Pausa la ruta activa: deja de agregar puntos, pero conserva todo lo ya trazado (no la detiene ni la cierra). */
  const pausarTracking = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    await AsyncStorage.setItem(STORAGE_KEY_PAUSADO, 'true');
    setState(prev => ({ ...prev, pausado: true }));
  }, []);

  /** Reanuda una ruta pausada — sigue agregando puntos a la MISMA sesión (mismo sesion_id), no crea una ruta nueva. */
  const reanudarTracking = useCallback(async () => {
    if (!sesionIdRef.current) return; // No hay ruta activa que reanudar
    await AsyncStorage.setItem(STORAGE_KEY_PAUSADO, 'false');
    setState(prev => ({ ...prev, pausado: false }));
    iniciarIntervalo();
  }, [iniciarIntervalo]);

  const detenerTracking = useCallback(async (): Promise<PosicionTracking[]> => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    await AsyncStorage.setItem(STORAGE_KEY_ACTIVO, 'false');
    await AsyncStorage.setItem(STORAGE_KEY_PAUSADO, 'false');
    await AsyncStorage.removeItem(STORAGE_KEY_SESION);
    sesionIdRef.current = null;

    setState(prev => ({
      ...prev,
      activo: false,
      pausado: false,
    }));

    return posicionesRef.current;
  }, []);

  const trackingValue = useMemo(() => ({
    activo: state.activo,
    pausado: state.pausado,
    posiciones: state.posiciones,
    inicio: state.inicio,
    distanceKm: state.distanceKm,
    iniciarTracking,
    pausarTracking,
    reanudarTracking,
    detenerTracking,
  }), [state.activo, state.pausado, state.posiciones, state.inicio, state.distanceKm, iniciarTracking, pausarTracking, reanudarTracking, detenerTracking]);

  return (
    <TrackingContext.Provider value={trackingValue}>
      {children}
    </TrackingContext.Provider>
  );
};

export const useTrackingContext = (): TrackingContextType => {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTrackingContext debe usarse dentro de TrackingProvider');
  return ctx;
};
