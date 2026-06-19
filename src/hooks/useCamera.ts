// ============================================================
// GEODAILY — Hook de Cámara con Geotag
// ============================================================

import { useState, useCallback } from 'react';
import { useLocation } from './useLocation';
import { FotoGeotag, Coordenadas } from '../types';
import { generarId } from '../utils/formatters';

interface CameraState {
  fotoActual: FotoGeotag | null;
  fotos: FotoGeotag[];
  isLoading: boolean;
  error: string | null;
}

export const useCamera = () => {
  const { getCurrentPosition, coordenadas } = useLocation();
  const [state, setState] = useState<CameraState>({
    fotoActual: null,
    fotos: [],
    isLoading: false,
    error: null,
  });

  const capturarFoto = useCallback(
    async (uri: string, coordsExternas?: Coordenadas): Promise<FotoGeotag | null> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Usar coordenadas externas si se proporcionan, o las cacheadas, o pedir GPS
        let coords: Coordenadas | null = coordsExternas || coordenadas;
        if (!coords) {
          coords = await getCurrentPosition();
        }

        const foto: FotoGeotag = {
          id: generarId(),
          uri,
          coordenadas: coords || { latitud: 0, longitud: 0 },
          timestamp: new Date().toISOString(),
          metadata: {
            source: 'camera',
          },
        };

        setState((prev) => ({
          fotoActual: foto,
          fotos: [...prev.fotos, foto],
          isLoading: false,
          error: null,
        }));

        return foto;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Error al capturar la foto',
        }));
        return null;
      }
    },
    [coordenadas, getCurrentPosition]
  );

  const removeFoto = useCallback((fotoId: string) => {
    setState((prev) => ({
      ...prev,
      fotos: prev.fotos.filter((f) => f.id !== fotoId),
      fotoActual: prev.fotoActual?.id === fotoId ? null : prev.fotoActual,
    }));
  }, []);

  const clearFotos = useCallback(() => {
    setState({
      fotoActual: null,
      fotos: [],
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    capturarFoto,
    removeFoto,
    clearFotos,
  };
};
