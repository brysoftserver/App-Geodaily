// ============================================================
// GEODAILY — Hook de Clima
// ============================================================

import { useState, useCallback } from 'react';
import { ClimaActual, ResumenClimatico } from '../types';
import { getResumenClimatico } from '../services/climate.service';

interface ClimateState {
  climaActual: ClimaActual | null;
  resumen: ResumenClimatico | null;
  isLoading: boolean;
  error: string | null;
}

export const useClimate = () => {
  const [state, setState] = useState<ClimateState>({
    climaActual: null,
    resumen: null,
    isLoading: false,
    error: null,
  });

  const fetchClimate = useCallback(async (lat: number, lon: number) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const resumen = await getResumenClimatico(lat, lon);

      if (!resumen) {
        setState({
          climaActual: null,
          resumen: null,
          isLoading: false,
          error: 'No se pudieron obtener datos climáticos — verifica conexión y autenticación',
        });
        return;
      }

      setState({
        climaActual: resumen?.actual || null,
        resumen,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error desconocido al obtener datos climáticos';
      console.error('[useClimate] Error inesperado:', msg);
      setState({
        climaActual: null,
        resumen: null,
        isLoading: false,
        error: `Error climático: ${msg}`,
      });
    }
  }, []);

  return {
    ...state,
    fetchClimate,
  };
};
