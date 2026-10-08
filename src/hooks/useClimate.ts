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

      // El clima es información best-effort: si no se pudo obtener (sin señal,
      // servidor sin salida a internet, etc.) NO se muestra un error crudo al
      // técnico. Antes un 502 del backend aparecía como "HTTP status code 502"
      // en la pantalla de cámara, alarmando sin motivo — las coordenadas y la
      // evidencia ya se capturaron bien. Simplemente no se muestra la tarjeta.
      if (!resumen) {
        setState({
          climaActual: null,
          resumen: null,
          isLoading: false,
          error: null,
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
      // Igual que arriba: nunca propagar el mensaje crudo (p. ej. "HTTP status
      // code 502") a la UI. Solo se registra en consola para diagnóstico.
      const msg =
        err instanceof Error ? err.message : 'Error desconocido al obtener datos climáticos';
      console.warn('[useClimate] Clima no disponible (best-effort):', msg);
      setState({
        climaActual: null,
        resumen: null,
        isLoading: false,
        error: null,
      });
    }
  }, []);

  return {
    ...state,
    fetchClimate,
  };
};
