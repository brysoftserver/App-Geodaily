// ============================================================
// GEODAILY — Contexto Global de GPS (Tiempo Real)
// ============================================================
// Único watchPositionAsync en toda la app.
// Todas las pantallas consumen la misma posición GPS.
// ============================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Coordenadas } from '../types';
import { useAuth } from './AuthContext';
import { useSync } from './SyncContext';
import { getDbSafe } from '../services/database';

/**
 * Cada cuánto (ms) se persiste como máximo una posición "automática" en
 * SQLite. El watch emite cada ~15s, pero no queremos escribir en disco en
 * cada emisión: basta con dejar la última posición conocida del técnico
 * fresca para que el mapa la muestre. 60s es suficiente para que el
 * gerente vea al técnico "en campo" sin saturar la BD ni la red.
 */
const AUTO_PERSIST_INTERVAL_MS = 60000;
/**
 * Distancia mínima (metros) que debe haberse movido el técnico para forzar
 * una escritura aunque no haya pasado el intervalo. Así, si el técnico se
 * desplaza rápido, el mapa lo sigue sin esperar al minuto completo.
 */
const AUTO_PERSIST_MIN_MOVE_M = 25;
/**
 * `sesion_id` reservado para las posiciones automáticas (las que se guardan
 * solo porque el GPS está encendido, sin que el técnico haya pulsado
 * "Iniciar seguimiento"). Se mantiene separado de las rutas manuales para
 * no mezclar el historial de rutas con estas muestras sueltas.
 */
const AUTO_SESION_ID = 'auto_gps';
/**
 * Clave de AsyncStorage que usa TrackingContext para marcar que hay una ruta
 * manual activa. Si está activa, la persistencia automática se salta: el
 * tracking manual ya está guardando posiciones cada 15s y no queremos
 * duplicarlas en el mapa.
 */
const STORAGE_KEY_TRACKING_ACTIVO = '@geodaily/tracking_active';

/** Distancia Haversine en metros entre dos coordenadas. */
const distanciaMetros = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

interface GPSState {
  /** Última posición GPS conocida (siempre actualizada) */
  userLocation: Coordenadas | undefined;
  /** Si el GPS está activo y recibiendo datos */
  gpsActivo: boolean;
  /** Precisión actual en metros */
  precisionActual: number | undefined;
  /**
   * Si el servicio de ubicación del teléfono está ENCENDIDO (hardware).
   * Es distinto del permiso: el permiso puede estar concedido y el GPS
   * apagado — en ese caso el watch nunca emite posiciones y la app se
   * quedaba "esperando" sin explicar por qué. `undefined` = aún sin verificar.
   */
  gpsHabilitado: boolean | undefined;
}

interface GPSContextType extends GPSState {
  /** Solicitar una posición puntual (una vez) */
  getCurrentPosition: () => Promise<Coordenadas | null>;
  /** Permitir que un componente "siga" al usuario (centre el mapa) */
  siguiendo: boolean;
  setSiguiendo: (v: boolean) => void;
  /**
   * Verifica si el servicio de ubicación del teléfono está encendido.
   * Útil para mostrar un aviso claro antes de intentar capturar GPS.
   */
  verificarGpsHabilitado: () => Promise<boolean>;
}

const GPSContext = createContext<GPSContextType | undefined>(undefined);

