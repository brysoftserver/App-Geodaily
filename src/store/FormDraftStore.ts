// ============================================================
// GEODAILY — Store de Borradores de Formularios (Drafts)
// ============================================================
// Persiste borradores localmente para recuperar formularios
// en caso de cierre inesperado de la aplicación.
//
// IMPORTANTE: Usamos AsyncStorage en vez de SecureStore porque
// los borradores contienen firmas (base64 ~5-50KB) y fotos,
// que superan el límite de ~2KB de SecureStore en Android.
// AsyncStorage tiene un límite de ~6MB, suficiente para
// múltiples borradores completos.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';
import {
  DatosTecnico,
  DatosBeneficiario,
  ActividadRealizada,
  DatosSociodemograficos,
  DatosCaracterizacionNueva,
  Coordenadas,
  TipoFormulario,
  FotoGeotag,
} from '../types';

const DRAFTS_KEY = STORAGE_KEYS.FORM_DRAFTS;

export interface FormDraft {
  id: string;
  tipo: TipoFormulario;
  step: number;
  tecnico: DatosTecnico;
  beneficiario: DatosBeneficiario;
  actividad: ActividadRealizada;
  socioData?: DatosSociodemograficos;
  caracterizacion_nueva?: DatosCaracterizacionNueva;
  coordenadas?: Coordenadas;
  selectedDepartamento: string;
  selectedActividad: string;
  otraActividadText: string;
  descripcionDetallada?: string;
  fotos?: FotoGeotag[];
  /** Firma del beneficiario en base64 (data:image/png;base64,...) */
  firma_beneficiario?: string;
  /** Firma del técnico en base64 (data:image/png;base64,...) */
  firma_tecnico?: string;
  huella_beneficiario?: boolean;
  updated_at: string;
}

/**
 * Guardar borrador del formulario actual
 */
export const guardarBorrador = async (draft: FormDraft): Promise<void> => {
  try {
    const draftsStr = await AsyncStorage.getItem(DRAFTS_KEY);
    const drafts: FormDraft[] = draftsStr ? JSON.parse(draftsStr) : [];

    const idx = drafts.findIndex((d) => d.id === draft.id);
    if (idx >= 0) {
      drafts[idx] = { ...draft, updated_at: new Date().toISOString() };
    } else {
      drafts.unshift({ ...draft, updated_at: new Date().toISOString() });
    }

    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    console.log('[Drafts] Borrador guardado:', draft.id, `(tamaño: ${JSON.stringify(draft).length} bytes)`);
  } catch (error) {
    console.warn('[Drafts] Error al guardar borrador:', error);
  }
};

/**
 * Cargar todos los borradores
 */
export const cargarBorradores = async (): Promise<FormDraft[]> => {
  try {
    const draftsStr = await AsyncStorage.getItem(DRAFTS_KEY);
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
    const draftsStr = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!draftsStr) return;
    const drafts: FormDraft[] = JSON.parse(draftsStr);
    const filtered = drafts.filter((d) => d.id !== id);
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(filtered));
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

/**
 * Migrar borradores antiguos desde SecureStore (si existen).
 * Llamar una vez al inicio de la app.
 */
export const migrarBorradoresDesdeSecureStore = async (): Promise<void> => {
  try {
    const { default: SecureStore } = await import('expo-secure-store');
    const oldDraftsStr = await SecureStore.getItemAsync(DRAFTS_KEY);
    if (!oldDraftsStr) return;

    // Solo migrar si AsyncStorage no tiene drafts aún
    const existingStr = await AsyncStorage.getItem(DRAFTS_KEY);
    if (existingStr && JSON.parse(existingStr).length > 0) {
      // Ya hay drafts en AsyncStorage, eliminar los viejos de SecureStore
      await SecureStore.deleteItemAsync(DRAFTS_KEY);
      return;
    }

    // Migrar
    await AsyncStorage.setItem(DRAFTS_KEY, oldDraftsStr);
    await SecureStore.deleteItemAsync(DRAFTS_KEY);
    console.log('[Drafts] Borradores migrados de SecureStore a AsyncStorage');
  } catch {
    // SecureStore puede no estar disponible (Expo Go, web)
  }
};
