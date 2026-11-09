// Verificación de Entregas: los borradores nunca suben; al completar se suben
// primero fotos y firmas y luego el registro, sin URIs locales ni base64; si
// una evidencia falla, queda pendiente para el próximo ciclo.
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
const mockPost = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../api', () => ({ __esModule: true, default: { post: (...a: any[]) => mockPost(...a), get: jest.fn() }, getApiAuthToken: async () => 't' }));
jest.mock('../mediaStorage.service', () => ({ archivoLocalFaltante: async () => false }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  guardarVerificacionLocal,
  listarVerificacionesLocales,
  obtenerVerificacionLocal,
  sincronizarVerificacionesEntrega,
  completarVerificacion,
  VerificacionLocal,
} from '../verificacionesEntrega.service';
import { buscarMaterialVerificacion, datosVacios, fechaVerificacionIso, formatearFechaEscrita } from '../../data/verificacionesEntrega';

const material = buscarMaterialVerificacion('colinos_platano')!;

const nueva = (id: string, completado: boolean): VerificacionLocal => {
  const datos = datosVacios(material, 'Interventor');
  datos.respuestas['1.1'].fotos = [{ id: 'f1', uri: 'file:///foto1.jpg' }];
  datos.firmas.tecnico.firma = 'data:image/png;base64,AAAA';
  return { id, material: 'colinos_platano', autor_id: 'int-1', autor_nombre: 'I', datos, completado, sincronizado: false, created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z' };
};

const respuestas = (fallaFoto = false) =>
  mockPost.mockImplementation(async (url: any, body: any) => {
    if (String(url).endsWith('/archivos')) {
      if (fallaFoto) throw new Error('Network Error');
      return { data: { estado: 'ok', id: 11 } };
    }
    if (String(url).endsWith('/firmas')) return { data: { estado: 'ok', id: 22 } };
    if (String(url).endsWith('/sync')) return { data: { estado: 'ok', sincronizadas: body.verificaciones.length, rechazadas: [] } };
    throw new Error('url inesperada ' + url);
  });

describe('Verificación de Entregas (cliente)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockPost.mockReset();
  });

  it('un borrador se guarda localmente y nunca se sube', async () => {
    respuestas();
    await guardarVerificacionLocal(nueva('ve-a-1', false));
    const borradores = await listarVerificacionesLocales({ material: 'colinos_platano', autorId: 'int-1', completado: false });
    expect(borradores.map((b) => b.id)).toEqual(['ve-a-1']);
    expect(await sincronizarVerificacionesEntrega()).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('al completar sube foto, firma y registro, y queda sincronizada', async () => {
    respuestas();
    const r = await completarVerificacion(nueva('ve-b-1', false));
    expect(r).toEqual({ guardada: true, sincronizada: true });
    const urls = mockPost.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/\/ve-b-1\/archivos$/);
    expect(urls[1]).toMatch(/\/ve-b-1\/firmas$/);
    expect(urls[2]).toMatch(/\/sync$/);
    // Al servidor no viajan URIs locales ni el base64 de la firma.
    const enviado = (mockPost.mock.calls[2][1] as any).verificaciones[0].datos;
    expect(enviado.respuestas['1.1'].fotos).toEqual([{ id: 'f1', archivo_id: 11, perdido: undefined }]);
    expect(enviado.firmas.tecnico).toMatchObject({ firma: null, archivo_id: 22 });
    const local = await obtenerVerificacionLocal('ve-b-1');
    expect(local).toMatchObject({ completado: true, sincronizado: true });
    // La copia local conserva la foto y la firma para verlas sin conexión.
    expect(local!.datos.respuestas['1.1'].fotos[0]).toMatchObject({ uri: 'file:///foto1.jpg', archivo_id: 11 });
    expect(local!.datos.firmas.tecnico.firma).toBe('data:image/png;base64,AAAA');
    // Ya no está entre los borradores, sí entre las completas.
    expect(await listarVerificacionesLocales({ material: 'colinos_platano', autorId: 'int-1', completado: false })).toHaveLength(0);
    expect(await listarVerificacionesLocales({ material: 'colinos_platano', autorId: 'int-1', completado: true })).toHaveLength(1);
  });

  it('si una foto falla, el registro igual se envía y queda pendiente para reintentar', async () => {
    respuestas(true);
    const r = await completarVerificacion(nueva('ve-c-1', false));
    expect(r.sincronizada).toBe(false);
    expect(mockPost.mock.calls.some((c) => String(c[0]).endsWith('/sync'))).toBe(true);
    expect(await obtenerVerificacionLocal('ve-c-1')).toMatchObject({ completado: true, sincronizado: false });
    // Próximo ciclo con red: termina y no vuelve a subir la firma ya subida.
    mockPost.mockReset();
    respuestas(false);
    expect(await sincronizarVerificacionesEntrega()).toEqual([]);
    expect(mockPost.mock.calls.some((c) => String(c[0]).endsWith('/firmas'))).toBe(false);
    expect(await obtenerVerificacionLocal('ve-c-1')).toMatchObject({ sincronizado: true });
  });

  it('sin conexión al completar: queda guardada localmente como completada', async () => {
    mockPost.mockImplementation(async () => { throw new Error('Network Error'); });
    const r = await completarVerificacion(nueva('ve-d-1', false));
    expect(r).toEqual({ guardada: true, sincronizada: false });
    expect(await obtenerVerificacionLocal('ve-d-1')).toMatchObject({ completado: true, sincronizado: false });
  });

  it('cada usuario ve solo sus borradores en este dispositivo', async () => {
    await guardarVerificacionLocal(nueva('ve-e-1', false));
    await guardarVerificacionLocal({ ...nueva('ve-e-2', false), autor_id: 'int-2' });
    const mios = await listarVerificacionesLocales({ material: 'colinos_platano', autorId: 'int-1', completado: false });
    expect(mios.map((b) => b.id)).toEqual(['ve-e-1']);
  });
});

describe('Formato de Colinos de Plátano', () => {
  it('no incluye la 3.4 (repetía la 2.3) y conserva el resto de criterios', () => {
    const ids = material.modulos.flatMap((m) => m.criterios.map((c) => c.id));
    expect(ids).not.toContain('3.4');
    expect(ids).toContain('2.3');
    expect(ids).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3', '4.4', '4.5']);
  });

  it('la fecha es manual: arranca vacía y no guarda hora', () => {
    const d = datosVacios(material);
    expect(d.encabezado.fecha).toBe('');
    expect((d.encabezado as any).fechaHora).toBeUndefined();
  });

  it('la fecha se escribe con barras automáticas y se valida', () => {
    expect(formatearFechaEscrita('09112026')).toBe('09/11/2026');
    expect(formatearFechaEscrita('0911')).toBe('09/11');
    expect(formatearFechaEscrita('ab09/11/2026xyz9')).toBe('09/11/2026');
    expect(fechaVerificacionIso('09/11/2026')).toBe('2026-11-09');
    expect(fechaVerificacionIso('31/02/2026')).toBeNull();
    expect(fechaVerificacionIso('29/02/2028')).toBe('2028-02-29');
    expect(fechaVerificacionIso('09/13/2026')).toBeNull();
    expect(fechaVerificacionIso('')).toBeNull();
  });
});
