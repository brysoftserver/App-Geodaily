// ============================================================
// GEODAILY — Hook de Tracking GPS en Tiempo Real
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PosicionTracking } from '../types';

const STORAGE_KEY = '@geodaily/tracking_active';
const TRACKING_INTERVAL_MS = 15000; // 15 segundos

let db: SQLite.SQLiteDatabase | null = null;

const initDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (!db) {
    db = await SQLite.openDatabaseAsync('geodaily.db');
  }
  return db;
};

interface TrackingState {
  activo: boolean;
  posiciones: PosicionTracking[];
  inicio?: string;
  distanceKm: number;
}

interface UseTrackingReturn extends TrackingState {
  iniciarTracking: () => Promise<void>;
  detenerTracking: () => Promise<PosicionTracking[]>;
  posicionesHoy: () => Promise<PosicionTracking[]>;
  limpiarHistorial: () => Promise<void>;
}

export const useTracking = (
  usuarioId: string
): UseTrackingReturn => {
  const [state, setState] = useState<TrackingState>({
    activo: false,
    posiciones: [],
    distanceKm: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const posicionesRef = useRef<PosicionTracking[]>([]);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);

  // Cargar estado persistido al montar
  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'true') {
          // Reanudar tracking automáticamente
          iniciarTrackingInterno();
        }
      } catch {}
    };
    loadState();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const iniciarTrackingInterno = useCallback(async () => {
    // Solicitar permisos
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Tracking] Permiso denegado');
      return;
    }

    // Iniciar suscripción a ubicación
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    // Guardar primera posición
    const primeraPos: PosicionTracking = {
      id: `track_${Date.now()}`,
      usuario_id: usuarioId,
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
          primeraPos.id,
          primeraPos.usuario_id,
          primeraPos.latitud,
          primeraPos.longitud,
          primeraPos.altitud ?? null,
          primeraPos.precision_gps ?? null,
          primeraPos.velocidad ?? null,
          primeraPos.heading ?? null,
          primeraPos.timestamp,
          primeraPos.sincronizado ? 1 : 0,
        ]
      );
    } catch (e) {
      console.warn('[Tracking] Error al persistir:', e);
    }

    setState((prev) => ({
      ...prev,
      activo: true,
      posiciones: [primeraPos],
      inicio: new Date().toISOString(),
    }));

    // Intervalo periódico
    intervalRef.current = setInterval(async () => {
      try {
        const newPos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const posicion: PosicionTracking = {
          id: `track_${Date.now()}`,
          usuario_id: usuarioId,
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
          const dist = 6371 * c; // km

          setState((prev) => ({
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
              posicion.id,
              posicion.usuario_id,
              posicion.latitud,
              posicion.longitud,
              posicion.altitud ?? null,
              posicion.precision_gps ?? null,
              posicion.velocidad ?? null,
              posicion.heading ?? null,
              posicion.timestamp,
              posicion.sincronizado ? 1 : 0,
            ]
          );
        } catch (e) {
          console.warn('[Tracking] Error al persistir:', e);
        }
      } catch (error) {
        console.warn('[Tracking] Error en intervalo:', error);
      }
    }, TRACKING_INTERVAL_MS);

    await AsyncStorage.setItem(STORAGE_KEY, 'true');
  }, [usuarioId]);

  const iniciarTracking = useCallback(async () => {
    await iniciarTrackingInterno();
  }, [iniciarTrackingInterno]);

  const detenerTracking = useCallback(async (): Promise<PosicionTracking[]> => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    await AsyncStorage.setItem(STORAGE_KEY, 'false');

    setState((prev) => ({
      ...prev,
      activo: false,
    }));

    return posicionesRef.current;
  }, []);

  const posicionesHoy = useCallback(async (): Promise<PosicionTracking[]> => {
    try {
      const database = await initDb();
      const hoy = new Date().toISOString().split('T')[0];
      const rows = await database.getAllAsync<any>(
        `SELECT * FROM tracking_posiciones
         WHERE usuario_id = ? AND timestamp >= ?
         ORDER BY timestamp ASC`,
        [usuarioId, hoy]
      );
      return rows.map((r: any) => ({
        id: r.id,
        usuario_id: r.usuario_id,
        latitud: r.latitud,
        longitud: r.longitud,
        altitud: r.altitud ?? undefined,
        precision_gps: r.precision_gps ?? undefined,
        velocidad: r.velocidad ?? undefined,
        heading: r.heading ?? undefined,
        timestamp: r.timestamp,
        sincronizado: r.sincronizado === 1,
      }));
    } catch (error) {
      console.error('[Tracking] Error al obtener historial:', error);
      return [];
    }
  }, [usuarioId]);

  const limpiarHistorial = useCallback(async () => {
    try {
      const database = await initDb();
      await database.runAsync(
        'DELETE FROM tracking_posiciones WHERE usuario_id = ?',
        [usuarioId]
      );
      posicionesRef.current = [];
      setState((prev) => ({ ...prev, posiciones: [], distanceKm: 0 }));
    } catch (error) {
      console.error('[Tracking] Error al limpiar:', error);
    }
  }, [usuarioId]);

  return {
    ...state,
    iniciarTracking,
    detenerTracking,
    posicionesHoy,
    limpiarHistorial,
  };
};
