// Entregas de una actividad: consecutivo por técnico, cada entrega guarda su
// información y su propia acta, y se sube (fotos primero, luego el registro).
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
const mockPost = jest.fn<(...a: any[]) => Promise<any>>();
const mockGet = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../api', () => ({ __esModule: true, default: { post: (...a: any[]) => mockPost(...a), get: (...a: any[]) => mockGet(...a) }, getApiAuthToken: async () => 't' }));
jest.mock('../mediaStorage.service', () => ({ archivoLocalFaltante: async () => false }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  crearEntrega,
  guardarEntregaLocal,
  importarEntregasDelServidor,
  listarEntregasLocales,
  obtenerEntregaLocal,
  sincronizarEntregasActividad,
} from '../actividadesEntregas.service';
import { FILA_INICIAL_ACTA, SUBACTIVIDADES } from '../../data/actividades';

describe('Entregas de actividad', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockPost.mockReset();
    mockGet.mockReset();
  });

  it('numera las entregas en consecutivo por técnico y actividad', async () => {
    const e1 = await crearEntrega('siembra_platano', 'tec-1');
    const e2 = await crearEntrega('siembra_platano', 'tec-1');
    const otro = await crearEntrega('siembra_platano', 'tec-2');
    expect([e1!.numero, e2!.numero, otro!.numero]).toEqual([1, 2, 1]);
    expect((await listarEntregasLocales('siembra_platano', 'tec-1')).map((e) => e.numero)).toEqual([1, 2]);
  });

  it('cada entrega guarda su información y su propia acta por separado', async () => {
    const e1 = (await crearEntrega('siembra_platano', 'tec-1'))!;
    const e2 = (await crearEntrega('siembra_platano', 'tec-1'))!;
    expect(e1.datos.actaInstancia).not.toBe(e2.datos.actaInstancia);
    expect(e1.datos.actaInstancia).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    await guardarEntregaLocal({ ...e1, datos: { ...e1.datos, lugar: 'Vereda El Líbano', fotos: [{ id: 'f1', uri: 'file:///a.jpg' }] } });
    const r2 = await obtenerEntregaLocal(e2.id);
    expect(r2!.datos.lugar).toBe('');
    expect(r2!.datos.fotos).toEqual([]);
    expect((await obtenerEntregaLocal(e1.id))!.datos.lugar).toBe('Vereda El Líbano');
  });

  it('sube la foto y luego el registro (sin URIs locales) y queda sincronizada', async () => {
    mockPost.mockImplementation(async (url: any) =>
      String(url).endsWith('/fotos') ? { data: { estado: 'ok', id: 7 } } : { data: { estado: 'ok', sincronizadas: 1, rechazadas: [] } }
    );
    const e = (await crearEntrega('siembra_platano', 'tec-1'))!;
    await guardarEntregaLocal({ ...e, datos: { ...e.datos, lugar: 'Acopio', fotos: [{ id: 'f1', uri: 'file:///a.jpg' }] } });
    expect(await sincronizarEntregasActividad()).toEqual([]);
    const urls = mockPost.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(new RegExp(`/${e.id}/fotos$`));
    expect(urls[1]).toMatch(/\/sync$/);
    const enviada = (mockPost.mock.calls[1][1] as any).entregas[0];
    expect(enviada.numero).toBe(1);
    expect(enviada.datos.fotos).toEqual([{ id: 'f1', archivo_id: 7, perdido: undefined }]);
    const local = await obtenerEntregaLocal(e.id);
    expect(local).toMatchObject({ sincronizado: true });
    expect(local!.datos.fotos[0]).toMatchObject({ uri: 'file:///a.jpg', archivo_id: 7 });
  });

  it('sin red queda pendiente y no pierde nada', async () => {
    mockPost.mockImplementation(async () => { throw new Error('Network Error'); });
    const e = (await crearEntrega('siembra_platano', 'tec-1'))!;
    expect(await sincronizarEntregasActividad()).toEqual([e.id]);
    expect(await obtenerEntregaLocal(e.id)).toMatchObject({ sincronizado: false });
  });

  it('importa las entregas hechas en otro teléfono y el consecutivo sigue después de ellas', async () => {
    mockGet.mockResolvedValue({ data: { entregas: [{ id: 'ent-siembraplatano-remota1', actividad: 'siembra_platano', numero: 3, datos: { lugar: 'Remoto' }, created_at: '2026-11-01', updated_at: '2026-11-01' }] } });
    expect(await importarEntregasDelServidor('siembra_platano', 'tec-1')).toBe(true);
    const nueva = await crearEntrega('siembra_platano', 'tec-1');
    expect(nueva!.numero).toBe(4);
    const remota = await obtenerEntregaLocal('ent-siembraplatano-remota1');
    expect(remota).toMatchObject({ sincronizado: true, numero: 3 });
    expect(remota!.datos.fotos).toEqual([]);
  });
});

describe('Catálogo de Siembra de Plátano', () => {
  it('tiene las 4 subactividades; solo Entrega de Colinos abre pantalla', () => {
    const subs = SUBACTIVIDADES.siembra_platano;
    expect(subs.map((s) => s.nombre)).toEqual([
      'Entrega de Colinos de Plátano',
      'Trazado, Ahoyado y Encalado',
      'Siembra de los Colinos de Plátano',
      'Fertilización',
    ]);
    expect(subs.filter((s) => s.pantalla).map((s) => s.id)).toEqual(['entrega_colinos']);
  });

  it('el acta de siembra de plátano arranca con la fila del formato', () => {
    expect(FILA_INICIAL_ACTA.siembra_platano).toEqual({ descripcion: 'Realizar siembra de plátano.', actividad: '4', cantidad: '', unidad: 'Semilla de plátano (Colino)' });
    // Preparación del terreno conserva su fila de siempre.
    expect(FILA_INICIAL_ACTA.preparacion_terreno).toEqual({ descripcion: 'Preparación del terreno', actividad: '2', cantidad: '2,5', unidad: 'Hectárea' });
  });
});
