// ============================================================
// GEODAILY — "Revisado por interventoría" (OK por registro de actividad)
// ============================================================
// Ver backend/src/lib/revisionInterventoria.js para el formato de la
// `referencia` de cada actividad. Solo admin e interventor marcan / quitan.
// ============================================================

import apiClient from './api';
import { API_CONFIG } from '../theme';

const ENDPOINT = API_CONFIG.ENDPOINTS.REVISION_INTERVENTORIA;

export const ROLES_REVISAN_INTERVENTORIA = ['admin', 'interventor'];

export interface RevisionInterventoria {
  referencia: string;
  revisadoPor: string | null;
  revisadoEn: string;
}

export const listarRevisionesInterventoria = async (actividad: string): Promise<RevisionInterventoria[]> => {
  const r = await apiClient.get(ENDPOINT, { params: { actividad } });
  return r.data.revisiones ?? [];
};

export const marcarRevisadoInterventoria = async (actividad: string, referencia: string): Promise<RevisionInterventoria> => {
  const r = await apiClient.put(ENDPOINT, { actividad, referencia });
  return r.data.revision;
};

export const quitarRevisadoInterventoria = async (actividad: string, referencia: string): Promise<void> => {
  await apiClient.delete(ENDPOINT, { data: { actividad, referencia } });
};
