// Si SQLite no guarda el acta, el formato va al respaldo en archivo y la
// sincronización lo sube igual. Los borradores de actas (con firmas) se
// respaldan en el servidor.

const mockArchivos = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  getInfoAsync: jest.fn(async (r: string) => ({
    exists: mockArchivos.has(r) || Array.from(mockArchivos.keys()).some((k) => k.startsWith(r)),
    size: mockArchivos.get(r)?.length ?? 0,
  })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async (r: string, c: string) => {
    mockArchivos.set(r, c);
  }),
  readAsStringAsync: jest.fn(async (r: string) => {
    if (!mockArchivos.has(r)) throw new Error('no existe');
    return mockArchivos.get(r);
  }),
  readDirectoryAsync: jest.fn(async (dir: string) =>
    Array.from(mockArchivos.keys())
      .filter((k) => k.startsWith(dir))
      .map((k) => k.slice(dir.length))
  ),
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../api', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn(), put: jest.fn() } }));
jest.mock('../pdfLocal.service', () => ({}));
jest.mock('../archivos.service', () => ({ cabecerasDeArchivo: async () => ({}) }));
jest.mock('../database', () => ({
  idOtroFormato: (tipo: string, cedula: string, inst?: string) => (inst ? `of-${tipo}-${cedula}-${inst}` : `of-${tipo}-${cedula}`),
  saveOtroFormatoLocal: jest.fn(async () => {
    throw new Error('table otros_formatos_locales has no column named completo');
  }),
  getOtrosFormatosLocales: jest.fn(async () => []),
  getOtrosFormatosNoSincronizados: jest.fn(async () => []),
  getOtroFormatoLocalPorId: jest.fn(async () => null),
  marcarOtroFormatoSincronizadoSiSinCambios: jest.fn(async () => true),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api';
import {
  registrarOtroFormato,
  obtenerFormatoLocalPorId,
  sincronizarOtrosFormatos,
  subirBorradoresDeActasPendientes,
  borradorActaRespaldado,
} from '../otrosFormatos.service';

const api = apiClient as unknown as { post: jest.Mock; get: jest.Mock; put: jest.Mock };
const FIRMA = 'data:image/png;base64,QUJD';

beforeEach(async () => {
  mockArchivos.clear();
  await AsyncStorage.clear();
  api.post.mockReset();
  api.put.mockReset();
  api.get.mockReset();
});

describe('respaldo en archivo cuando SQLite falla', () => {
  it('registrar el acta no falla: queda en el respaldo y la sincronización la sube y la marca', async () => {
    // Primer intento (inmediato) sin red; después con red.
    api.post.mockImplementation(async (url: string) => {
      if (url.includes('/diagnostico/')) return { data: { estado: 'ok' } };
      throw Object.assign(new Error('Network Error'), { response: undefined });
    });
    const r = await registrarOtroFormato({
      tipo: 'acta_entrega_individual',
      beneficiarioCedula: '17646484',
      datos: { instancia: 'e1', nombre: 'Ana', firmaBeneficiario: FIRMA, firmaTecnico: FIRMA },
      user: { id: 'tec-7', nombre: 'Deily', email: 'deily' } as any,
    });
    expect(r.guardado).toBe(true);
    expect(r.sincronizado).toBe(false);
    // El error real de SQLite se reportó al servidor.
    expect(api.post.mock.calls.some(([u, b]: any[]) => u.includes('/diagnostico/cliente') && /no column named completo/.test(b.mensaje))).toBe(true);

    const id = 'of-acta_entrega_individual-17646484-e1';
    const local = await obtenerFormatoLocalPorId(id);
    expect(local?.datos.firmaBeneficiario).toBe(FIRMA);
    expect(local?.sincronizado).toBe(false);

    api.post.mockImplementation(async () => ({ data: { estado: 'ok', rechazados: [] } }));
    const fallaron = await sincronizarOtrosFormatos(1000);
    expect(fallaron).toEqual([]);
    const subida = api.post.mock.calls.find(([u]: any[]) => u.endsWith('/sync'));
    expect(subida[1].formatos[0].datos.firmaTecnico).toBe(FIRMA);
    expect((await obtenerFormatoLocalPorId(id))?.sincronizado).toBe(true);
    // Nunca se borra el respaldo: queda marcado como subido.
    expect(Array.from(mockArchivos.keys()).some((k) => k.includes('otros_formatos_respaldo'))).toBe(true);
  });
});

describe('borradores de actas en el servidor', () => {
  it('sube los borradores con cambios sin respaldar (con firmas) y no repite los ya respaldados', async () => {
    await AsyncStorage.setItem(
      'geodaily.otros_formatos.acta_entrega_individual.17646484__emwatmbxf761b',
      JSON.stringify({ datos: { nombre: 'Ana', firmaBeneficiario: FIRMA, firmaTecnico: FIRMA }, updated_at: '2026-11-11T19:00:00.000Z' })
    );
    api.put.mockResolvedValue({ data: { estado: 'ok' } });

    expect(await borradorActaRespaldado('17646484', 'emwatmbxf761b')).toBe(false);
    expect(await subirBorradoresDeActasPendientes()).toBe(1);
    const [url, body] = api.put.mock.calls[0];
    expect(url).toContain('/borradores/of-acta_entrega_individual-17646484-emwatmbxf761b');
    expect(body.instancia).toBe('emwatmbxf761b');
    expect(body.datos.firmaBeneficiario).toBe(FIRMA);
    expect(await borradorActaRespaldado('17646484', 'emwatmbxf761b')).toBe(true);

    expect(await subirBorradoresDeActasPendientes()).toBe(0);
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});
