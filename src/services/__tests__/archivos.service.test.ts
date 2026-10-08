// ============================================================
// GEODAILY — Pruebas de `resolverEvidenciasRemotas`
//
// Regla que se protege aquí: la lista de evidencias que ve el usuario en el
// detalle de una visita completada debe ser la UNIÓN de lo que hay en este
// teléfono y lo que hay en el servidor.
//
// Antes, si todos los archivos de `formulario.fotos` existían en disco, la
// función devolvía esa lista y NUNCA consultaba el servidor. Como
// `formulario.fotos` es una foto fija del momento en que se guardó el
// formulario, una foto vuelta a tomar con el botón «＋ Agregar» sobre una
// visita ya cerrada no estaba en esa lista: se subía al servidor y
// desaparecía de la pantalla, justo cuando el interventor pide volver a
// tomarla y hay que comprobar que quedó guardada.
// ============================================================

import { describe, expect, it, jest, afterEach } from '@jest/globals';
import * as FileSystem from 'expo-file-system/legacy';
import apiClient from '../api';
import {
  resolverEvidenciasRemotas,
  type ArchivoRemoto,
  type EvidenciaEliminada,
} from '../archivos.service';
import type { FotoGeotag } from '../../types';

// `getInfoAsync` no es redefinible con spyOn (expo-file-system/legacy lo
// exporta como propiedad no configurable), así que el módulo se reemplaza.
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
}));

const getInfoAsync = FileSystem.getInfoAsync as unknown as {
  mockImplementation: (fn: (uri: string) => Promise<unknown>) => void;
};

const URI_A = 'file:///data/fotos/a.jpg';
const URI_C = 'file:///data/fotos/c.jpg';

const fotoLocal = (id: string, uri: string): FotoGeotag => ({
  id,
  uri,
  tipo: 'foto',
  timestamp: '2025-01-01T00:00:00.000Z',
  coordenadas: { latitud: 1.5, longitud: -72.5 },
});

const archivo = (over: Partial<ArchivoRemoto>): ArchivoRemoto => ({
  id: 'arch-1',
  tipo: 'foto',
  filename: 'foto.jpg',
  mimetype: 'image/jpeg',
  latitud: 1.5,
  longitud: -72.5,
  created_at: '2025-01-01T00:00:00.000Z',
  url: '/api/archivos/arch-1/contenido',
  evidencia_local_id: null,
  ...over,
});

/** El servidor responde con esta lista de archivos y estas tumbas. */
const responderServidor = (
  archivos: ArchivoRemoto[],
  eliminadas: EvidenciaEliminada[] = []
) =>
  jest
    .spyOn(apiClient, 'get')
    .mockResolvedValue({ data: { estado: 'ok', archivos, eliminadas } } as never);

/** Se simula el disco: solo las URIs de `existentes` están en el teléfono. */
const simularDisco = (existentes: string[]) =>
  getInfoAsync.mockImplementation(async (uri: string) =>
    existentes.includes(uri)
      ? { exists: true, uri, isDirectory: false, size: 1, modificationTime: 0 }
      : { exists: false, uri, isDirectory: false }
  );

/** Resuelve y exige que haya lista (evita `!` en cada aserción del test). */
const esperarLista = (res: FotoGeotag[] | null): FotoGeotag[] => {
  expect(res).not.toBeNull();
  return res as FotoGeotag[];
};

