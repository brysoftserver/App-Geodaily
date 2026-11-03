import { describe, expect, it } from '@jest/globals';

import {
  buscarBorradorPorLlave,
  buscarVisitaCompletada,
  construirLlave,
  decidirEntrada,
  llaveCorrespondeACedula,
  normalizarCedula,
  numeroVisitaDe,
} from '../llaveVisita';
import type { FormDraft } from '../../store/FormDraftStore';
import type { Formulario } from '../../types';

const PEPITO = '1.098.765.432';
const FRANCESCO = '52.111.222';

const borrador = (over: Partial<FormDraft> & { id: string }): FormDraft =>
  ({
    tipo: 'visita_tecnica',
    step: 0,
    tecnico: {},
    beneficiario: {},
    actividad: {},
    selectedDepartamento: '',
    selectedActividad: '',
    otraActividadText: '',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as unknown as FormDraft;

const completada = (
  cedula: string,
  tipo: 'caracterizacion' | 'visita_tecnica',
  visita_numero?: number,
  created_at = '2026-09-01T10:00:00.000Z'
): Formulario =>
  ({
    id: `f-${cedula}-${tipo}-${visita_numero ?? 0}`,
    tipo,
    beneficiario: { cedula, nombre: 'X' },
    actividad: visita_numero != null ? { visita_numero } : {},
    created_at,
  }) as unknown as Formulario;

describe('normalizarCedula', () => {
  it('quita puntos, espacios y guiones', () => {
    expect(normalizarCedula('1.098.765.432')).toBe('1098765432');
    expect(normalizarCedula(' 1098 765-432 ')).toBe('1098765432');
    expect(normalizarCedula('c.c. 52111222')).toBe('CC52111222');
  });
  it('vacío o nulo → ""', () => {
    expect(normalizarCedula('')).toBe('');
    expect(normalizarCedula(null)).toBe('');
    expect(normalizarCedula(undefined)).toBe('');
  });
});

describe('construirLlave', () => {
  it('Pepito y Francesco NUNCA comparten llave (mismo técnico y formulario)', () => {
    expect(construirLlave('U1', PEPITO, 3)).not.toBe(construirLlave('U1', FRANCESCO, 3));
  });
  it('mismo beneficiario con otro formato de cédula → misma llave', () => {
    expect(construirLlave('U1', '1.098.765.432', 2)).toBe(construirLlave('U1', '1098765432', 2));
  });
  it('cambia con el técnico y con el número de visita', () => {
    expect(construirLlave('U1', PEPITO, 2)).not.toBe(construirLlave('U2', PEPITO, 2));
    expect(construirLlave('U1', PEPITO, 2)).not.toBe(construirLlave('U1', PEPITO, 3));
  });
  it('sin técnico, sin cédula o sin número válido → null (no se usa ningún respaldo)', () => {
    expect(construirLlave('', PEPITO, 2)).toBeNull();
    expect(construirLlave('U1', '', 2)).toBeNull();
    expect(construirLlave('U1', '...', 2)).toBeNull();
    expect(construirLlave('U1', PEPITO, 0)).toBeNull();
    expect(construirLlave('U1', PEPITO, undefined as any)).toBeNull();
  });
});

describe('numeroVisitaDe', () => {
  it('caracterización es siempre la visita 1; la visita técnica usa visita_numero', () => {
    expect(numeroVisitaDe('caracterizacion', 7)).toBe(1);
    expect(numeroVisitaDe('visita_tecnica', 3)).toBe(3);
    expect(numeroVisitaDe('visita_tecnica', '2')).toBe(2);
    expect(numeroVisitaDe('visita_tecnica', undefined)).toBeUndefined();
    expect(numeroVisitaDe('otro', 1)).toBeUndefined();
  });
});

describe('decidirEntrada — que NO se mezclen beneficiarios', () => {
  const llavePepito = construirLlave('U1', PEPITO, 3)!;
  const llaveFrancesco = construirLlave('U1', FRANCESCO, 3)!;
  const base = { usuarioId: 'U1', numeroVisita: 3, formularios: [] as Formulario[] };

  it('NO reanuda el borrador de Francesco al entrar con Pepito', () => {
    const d = decidirEntrada({
      ...base,
      cedula: PEPITO,
      borradores: [borrador({ id: 'b-franc', llave: llaveFrancesco })],
    });
    expect(d).toEqual({ estado: 'ok', llave: llavePepito, borrador: undefined });
  });

  it('reanuda el borrador de Pepito cuando existe (aunque haya otros)', () => {
    const d = decidirEntrada({
      ...base,
      cedula: PEPITO,
      borradores: [
        borrador({ id: 'b-franc', llave: llaveFrancesco }),
        borrador({ id: 'b-pepito', llave: llavePepito }),
      ],
    });
    expect(d.estado).toBe('ok');
    expect((d as any).borrador?.id).toBe('b-pepito');
  });

  it('con varios borradores de la MISMA llave toma el más reciente y no descarta nada', () => {
    const borradores = [
      borrador({ id: 'viejo', llave: llavePepito, updated_at: '2026-10-01T08:00:00.000Z' }),
      borrador({ id: 'nuevo', llave: llavePepito, updated_at: '2026-10-02T08:00:00.000Z' }),
    ];
    expect(buscarBorradorPorLlave(borradores, llavePepito)?.id).toBe('nuevo');
    expect(borradores).toHaveLength(2);
  });

  it('no reanuda borradores de OTRO técnico para el mismo beneficiario', () => {
    const d = decidirEntrada({
      ...base,
      cedula: PEPITO,
      borradores: [borrador({ id: 'b-otro-tec', llave: construirLlave('U2', PEPITO, 3)! })],
    });
    expect((d as any).borrador).toBeUndefined();
  });

  it('no reanuda borradores de otra visita del mismo beneficiario', () => {
    const d = decidirEntrada({
      ...base,
      cedula: PEPITO,
      borradores: [borrador({ id: 'b-v2', llave: construirLlave('U1', PEPITO, 2)! })],
    });
    expect((d as any).borrador).toBeUndefined();
  });

  it('los borradores antiguos (sin llave) nunca se reanudan solos', () => {
    const d = decidirEntrada({
      ...base,
      cedula: PEPITO,
      borradores: [
        borrador({ id: 'legacy', beneficiario: { cedula: PEPITO } as any }),
      ],
    });
    expect((d as any).borrador).toBeUndefined();
  });

  it('sin cédula o sin técnico → sin_datos (no hay respaldo por número de ítem)', () => {
    expect(decidirEntrada({ ...base, cedula: '', borradores: [] }).estado).toBe('sin_datos');
    expect(decidirEntrada({ ...base, cedula: undefined, borradores: [] }).estado).toBe('sin_datos');
    expect(decidirEntrada({ ...base, usuarioId: '', cedula: PEPITO, borradores: [] }).estado).toBe('sin_datos');
  });
});

describe('decidirEntrada — una sola visita por formulario y beneficiario', () => {
  const base = { usuarioId: 'U1', borradores: [] as FormDraft[] };

  it('bloquea si la visita ya está completada (devuelve ese formulario)', () => {
    const f = completada(PEPITO, 'visita_tecnica', 3);
    const d = decidirEntrada({ ...base, cedula: PEPITO, numeroVisita: 3, formularios: [f] });
    expect(d.estado).toBe('bloqueada');
    expect((d as any).formulario.id).toBe(f.id);
  });

  it('bloquea aunque la cédula esté escrita con otro formato', () => {
    const f = completada('1098765432', 'visita_tecnica', 3);
    expect(decidirEntrada({ ...base, cedula: '1.098.765.432', numeroVisita: 3, formularios: [f] }).estado).toBe('bloqueada');
  });

  it('bloquea aunque la visita la hiciera otro técnico (el beneficiario cambió de técnico)', () => {
    const f = { ...completada(PEPITO, 'visita_tecnica', 3), usuario_id: 'U9' } as Formulario;
    expect(decidirEntrada({ ...base, cedula: PEPITO, numeroVisita: 3, formularios: [f] }).estado).toBe('bloqueada');
  });

  it('el bloqueo gana sobre un borrador existente', () => {
    const llave = construirLlave('U1', PEPITO, 3)!;
    const d = decidirEntrada({
      usuarioId: 'U1',
      cedula: PEPITO,
      numeroVisita: 3,
      formularios: [completada(PEPITO, 'visita_tecnica', 3)],
      borradores: [borrador({ id: 'b', llave })],
    });
    expect(d.estado).toBe('bloqueada');
  });

  it('NO bloquea por la visita completada de otro beneficiario ni de otra visita', () => {
    const formularios = [
      completada(FRANCESCO, 'visita_tecnica', 3),
      completada(PEPITO, 'visita_tecnica', 2),
      completada(PEPITO, 'caracterizacion'),
    ];
    expect(decidirEntrada({ ...base, cedula: PEPITO, numeroVisita: 3, formularios }).estado).toBe('ok');
  });

  it('la caracterización cuenta como visita 1', () => {
    const f = completada(PEPITO, 'caracterizacion');
    expect(decidirEntrada({ ...base, cedula: PEPITO, numeroVisita: 1, formularios: [f] }).estado).toBe('bloqueada');
  });

  it('una visita técnica del formato antiguo (sin visita_numero) no bloquea la visita 2', () => {
    const f = completada(PEPITO, 'visita_tecnica');
    expect(decidirEntrada({ ...base, cedula: PEPITO, numeroVisita: 2, formularios: [f] }).estado).toBe('ok');
  });

  it('con varias completadas (datos antiguos) devuelve la más reciente', () => {
    const a = completada(PEPITO, 'caracterizacion', undefined, '2026-01-01T00:00:00.000Z');
    const b = completada(PEPITO, 'caracterizacion', undefined, '2026-06-01T00:00:00.000Z');
    expect(buscarVisitaCompletada([a, b], PEPITO, 1)).toBe(b);
  });
});

describe('llaveCorrespondeACedula', () => {
  it('solo es verdadera para la cédula de la llave', () => {
    const llave = construirLlave('U1', PEPITO, 3)!;
    expect(llaveCorrespondeACedula(llave, '1098765432')).toBe(true);
    expect(llaveCorrespondeACedula(llave, FRANCESCO)).toBe(false);
    expect(llaveCorrespondeACedula(llave, '')).toBe(false);
    expect(llaveCorrespondeACedula(null, PEPITO)).toBe(false);
  });
});
