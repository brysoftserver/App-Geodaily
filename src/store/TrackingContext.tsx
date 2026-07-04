// ============================================================
// GEODAILY — Contexto Global de Tracking GPS
// ============================================================
// Vive al nivel del provider — NO se detiene al cambiar de screen.
// Solo se detiene explícitamente con detenerTracking().
// ============================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { PosicionTracking } from '../types';

const STORAGE_KEY = '@geodaily/tracking_active';
const TRACKING_INTERVAL_MS = 15000; // 15 segundos

interface TrackingState {
  activo: boolean;
  posiciones: PosicionTracking[];
  inicio?: string;
  distanceKm: number;
}

interface TrackingContextType extends TrackingState {
  iniciarTracking: () => Promise<void>;
  detenerTracking: () => Promise<PosicionTracking[]>;
}

const TrackingContext = createContext<TrackingContextType | undefined>(undefined);

let db: SQLite.SQLiteDatabase | null = null;

const initDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('geodaily.db');
  }
  return db;
};

export const TrackingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const usuarioId = user?.id;

  const [state, setState] = useState<TrackingState>({
    activo: false,
    posiciones: [],
    distanceKm: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const posicionesRef = useRef<PosicionTracking[]>([]);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const usuarioIdRef = useRef(usuarioId);

  // Mantener ref actualizada del usuario
  useEffect(() => {
    usuarioIdRef.current = usuarioId;
  }, [usuarioId]);

  // Restaurar tracking activo al arrancar la app
  useEffect(() => {
    const checkSavedState = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'true' && usuarioIdRef.current) {
          console.log('[TrackingContext] Restaurando tracking persistido...');
          await iniciarTrackingInterno();
        }
      } catch {}
    };
    checkSavedState();
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

  const iniciarTrackingInterno = useCallback(async () => {
    if (!usuarioIdRef.current) {
      console.warn('[TrackingContext] Sin usuario — no se inicia tracking');
      return;
    }

    // Solicitar permisos
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[TrackingContext] Permiso denegado');
      return;
    }

    // Primera posición
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const primeraPos: PosicionTracking = {
      id: `track_${Date.now()}`,
      usuario_id: usuarioIdRef.current,
      latitud: pos.coords.latitude,
      longitud: pos.coords.longitude,
      altitud: pos.coords.altitude ?? undefined,
      precision_gps: pos.coords.accuracy ?? undefined,
      heading: pos.coords.heading ?? undefined,
      velocidad: pos.coords.speed ?? undefined,
      timestamp: new Date().toISOString(),
      sincronizado: false,
    };

    posicionesRef.current = [primeraPos];
    lastPosRef.current = { lat: primeraPos.latitud, lon: primeraPos.longitud };

    // Persistir en SQLite
    try {
      const database = await initDb();
      await database.runAsync(
        `INSERT OR REPLACE INTO tracking_posiciones (
          id, usuario_id, latitud, longitud, altitud, precision_gps,
          velocidad, heading, timestamp, sincronizado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          primeraPos.id, primeraPos.usuario_id, primeraPos.latitud,
          primeraPos.longitud, primeraPos.altitud ?? null,
          primeraPos.precision_gps ?? null, primeraPos.velocidad ?? null,
          primeraPos.heading ?? null, primeraPos.timestamp,
          primeraPos.sincronizado ? 1 : 0,
        ]
      );
    } catch (e) {
      console.warn('[TrackingContext] Error al persistir:', e);
    }

    setState(prev => ({
      ...prev,
      activo: true,
      posiciones: [primeraPos],
      inicio: new Date().toISOString(),
    }));

    // Intervalo periódico
    intervalRef.current = setInterval(async () => {
      if (!usuarioIdRef.current) return;
      try {
        const newPos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const posicion: PosicionTracking = {
          id: `track_${Date.now()}`,
          usuario_id: usuarioIdRef.current,
          latitud: newPos.coords.latitude,
          longitud: newPos.coords.longitude,
          altitud: newPos.coords.altitude ?? undefined,
          precision_gps: newPos.coords.accuracy ?? undefined,
          heading: newPos.coords.heading ?? undefined,
          velocidad: newPos.coords.speed ?? undefined,
          timestamp: new Date().toISOString(),
          sincronizado: false,
        };

        posicionesRef.current = [...posicionesRef.current, posicion];

        // Calcular distancia incremental
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

          setState(prev => ({
            ...prev,
            posiciones: posicionesRef.current,
            distanceKm: prev.distanceKm + dist,
          }));
        }
        lastPosRef.current = { lat: posicion.latitud, lon: posicion.longitud };

        // Persistir en SQLite
        try {
          const database = await initDb();
          await database.runAsync(
            `INSERT INTO tracking_posiciones (
              id, usuario_id, latitud, longitud, altitud, precision_gps,
              velocidad, heading, timestamp, sincronizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              posicion.id, posicion.usuario_id, posicion.latitud,
              posicion.longitud, posicion.altitud ?? null,
              posicion.precision_gps ?? null, posicion.velocidad ?? null,
              posicion.heading ?? null, posicion.timestamp,
              posicion.sincronizado ? 1 : 0,
            ]
          );
        } catch (e) {
          console.warn('[TrackingContext] Error al persistir:', e);
        }
      } catch (error) {
        console.warn('[TrackingContext] Error en intervalo:', error);
      }
    }, TRACKING_INTERVAL_MS);

    await AsyncStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  const iniciarTracking = useCallback(async () => {
    await iniciarTrackingInterno();
  }, [iniciarTrackingInterno]);

  const detenerTracking = useCallback(async (): Promise<PosicionTracking[]> => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    await AsyncStorage.setItem(STORAGE_KEY, 'false');

    setState(prev => ({
      ...prev,
      activo: false,
    }));

    return posicionesRef.current;
  }, []);

  return (
    <TrackingContext.Provider
      value={{
        activo: state.activo,
        posiciones: state.posiciones,
        inicio: state.inicio,
        distanceKm: state.distanceKm,
        iniciarTracking,
        detenerTracking,
      }}
    >
      {children}
    </TrackingContext.Provider>
  );
};

export const useTrackingContext = (): TrackingContextType => {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTrackingContext debe usarse dentro de TrackingProvider');
  return ctx;
};