describe('resolverEvidenciasRemotas: evidencias de una visita ya completada', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('incluye la foto agregada DESPUÉS de guardar el formulario (「＋ Agregar」)', async () => {
    simularDisco([URI_A]);
    responderServidor([
      // La que ya está en el teléfono (mismo id de captura → se deduplica)
      archivo({ id: 'arch-a', url: '/api/archivos/arch-a/contenido', evidencia_local_id: 'a' }),
      // La recién tomada sobre la visita cerrada
      archivo({
        id: 'arch-nueva',
        url: '/api/archivos/arch-nueva/contenido',
        evidencia_local_id: 'nueva',
        created_at: '2025-06-01T10:00:00.000Z',
      }),
    ]);

    const res = esperarLista(await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A)]));

    expect(res).toHaveLength(2);
    // La local primero, intacta (no hay que descargarla)
    expect(res[0].id).toBe('a');
    expect(res[0].uri).toBe(URI_A);
    // Y la nueva, servida por la API
    expect(res[1].id).toBe('arch-nueva');
    expect(res[1].uri).toContain('/api/archivos/arch-nueva/contenido');
    expect(res[1].timestamp).toBe('2025-06-01T10:00:00.000Z');
  });

  it('no duplica la evidencia cuando el servidor la identifica por `evidencia_local_id`', async () => {
    simularDisco([URI_A]);
    responderServidor([
      archivo({ id: 'arch-a', evidencia_local_id: 'a' }),
      archivo({ id: 'arch-b', evidencia_local_id: 'b' }),
    ]);

    const res = esperarLista(await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A)]));

    // 'a' ya está en local; solo se agrega 'b' (cuyo archivo no está aquí)
    expect(res).toHaveLength(2);
    expect(res.map((f) => f.id)).toEqual(['a', 'arch-b']);
  });

  it('sin conexión devuelve las evidencias locales (la captura se ve igual)', async () => {
    simularDisco([URI_A]);
    jest.spyOn(apiClient, 'get').mockRejectedValue(
      Object.assign(new Error('Network Error'), { isOffline: true }) as never
    );

    const res = esperarLista(await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A)]));

    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'a', uri: URI_A, tipo: 'foto' });
  });

  it('descarta las rutas que ya no existen en este teléfono, no las muestra rotas', async () => {
    // 'c' no existe en este dispositivo (la visita se capturó en otro),
    // 'a' sí está aquí.
    simularDisco([URI_A]);
    responderServidor([
      archivo({ id: 'arch-a', evidencia_local_id: 'a' }),
      archivo({ id: 'arch-c', evidencia_local_id: 'c' }),
    ]);

    const res = esperarLista(
      await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A), fotoLocal('c', URI_C)])
    );

    expect(res.map((f) => f.id)).toEqual(['a', 'arch-c']);
    expect(res.some((f) => f.uri === URI_C)).toBe(false);
  });

  it('respeta las tumbas: una evidencia borrada en el servidor no reaparece aunque el archivo siga aquí', async () => {
    simularDisco([URI_A]);
    responderServidor([], [{ archivo_id: null, evidencia_local_id: 'a' }]);

    const res = await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A)]);

    expect(res).toBeNull();
  });

  it('desde otro teléfono (ningún archivo local) devuelve las del servidor', async () => {
    simularDisco([]);
    responderServidor([
      archivo({ id: 'arch-a', evidencia_local_id: 'a' }),
      archivo({ id: 'arch-c', evidencia_local_id: 'c' }),
    ]);

    const res = esperarLista(
      await resolverEvidenciasRemotas('form-1', [fotoLocal('a', URI_A), fotoLocal('c', URI_C)])
    );

    expect(res).toHaveLength(2);
    expect(res.every((f) => f.uri.startsWith('http'))).toBe(true);
  });

  it('sin evidencias en ningún lado devuelve null (el detalle usa `formulario.fotos`)', async () => {
    simularDisco([]);
    responderServidor([]);

    expect(await resolverEvidenciasRemotas('form-1', undefined)).toBeNull();
    expect(await resolverEvidenciasRemotas('form-1', [])).toBeNull();
  });

  it('lo que responde el servidor queda listo para <Image>: foto/video y cache-buster', async () => {
    simularDisco([]);
    responderServidor([
      archivo({ id: 'arch-foto', evidencia_local_id: 'f' }),
      archivo({ id: 'arch-video', tipo: 'video', mimetype: 'video/mp4', evidencia_local_id: 'v' }),
      // Las firmas y los PDFs se muestran aparte, no en la tira de evidencias
      archivo({ id: 'arch-firma', tipo: 'firma', tipo_firma: 'beneficiario' }),
      archivo({ id: 'arch-pdf', tipo: 'pdf' }),
    ]);

    const res = esperarLista(await resolverEvidenciasRemotas('form-1', []));

    expect(res.map((f) => [f.id, f.tipo])).toEqual([
      ['arch-foto', 'foto'],
      ['arch-video', 'video'],
    ]);
    expect(res[0].uri).toMatch(/\?v=/);
  });
});
