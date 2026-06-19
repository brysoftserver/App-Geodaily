// ============================================================
// GEODAILY — Hook de Geolocalización
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { Coordenadas } from '../types';
import { getGeoreference } from '../services/georeference.service';
import { GeoReferencia } from '../types';

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

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

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
      const errorMsg = 'No se pudo obtener la ubicación GPS';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
      return null;
    }
  }, [requestPermissions, state.permissionStatus]);

  // Solicitar permisos al montar el hook
  useEffect(() => {
    requestPermissions();
  }, []);

  return {
    ...state,
    requestPermissions,
    getCurrentPosition,
  };
};
