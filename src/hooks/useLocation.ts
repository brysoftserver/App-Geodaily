// ============================================================
// GEODAILY — Hook de Geolocalización
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { Coordenadas, GeoReferencia } from '../types';
import { getGeoreference } from '../services/georeference.service';

/**
 * Tiempo máximo que se espera una lectura GPS "fresca" antes de rendirse y
 * usar la última posición conocida. En campo, sin cielo despejado, el GPS
 * puede tardar minutos o no responder nunca: `getCurrentPositionAsync` NO
 * acepta un `timeout` (expo-location 19) y expo no lo cancela por sí solo,
 * así que la promesa se quedaba colgada para siempre y la captura de foto
 * —que espera esta promesa— se quedaba en "capturando…" indefinidamente.
 * Ese era el reporte de los técnicos: "aparecía capturando y duraba minutos".
 */
const GPS_TIMEOUT_MS = 12000;

/**
 * Edad máxima aceptada para la "última posición conocida". Antes eran 60 s,
 * demasiado estricto en veredas sin señal: si el técnico no había tenido fix
 * en el último minuto, el fallback también fallaba y no se guardaba nada.
 */
const ULTIMA_POSICION_MAX_AGE_MS = 30 * 60 * 1000;

/** Tope para la georreferenciación (llamada de red). No debe bloquear. */
const GEOREF_TIMEOUT_MS = 6000;

const conTimeout = <T,>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${etiqueta} excedió ${ms} ms`)), ms);
    promesa.then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

interface LocationState {
  coordenadas: Coordenadas | null;
  georeferencia: GeoReferencia | null;
  isLoading: boolean;
  error: string | null;
  permissionStatus: Location.PermissionStatus | null;
  /**
   * Si el servicio de ubicación del teléfono está ENCENDIDO (hardware).
   * Distinto del permiso: puede estar concedido y el GPS apagado. En ese
   * caso `getCurrentPositionAsync` nunca resuelve y la captura se cuelga.
   * `undefined` = aún sin verificar.
   */
  gpsHabilitado: boolean | undefined;
}

interface OpcionesPosicion {
  /** Tiempo máximo de espera de una lectura fresca (ms). */
  timeoutMs?: number;
  /** Precisión solicitada. Por defecto `High`; usar `Balanced` para un fix más rápido. */
  accuracy?: Location.Accuracy;
  /**
   * Si es `true`, espera la georreferenciación (llamada de red, con su propio
   * timeout) antes de resolver. Por defecto `false`: devolver coordenadas
   * rápido es lo que importa en campo, la georreferencia llega después.
   */
  esperarGeoreferencia?: boolean;
}

export const useLocation = () => {
  const [state, setState] = useState<LocationState>({
    coordenadas: null,
    georeferencia: null,
    isLoading: false,
    error: null,
    permissionStatus: null,
    gpsHabilitado: undefined,
  });

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setState((prev) => ({ ...prev, permissionStatus: status }));
      return status === 'granted';
    } catch {
      setState((prev) => ({
        ...prev,
        error: 'No se pudo solicitar permiso de ubicación',
      }));
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(
    async (opciones: OpcionesPosicion = {}): Promise<Coordenadas | null> => {
      const {
        timeoutMs = GPS_TIMEOUT_MS,
        accuracy = Location.Accuracy.High,
        esperarGeoreferencia = false,
      } = opciones;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const hasPermission = await requestPermissions();
        if (!hasPermission) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Permiso de ubicación denegado',
          }));
          return null;
        }

        // 0. Verificar que el servicio de ubicación esté ENCENDIDO. Si está
        //    apagado, `getCurrentPositionAsync` se queda colgado hasta el
        //    timeout y luego cae a una posición vieja/nula. Mejor detectarlo
        //    de inmediato y avisar al técnico que encienda el GPS para el
        //    trabajo offline.
        const gpsHabilitado = await Location.hasServicesEnabledAsync().catch(() => true);
        setState((prev) => ({ ...prev, gpsHabilitado }));
        if (!gpsHabilitado) {
          // Intentar al menos la última posición conocida (puede servir para
          // georreferenciar la foto aunque el GPS esté apagado ahora mismo).
          let ultima: Location.LocationObject | null = null;
          try {
            ultima = await Location.getLastKnownPositionAsync({
              maxAge: ULTIMA_POSICION_MAX_AGE_MS,
            });
          } catch {
            ultima = null;
          }
          if (ultima) {
            const coords: Coordenadas = {
              latitud: ultima.coords.latitude,
              longitud: ultima.coords.longitude,
              altitud: ultima.coords.altitude ?? undefined,
              precision_gps: ultima.coords.accuracy ?? undefined,
              heading: ultima.coords.heading ?? undefined,
              timestamp: new Date(ultima.timestamp).toISOString(),
            };
            setState((prev) => ({
              ...prev,
              coordenadas: coords,
              isLoading: false,
              error: 'El GPS del teléfono está desactivado. Enciéndelo para el trabajo offline.',
            }));
            return coords;
          }
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: 'El GPS del teléfono está desactivado. Enciéndelo para el trabajo offline.',
          }));
          return null;
        }

        // 1. Intentar GPS con la precisión pedida, pero con tope de tiempo.
        let position: Location.LocationObject | null = null;
        try {
          position = await conTimeout(
            Location.getCurrentPositionAsync({ accuracy }),
            timeoutMs,
            'GPS'
          );
        } catch (gpsError) {
          console.warn('[useLocation] GPS no respondió a tiempo:', gpsError);
          // 2. Fallback: última posición conocida (hasta 30 min de antigüedad).
          try {
            position = await Location.getLastKnownPositionAsync({
              maxAge: ULTIMA_POSICION_MAX_AGE_MS,
            });
          } catch {
            position = null;
          }
          if (!position) {
            // Sin fix y sin caché: se informa pero NO se deja la UI colgada.
            setState((prev) => ({
              ...prev,
              isLoading: false,
              error: 'Sin señal GPS. Sal a cielo abierto e inténtalo de nuevo.',
            }));
            return null;
          }
          console.log('[useLocation] Usando última posición conocida');
        }

        const coords: Coordenadas = {
          latitud: position.coords.latitude,
          longitud: position.coords.longitude,
          altitud: position.coords.altitude ?? undefined,
          precision_gps: position.coords.accuracy ?? undefined,
          heading: position.coords.heading ?? undefined,
          timestamp: new Date(position.timestamp).toISOString(),
        };

        setState((prev) => ({
          ...prev,
          coordenadas: coords,
          isLoading: false,
          error: null,
        }));

        // 3. Georreferenciación (LUGAR/MGRS…). Es una llamada de red: si se
        //    espera aquí, una conexión mala vuelve a colgar la captura. Se
        //    resuelve en segundo plano salvo que el llamador la exija.
        const resolverGeo = async () => {
          try {
            const geo = await conTimeout(
              getGeoreference(coords.latitud, coords.longitud, coords.altitud),
              GEOREF_TIMEOUT_MS,
              'Georreferencia'
            );
            setState((prev) => ({ ...prev, georeferencia: geo }));
          } catch {
            // Sin conexión: la georreferencia local se calcula dentro de
            // getGeoreference; si tampoco, simplemente no se muestra.
          }
        };

        if (esperarGeoreferencia) {
          await resolverGeo();
        } else {
          resolverGeo();
        }

        return coords;
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : 'No se pudo obtener la ubicación GPS';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: mensaje,
        }));
        return null;
      }
    },
    [requestPermissions]
  );

  // Solicitar permisos al montar el hook
  useEffect(() => {
    requestPermissions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    requestPermissions,
    getCurrentPosition,
  };
};
