// ============================================================
// GEODAILY — Pruebas del servicio de clima
//
// Regla que se protege aquí: el clima es un dato DECORATIVO. Si no se
// puede obtener (sin señal, servidor lento, Open-Meteo caído), la consulta
// debe rendirse rápido y devolver null — nunca quedarse colgada ni lanzar
// un error que el técnico vea mientras toma fotos.
// ============================================================

import { describe, expect, it, jest, afterEach } from '@jest/globals';
import apiClient from '../api';
import {
  CONSULTA_CLIMA_TIMEOUT_MS,
  getClimaActual,
  getResumenClimatico,
} from '../climate.service';

/** Espía sobre la petición HTTP; cada test decide qué responde. */
const espiarGet = () => jest.spyOn(apiClient, 'get');

/** Lee la llamada N registrada por el espía de forma tipada. */
const llamada = (espia: ReturnType<typeof espiarGet>, n = 0) =>
  espia.mock.calls[n] as unknown as [string, { params?: unknown; timeout?: number }];

describe('clima: la captura de fotos no depende de que haya clima', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('el resumen se pide con timeout corto explícito (no hereda los 15 s globales)', async () => {
    const espia = espiarGet().mockResolvedValue({ data: { actual: null } } as never);

    await getResumenClimatico(4.8, -75.7);

    const [url, config] = llamada(espia);
    expect(url).toContain('/resumen');
    expect(config.params).toEqual({ lat: 4.8, lon: -75.7 });
    expect(config.timeout).toBe(CONSULTA_CLIMA_TIMEOUT_MS);
    // El timeout global de la app son 15 s: con ese valor la tarjeta de la
    // cámara quedaba girando "Obteniendo datos climáticos..." demasiado tiempo.
    expect(CONSULTA_CLIMA_TIMEOUT_MS).toBeLessThan(15000);
  });

  it('el clima actual también se pide con timeout corto', async () => {
    const espia = espiarGet().mockResolvedValue({ data: {} } as never);

    await getClimaActual(4.8, -75.7);

    const [url, config] = llamada(espia);
    expect(url).toContain('/actual');
    expect(config.timeout).toBe(CONSULTA_CLIMA_TIMEOUT_MS);
  });

  it('si la petición falla, se ignora y devuelve null (no rompe la captura)', async () => {
    espiarGet().mockRejectedValue(new Error('timeout of 6000ms exceeded') as never);

    await expect(getResumenClimatico(4.8, -75.7)).resolves.toBeNull();
  });

  it('si el equipo está offline, también devuelve null sin lanzar', async () => {
    espiarGet().mockRejectedValue({ isOffline: true } as never);

    await expect(getResumenClimatico(4.8, -75.7)).resolves.toBeNull();
    await expect(getClimaActual(4.8, -75.7)).resolves.toBeNull();
  });

  it('cuando el clima sí llega, se devuelve tal cual (la función sigue igual)', async () => {
    const resumen = {
      actual: {
        temperatura: { actual: 24, sensacion_termica: 25 },
        humedad: 80,
        viento: { velocidad: 2 },
        nubosidad: 40,
        presion: 1010,
        visibilidad: 10,
        clima: 'parcialmente nublado',
        ubicacion: { nombre: 'Topacio (Antioquia)' },
        timestamp: '2026-01-01T12:00:00.000Z',
      },
    };
    espiarGet().mockResolvedValue({ data: resumen } as never);

    await expect(getResumenClimatico(4.8, -75.7)).resolves.toEqual(resumen);
  });
});
