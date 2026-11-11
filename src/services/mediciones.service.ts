// ============================================================
// GEODAILY — Historial de mediciones (polígonos) desde el servidor
// ============================================================
// Las mediciones se suben con POST /api/mediciones/sync. Esto hace el
// camino inverso: trae las del servidor y las fusiona en el SQLite local,
// para que el historial se vea igual desde otro teléfono. Sin conexión no
// pasa nada: se sigue mostrando lo local.
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';
import { mergeMedicionesDelServidor } from './database';

let enCurso: Promise<number> | null = null;

/**
 * Descarga el historial de mediciones del servidor y lo guarda localmente.
 * El técnico recibe solo las suyas; los roles superiores, todas (mismo
 * alcance que ya tenía GET /api/mediciones). Nunca lanza error.
 *
 * @returns cuántas mediciones se insertaron/actualizaron (0 si offline)
 */
export const descargarHistorialMediciones = (timeoutMs = 10000): Promise<number> => {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      const res = await apiClient.get(API_CONFIG.ENDPOINTS.MEDICIONES, { timeout: timeoutMs });
      const lista = res.data?.mediciones;
      return Array.isArray(lista) ? await mergeMedicionesDelServidor(lista) : 0;
    } catch (error: any) {
      console.warn('[Mediciones] No se pudo descargar el historial del servidor:', error?.message);
      return 0;
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
};
