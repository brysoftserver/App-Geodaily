// ============================================================
// GEODAILY — Store de Borradores de Formularios (Drafts)
// ============================================================
// Persiste borradores localmente para recuperar formularios
// en caso de cierre inesperado de la aplicación.
// ============================================================

import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../utils/constants';
import {
  DatosTecnico,
  DatosBeneficiario,
  ActividadRealizada,
  Coordenadas,
  TipoFormulario,
} from '../types';

export interface FormDraft {
  id: string;
  tipo: TipoFormulario;
  step: number;
  tecnico: DatosTecnico;
  beneficiario: DatosBeneficiario;
  actividad: ActividadRealizada;
  coordenadas?: Coordenadas;
  selectedDepartamento: string;
  selectedActividad: string;
  otraActividadText: string;
  descripcionDetallada?: string;
  updated_at: string;
}

/**
 * Guardar borrador del formulario actual
 */
export const guardarBorrador = async (draft: FormDraft): Promise<void> => {
  try {
    const draftsStr = await SecureStore.getItemAsync(STORAGE_KEYS.FORM_DRAFTS);
    const drafts: FormDraft[] = draftsStr ? JSON.parse(draftsStr) : [];

    const idx = drafts.findIndex((d) => d.id === draft.id);
    if (idx >= 0) {
      drafts[idx] = { ...draft, updated_at: new Date().toISOString() };
    } else {
      drafts.unshift({ ...draft, updated_at: new Date().toISOString() });
    }

    await SecureStore.setItemAsync(STORAGE_KEYS.FORM_DRAFTS, JSON.stringify(drafts));
    console.log('[Drafts] Borrador guardado:', draft.id);
  } catch (error) {
    console.warn('[Drafts] Error al guardar borrador:', error);
  }
};

/**
 * Cargar todos los borradores
 */
export const cargarBorradores = async (): Promise<FormDraft[]> => {
  try {
    const draftsStr = await SecureStore.getItemAsync(STORAGE_KEYS.FORM_DRAFTS);
    return draftsStr ? JSON.parse(draftsStr) : [];
  } catch (error) {
    console.warn('[Drafts] Error al cargar borradores:', error);
    return [];
  }
};

/**
 * Obtener un borrador por ID
 */
export const getBorrador = async (id: string): Promise<FormDraft | null> => {
  const drafts = await cargarBorradores();
  return drafts.find((d) => d.id === id) || null;
};

/**
 * Eliminar un borrador por ID
 */
export const eliminarBorrador = async (id: string): Promise<void> => {
  try {
    const draftsStr = await SecureStore.getItemAsync(STORAGE_KEYS.FORM_DRAFTS);
    if (!draftsStr) return;
    const drafts: FormDraft[] = JSON.parse(draftsStr);
    const filtered = drafts.filter((d) => d.id !== id);
    await SecureStore.setItemAsync(STORAGE_KEYS.FORM_DRAFTS, JSON.stringify(filtered));
    console.log('[Drafts] Borrador eliminado:', id);
  } catch (error) {
    console.warn('[Drafts] Error al eliminar borrador:', error);
  }
};

/**
 * Contar borradores pendientes
 */
export const contarBorradores = async (): Promise<number> => {
  const drafts = await cargarBorradores();
  return drafts.length;
};