export const GPSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { syncNow } = useSync();
  const usuarioId = user?.id;
  const [state, setState] = useState<GPSState>({
    userLocation: undefined,
    gpsActivo: false,
    precisionActual: undefined,
    gpsHabilitado: undefined,
  });
  const [siguiendo, setSiguiendo] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const permissionGranted = useRef(false);

  // --- Persistencia automática de la última posición del técnico ---
  // El watch de arriba corre durante toda la vida de la app, pero antes su
  // resultado solo vivía en memoria: si el técnico no pulsaba "Iniciar
  // seguimiento", su posición nunca se guardaba ni se subía, y el mapa del
  // gerente mostraba datos viejos aunque el técnico estuviera en campo.
  // Este efecto cierra ese hueco: cada vez que llega una posición nueva y
  // hay usuario autenticado, se deja la última posición en SQLite con
  // `sincronizado = 0`, y el SyncContext la sube sola (POST /tracking/sync).
  const lastAutoPersistRef = useRef<{ lat: number; lon: number; ts: number } | null>(null);
  const usuarioIdRef = useRef(usuarioId);
  const syncNowRef = useRef(syncNow);
  useEffect(() => {
    usuarioIdRef.current = usuarioId;
  }, [usuarioId]);
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    const pos = state.userLocation;
    const uid = usuarioIdRef.current;
    if (!pos || !uid) return;

    const ahora = Date.now();
    const prev = lastAutoPersistRef.current;
    if (prev) {
      const transcurrido = ahora - prev.ts;
      const movido = distanciaMetros(prev.lat, prev.lon, pos.latitud, pos.longitud);
      // Escribir solo si pasó el intervalo O si se movió lo suficiente.
      if (transcurrido < AUTO_PERSIST_INTERVAL_MS && movido < AUTO_PERSIST_MIN_MOVE_M) {
        return;
      }
    }

    lastAutoPersistRef.current = { lat: pos.latitud, lon: pos.longitud, ts: ahora };

    (async () => {
      try {
        // Si el técnico tiene una ruta manual activa, el TrackingContext ya
        // está guardando posiciones cada 15s — no duplicar.
        const trackingActivo = await AsyncStorage.getItem(STORAGE_KEY_TRACKING_ACTIVO);
        if (trackingActivo === 'true') return;

        const database = await getDbSafe();
        if (!database) return;
        // El backend hace `ON CONFLICT (usuario_id, id_local) DO NOTHING`, así
        // que cada muestra necesita un id_local ÚNICO para que el servidor
        // registre la posición nueva (si no, se quedaría con la primera para
        // siempre). Se usa un id con timestamp.
        const idLocal = `auto_${uid}_${ahora}`;
        await database.runAsync(
          `INSERT OR REPLACE INTO tracking_posiciones (
            id, usuario_id, latitud, longitud, altitud, precision_gps,
            velocidad, heading, timestamp, sincronizado, sesion_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            idLocal,
            uid,
            pos.latitud,
            pos.longitud,
            pos.altitud ?? null,
            pos.precision_gps ?? null,
            null,
            pos.heading ?? null,
            pos.timestamp ?? new Date().toISOString(),
            0,
            AUTO_SESION_ID,
          ]
        );
        // Limpieza: borrar muestras automáticas YA sincronizadas para no
        // acumular filas en SQLite (el servidor conserva el historial).
        await database.runAsync(
          `DELETE FROM tracking_posiciones
           WHERE sesion_id = ? AND usuario_id = ? AND sincronizado = 1`,
          [AUTO_SESION_ID, uid]
        );

        // Empujar la posición al servidor de inmediato (si hay red). El
        // SyncContext sube todo lo pendiente; si falla, la cola reintenta.
        syncNowRef.current?.().catch(() => { /* la cola reintenta */ });
      } catch (e) {
        console.warn('[GPSContext] Error al persistir posición automática:', e);
      }
    })();
  }, [state.userLocation]);

  /**
   * Comprueba si el servicio de ubicación del teléfono está encendido.
   * `hasServicesEnabledAsync` es la única forma fiable de distinguir
   * "permiso concedido pero GPS apagado" de "GPS encendido sin fix".
   * Nunca lanza: si la API falla, se asume `true` para no bloquear el flujo
   * (mejor intentar el watch que impedir el trabajo por un falso negativo).
   */
  const verificarGpsHabilitado = useCallback(async (): Promise<boolean> => {
    try {
      const habilitado = await Location.hasServicesEnabledAsync();
      setState((prev) => ({ ...prev, gpsHabilitado: habilitado }));
      return habilitado;
    } catch {
      // Si no se puede verificar, no se bloquea: se asume encendido.
      return true;
    }
  }, []);

  // Iniciar watch GPS al montar el provider (vida de la app)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[GPSContext] Permiso GPS denegado');
          return;
        }
        permissionGranted.current = true;

        // Verificar que el servicio de ubicación esté ENCENDIDO antes de
        // suscribirse. Si está apagado, el watch se quedaría "vivo" pero
        // mudo (nunca emite posiciones) y la app parecería tener GPS cuando
        // en realidad no hay fix posible. Se registra el estado para que la
        // UI pueda avisar al técnico.
        const habilitado = await Location.hasServicesEnabledAsync().catch(() => true);
        if (!cancelled) {
          setState((prev) => ({ ...prev, gpsHabilitado: habilitado }));
        }
        if (!habilitado) {
          console.warn('[GPSContext] Servicio de ubicación APAGADO en el teléfono');
          return;
        }

        const sub = await Location.watchPositionAsync(
          {
            // `Balanced` + 15 s era demasiado lento para el mapa en campo:
            // el punto azul se quedaba atrás mientras el técnico caminaba.
            // `High` con 5 s / 5 m da seguimiento casi en tiempo real y
            // sigue funcionando sin internet (el GPS del teléfono es local).
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (newPos) => {
            const { latitude, longitude, accuracy, altitude, heading } = newPos.coords;
            const pos: Coordenadas = {
              latitud: latitude,
              longitud: longitude,
              altitud: altitude ?? undefined,
              precision_gps: accuracy ?? undefined,
              heading: heading ?? undefined,
              timestamp: new Date(newPos.timestamp).toISOString(),
            };
            if (!cancelled) {
              setState((prev) => ({
                ...prev,
                userLocation: pos,
                gpsActivo: true,
                precisionActual: accuracy ?? undefined,
                gpsHabilitado: true,
              }));
            }
          }
        );
        if (!cancelled) {
          watchRef.current = sub;
        } else {
          sub.remove();
        }
      } catch (error) {
        console.warn('[GPSContext] Error al iniciar watch:', error);
      }
    })();

    return () => {
      cancelled = true;
      if (watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    };
  }, []);

  // Obtener una posición puntual (útil para "Mi ubicación ahora")
  const getCurrentPosition = useCallback(async (): Promise<Coordenadas | null> => {
    try {
      if (!permissionGranted.current) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        permissionGranted.current = true;
      }

      // Si el servicio de ubicación está apagado, no tiene sentido esperar
      // un fix: se devuelve la última posición conocida (si la hay) y se
      // deja constancia del estado para que la UI avise al técnico.
      const habilitado = await Location.hasServicesEnabledAsync().catch(() => true);
      setState((prev) => ({ ...prev, gpsHabilitado: habilitado }));
      if (!habilitado) {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 30000 }).catch(() => null);
        if (last) {
          return {
            latitud: last.coords.latitude,
            longitud: last.coords.longitude,
            altitud: last.coords.altitude ?? undefined,
            precision_gps: last.coords.accuracy ?? undefined,
            heading: last.coords.heading ?? undefined,
            timestamp: new Date(last.timestamp).toISOString(),
          };
        }
        return state.userLocation || null;
      }

      let position;
      try {
        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
      } catch {
        // Fallback: última conocida
        const last = await Location.getLastKnownPositionAsync({ maxAge: 30000 });
        if (last) {
          position = last;
        } else {
          return state.userLocation || null;
        }
      }

      return {
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
        altitud: position.coords.altitude ?? undefined,
        precision_gps: position.coords.accuracy ?? undefined,
        heading: position.coords.heading ?? undefined,
        timestamp: new Date(position.timestamp).toISOString(),
      };
    } catch {
      return state.userLocation || null;
    }
  }, [state.userLocation]);

  const contextValue = useMemo(() => ({
    ...state,
    getCurrentPosition,
    siguiendo,
    setSiguiendo,
    verificarGpsHabilitado,
  }), [state, getCurrentPosition, siguiendo, setSiguiendo, verificarGpsHabilitado]);

  return (
    <GPSContext.Provider value={contextValue}>
      {children}
    </GPSContext.Provider>
  );
};

export const useGPS = (): GPSContextType => {
  const ctx = useContext(GPSContext);
  if (!ctx) throw new Error('useGPS debe usarse dentro de GPSProvider');
  return ctx;
};
