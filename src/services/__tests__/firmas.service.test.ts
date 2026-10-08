// ============================================================
// GEODAILY — Pruebas del servicio de firmas
//
// Regla que se protege aquí: reemplazar la firma de una visita ya
// completada (el técnico de la visita cambió y el interventor pide
// cambiarla) debe pegarle al endpoint DEDICADO
// `/api/firmas/guardar-en-formulario`, que solo actualiza el campo de la
// firma. Si esa llamada no viaja —o falla— el detalle se queda sin señal de
// que hay que guardar la firma en el teléfono.
// ============================================================

import { describe, expect, it, jest, afterEach } from '@jest/globals';
import apiClient from '../api';
import { API_CONFIG } from '../../theme';
import { guardarFirmaEnFormulario } from '../firmas.service';

/** Espía sobre la petición HTTP; cada test decide qué responde. */
const espiarPost = () => jest.spyOn(apiClient, 'post');

/** Lee la llamada N registrada por el espía de forma tipada. */
const llamada = (espia: ReturnType<typeof espiarPost>, n = 0) =>
  espia.mock.calls[n] as unknown as [
    string,
    Record<string, unknown>,
    { timeout?: number },
  ];

describe('firmas: reemplazar la firma de una visita ya completada', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sube la firma al endpoint dedicado, no al formulario completo', async () => {
    const espia = espiarPost().mockResolvedValue({
      data: { estado: 'ok', id: 'arch-1', ruta: 'tecnicos/tec-1/firmas/firma_beneficiario_f1_123.png' },
    } as never);

    const resultado = await guardarFirmaEnFormulario(
      'form-1',
      'beneficiario',
      'data:image/png;base64,AAA',
      '111222',
      'Ana Pérez',
      'visita'
    );

    const [url, payload, config] = llamada(espia);
    expect(url).toBe(`${API_CONFIG.ENDPOINTS.FIRMAS}/guardar-en-formulario`);
    expect(payload).toMatchObject({
      formulario_id: 'form-1',
      tipo: 'beneficiario',
      data: 'data:image/png;base64,AAA',
      beneficiario_cedula: '111222',
      beneficiario_nombre: 'Ana Pérez',
      tipo_formulario: 'visita',
    });
    // 15 s como el resto de subidas: si el servidor no responde hay que
    // rendirse pronto, no dejar el velo de "Guardando firma…" colgado.
    expect(config.timeout).toBe(15000);
    // La ruta es lo que el detalle guarda como nueva firma del formulario.
    expect(resultado?.ruta).toContain('firma_beneficiario');
  });

  it('la firma del técnico viaja con tipo "tecnico"', async () => {
    const espia = espiarPost().mockResolvedValue({ data: { ruta: 'ruta.png' } } as never);

    await guardarFirmaEnFormulario('form-2', 'tecnico', 'data:image/png;base64,BBB');

    const [, payload] = llamada(espia);
    expect(payload.tipo).toBe('tecnico');
    expect(payload.formulario_id).toBe('form-2');
  });

  it('offline devuelve null para que la firma quede pendiente de subir', async () => {
    espiarPost().mockRejectedValue({ isOffline: true } as never);

    await expect(
      guardarFirmaEnFormulario('form-3', 'beneficiario', 'data:image/png;base64,CCC')
    ).resolves.toBeNull();
  });

  it('un rechazo del servidor (p. ej. 403 sin autorización) no lanza: devuelve null', async () => {
    const espiaError = jest.spyOn(console, 'error').mockImplementation(() => {});
    espiarPost().mockRejectedValue({
      response: { status: 403, data: { mensaje: 'No autorizado para modificar este formulario' } },
    } as never);

    await expect(
      guardarFirmaEnFormulario('form-4', 'tecnico', 'data:image/png;base64,DDD')
    ).resolves.toBeNull();

    expect(espiaError).toHaveBeenCalled();
  });
});
