// ============================================================
// GEODAILY — Hook de Geolocalización
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { Coordenadas, GeoReferencia } from '../types';
import { getGeoreference } from '../services/georeference.service';

interface LocationState {
  coordenadas: Coordenadas | null;
  georeferencia: GeoReferencia | null;
  isLoading: boolean;
  error: string | null;
  permissionStatus: Location.PermissionStatus | null;
}

export const useLocation = () => {
  const [state, setState] = useState<LocationState>({
    coordenadas: null,
    georeferencia: null,
    isLoading: false,
    error: null,
    permissionStatus: null,
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

  const getCurrentPosition = useCallback(async (): Promise<Coordenadas | null> => {
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

      // 1. Intentar GPS con alta precisión
      let position;
      try {
        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
      } catch (gpsError) {
        // 2. Fallback: última posición conocida (últimos 60 segundos)
        console.warn('[useLocation] GPS falló, intentando última conocida:', gpsError);
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
        if (last) {
          position = last;
        } else {
          throw new Error('GPS no disponible y sin última posición conocida');
        }
      }

      const coords: Coordenadas = {
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
        altitud: position.coords.altitude ?? undefined,
        precision_gps: position.coords.accuracy ?? undefined,
        heading: position.coords.heading ?? undefined,
        timestamp: new Date(position.timestamp).toISOString(),
      };

      // Obtener georreferenciación del servidor (con fallback local)
      const geo = await getGeoreference(
        coords.latitud,
        coords.longitud,
        coords.altitud
      );

      setState({
        coordenadas: coords,
        georeferencia: geo,
        isLoading: false,
        error: null,
        permissionStatus: state.permissionStatus,
      });

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
  }, [requestPermissions, state.permissionStatus]);

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
