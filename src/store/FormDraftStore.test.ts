import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockValues.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockValues.set(key, value); },
    removeItem: async (key: string) => { mockValues.delete(key); },
    getAllKeys: async () => Array.from(mockValues.keys()),
    multiGet: async (keys: string[]) => keys.map((key) => [key, mockValues.get(key) ?? null]),
    clear: async () => { mockValues.clear(); },
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cargarBorradores } from './FormDraftStore';
import { STORAGE_KEYS } from '../utils/constants';

const makeDraft = (id: string) => ({
  id,
  tipo: 'caracterizacion',
  step: 2,
  tecnico: { usuario_id: 'tec-001', nombre: 'Rodrigo' },
  beneficiario: { nombre: `Beneficiario ${id}`, cedula: id },
  actividad: { descripcion: '', observaciones: '', recomendaciones: '' },
  selectedDepartamento: 'Caqueta',
  selectedActividad: '',
  otraActividadText: '',
  updated_at: '2026-09-26T00:00:00.000Z',
});

describe('cargarBorradores legacy recovery', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('recovers complete drafts before a truncated tail and preserves the raw key', async () => {
    const completeDraft = makeDraft('draft-1');
    const rawLegacy = `[${JSON.stringify(completeDraft)},${JSON.stringify(makeDraft('draft-2')).slice(0, 80)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.FORM_DRAFTS, rawLegacy);

    const drafts = await cargarBorradores();

    expect(drafts.map((draft) => draft.id)).toEqual(['draft-1']);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.FORM_DRAFTS)).toBe(rawLegacy);
  });

  it('continues past malformed data between complete draft objects', async () => {
    const first = makeDraft('draft-1');
    const second = makeDraft('draft-2');
    second.beneficiario.nombre = 'Beneficiary {2} with "quotes"';
    const rawLegacy = `[${JSON.stringify(first)},broken,${JSON.stringify(second)}]`;
    await AsyncStorage.setItem(STORAGE_KEYS.FORM_DRAFTS, rawLegacy);

    const drafts = await cargarBorradores();

    expect(drafts.map((draft) => draft.id)).toEqual(['draft-1', 'draft-2']);
    expect(drafts[1].beneficiario.nombre).toBe('Beneficiary {2} with "quotes"');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.FORM_DRAFTS)).toBe(rawLegacy);
  });

  it('does not invent drafts or remove an unrecoverable legacy value', async () => {
    const rawLegacy = '[not-json';
    await AsyncStorage.setItem(STORAGE_KEYS.FORM_DRAFTS, rawLegacy);

    expect(await cargarBorradores()).toEqual([]);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.FORM_DRAFTS)).toBe(rawLegacy);
  });
});