// ============================================================
// GEODAILY — Hook de Cámara con Geotag
// ============================================================

import { useState, useCallback } from 'react';
import { useLocation } from './useLocation';
import { FotoGeotag, Coordenadas } from '../types';
import { generarId } from '../utils/formatters';
import { persistirEvidencia } from '../services/mediaStorage.service';

interface CameraState {
  fotoActual: FotoGeotag | null;
  fotos: FotoGeotag[];
  isLoading: boolean;
  error: string | null;
}

/** De dónde sale la evidencia: captura en terreno o archivo ya existente. */
export type OrigenEvidencia = 'camara' | 'almacenamiento';

export interface OpcionesEvidencia {
  /**
   * 'almacenamiento' = la foto/video ya existía en el teléfono (galería).
   * En ese caso NO se consulta el GPS ni se generan datos de captura: la
   * imagen no se tomó en esta visita, así que ponerle coordenadas y hora
   * sería un dato falso (y quedaba quemado en el píxel por la marca de
   * agua del backend).
   */
  origen?: OrigenEvidencia;
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
    async (
      uri: string,
      coordsExternas?: Coordenadas,
      esVideo = false,
      opciones?: OpcionesEvidencia
    ): Promise<FotoGeotag | null> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const desdeAlmacenamiento = opciones?.origen === 'almacenamiento';

      try {
        // Evidencia del almacenamiento: ni GPS ni datos de captura. Se toma
        // la imagen tal como está en el teléfono.
        if (desdeAlmacenamiento) {
          const id = generarId();
          const uriPersistente = await persistirEvidencia(uri, id, esVideo);
          const foto: FotoGeotag = {
            id,
            uri: uriPersistente,
            tipo: esVideo ? 'video' : 'foto',
            // Sin ubicación real: 0,0 nunca se usa para una evidencia de
            // almacenamiento (no se guarda ni se envía) y la UI lo distingue
            // por metadata.origen.
            coordenadas: { latitud: 0, longitud: 0 },
            timestamp: new Date().toISOString(),
            metadata: {
              source: 'storage',
              origen: 'almacenamiento',
              sinUbicacion: true,
              sinMetadatos: true,
            },
          };
          setState((prev) => ({
            fotoActual: foto,
            fotos: [...prev.fotos, foto],
            isLoading: false,
            error: null,
          }));
          return foto;
        }

        // Pedir SIEMPRE una posición fresca. Antes se reutilizaba la caché de
        // `useLocation` (que no tiene watch continuo), así que solo la primera
        // foto consultaba el GPS: el técnico recorría la finca y las 10 fotos
        // quedaban con las mismas coordenadas. El geotag —razón de ser del
        // módulo— era falso a partir de la segunda foto.
        let coords: Coordenadas | null = coordsExternas || null;
        if (!coords) {
          try {
            coords = await getCurrentPosition();
          } catch (gpsErr) {
            console.warn('[Camara] No se pudo obtener GPS fresco:', gpsErr);
          }
        }
        // Último recurso: la última posición conocida, mejor que nada
        if (!coords) coords = coordenadas;

        const id = generarId();

        // Sacar la evidencia de la caché del sistema ANTES de registrarla:
        // Android puede vaciar cacheDirectory sin avisar y en campo eso
        // significaba perder fotos y videos aún sin sincronizar.
        const uriPersistente = await persistirEvidencia(uri, id, esVideo);

        // Sin GPS se marca explícitamente. Antes se guardaba {0,0} —el Golfo de
        // Guinea— sin avisar, y esa evidencia acababa en el mapa y en el PDF
        // como un punto perfectamente válido.
        const sinUbicacion = !coords;
        if (sinUbicacion) {
          console.warn('[Camara] Evidencia capturada SIN ubicación GPS:', id);
        }

        const foto: FotoGeotag = {
          id,
          uri: uriPersistente,
          tipo: esVideo ? 'video' : 'foto',
          coordenadas: coords || { latitud: 0, longitud: 0 },
          timestamp: new Date().toISOString(),
          metadata: {
            source: 'camera',
            sinUbicacion,
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

  const setFotos = useCallback((fotosArray: FotoGeotag[]) => {
    setState({
      fotoActual: null,
      fotos: fotosArray,
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    capturarFoto,
    removeFoto,
    clearFotos,
    setFotos,
  };
};
