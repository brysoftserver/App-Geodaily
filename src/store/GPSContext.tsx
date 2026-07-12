// ============================================================
// GEODAILY — Contexto Global de GPS (Tiempo Real)
// ============================================================
// Único watchPositionAsync en toda la app.
// Todas las pantallas consumen la misma posición GPS.
// ============================================================

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';
import { Coordenadas } from '../types';

interface GPSState {
  /** Última posición GPS conocida (siempre actualizada) */
  userLocation: Coordenadas | undefined;
  /** Si el GPS está activo y recibiendo datos */
  gpsActivo: boolean;
  /** Precisión actual en metros */
  precisionActual: number | undefined;
}

interface GPSContextType extends GPSState {
  /** Solicitar una posición puntual (una vez) */
  getCurrentPosition: () => Promise<Coordenadas | null>;
  /** Permitir que un componente "siga" al usuario (centre el mapa) */
  siguiendo: boolean;
  setSiguiendo: (v: boolean) => void;
}

const GPSContext = createContext<GPSContextType | undefined>(undefined);

export const GPSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GPSState>({
    userLocation: undefined,
    gpsActivo: false,
    precisionActual: undefined,
  });
  const [siguiendo, setSiguiendo] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const permissionGranted = useRef(false);

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

        const sub = await Location.watchPositionAsync(
          {
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
              setState({
                userLocation: pos,
                gpsActivo: true,
                precisionActual: accuracy ?? undefined,
              });
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

  return (
    <GPSContext.Provider
      value={{
        ...state,
        getCurrentPosition,
        siguiendo,
        setSiguiendo,
      }}
    >
      {children}
    </GPSContext.Provider>
  );
};

export const useGPS = (): GPSContextType => {
  const ctx = useContext(GPSContext);
  if (!ctx) throw new Error('useGPS debe usarse dentro de GPSProvider');
  return ctx;
};
