// Corrección del técnico posterior a una novedad → "corregida, por verificar".
// Mismo criterio que backend/src/lib/correcciones.js.
import { describe, expect, it } from '@jest/globals';
import { correccionPosterior, estaNovedadResuelta } from '../revisiones';
import type { Revision, Correccion } from '../../services/revisiones.service';

const novedad = (created_at: string, extra: Partial<Revision> = {}): Revision => ({
  id: 1,
  formulario_id: 'f1',
  revisor_id: 'sup-002',
  revisor_nombre: 'Leidy',
  revisor_rol: 'coordinador',
  tipo: 'novedad',
  seccion: 'COMPONENTE SOCIAL',
  comentario: 'Diligenciar pregunta 13',
  datos_formulario_json: null,
  created_at,
  ...extra,
});

const corr = (created_at: string, id = 'c1'): Correccion => ({
  id,
  accion: 'completar_respuesta',
  usuario_id: 'tec-007',
  usuario_nombre: 'Deily',
  path: 'componente_social.tipo_energia',
  created_at,
});

describe('correccionPosterior', () => {
  it('devuelve la corrección más reciente posterior a la novedad', () => {
    const c = correccionPosterior(novedad('2026-09-29T21:20:00Z'), [
      corr('2026-09-20T00:00:00Z', 'vieja'),
      corr('2026-09-30T21:43:00Z', 'a'),
      corr('2026-11-03T23:05:00Z', 'b'),
    ]);
    expect(c?.id).toBe('b');
  });

  it('ignora correcciones anteriores a la novedad', () => {
    expect(correccionPosterior(novedad('2026-09-29T21:20:00Z'), [corr('2026-09-20T00:00:00Z')])).toBeNull();
  });

  it('sin correcciones (o backend anterior que no las envía) → null', () => {
    expect(correccionPosterior(novedad('2026-09-29T21:20:00Z'), [])).toBeNull();
    expect(correccionPosterior(novedad('2026-09-29T21:20:00Z'), undefined)).toBeNull();
  });

  it('marcarla como corregida NO la resuelve: sigue pendiente hasta el visto bueno', () => {
    const n = novedad('2026-09-29T21:20:00Z');
    expect(correccionPosterior(n, [corr('2026-09-30T21:43:00Z')])).not.toBeNull();
    expect(estaNovedadResuelta(n, [n])).toBe(false);
  });
});
