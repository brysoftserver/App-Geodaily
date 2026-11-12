import { expect, test } from '@jest/globals';
import { padronDelTecnico, trasladadoA, visitasHeredadas } from '../padronTecnico';
import type { BeneficiarioDB, Formulario } from '../../types';

const benef = (item: number, cedula: string, actual: string | null, anterior: string | null = null): BeneficiarioDB =>
  ({
    item,
    cedula,
    nombre_completo: `B${item}`,
    vereda: '',
    corregimiento: '',
    tecnico_asignado_id: actual,
    tecnico_asignado_nombre: actual === 'tec-013' ? 'Jhonathan Vega Suarez' : actual,
    tecnico_anterior_id: anterior,
  }) as BeneficiarioDB;

const form = (id: string, cedula: string, autor: string, tipo = 'caracterizacion'): Formulario =>
  ({ id, tipo, usuario_id: autor, tecnico: { usuario_id: autor, nombre: autor }, beneficiario: { cedula, nombre: 'x' } }) as any;

// Caso Miller (tec-006) → Suárez (tec-013); tec-010 es un tercero.
const padron = [
  benef(297, '111', 'tec-013', 'tec-006'),
  benef(26, '222', 'tec-013', 'tec-006'),
  benef(60, '333', 'tec-010'),
];

test('padrón del técnico nuevo: sus asignados de hoy', () => {
  expect(padronDelTecnico(padron, 'tec-013').map((b) => b.item)).toEqual([297, 26]);
});

test('padrón del técnico anterior: los que atendió (histórico)', () => {
  expect(padronDelTecnico(padron, 'tec-006').map((b) => b.item)).toEqual([297, 26]);
});

test('padrón de un técnico normal no cambia', () => {
  expect(padronDelTecnico(padron, 'tec-010').map((b) => b.item)).toEqual([60]);
  expect(padronDelTecnico(padron, null)).toEqual([]);
});

test('trasladadoA: solo cuando ya no tiene beneficiarios asignados', () => {
  expect(trasladadoA(padron, 'tec-006')).toBe('Jhonathan Vega Suarez');
  expect(trasladadoA(padron, 'tec-013')).toBeNull();
  expect(trasladadoA(padron, 'tec-010')).toBeNull();
});

test('visitas heredadas: solo las del técnico anterior en beneficiarios trasladados', () => {
  const forms = [
    form('a', '111', 'tec-006'),
    form('b', '1.1.1', 'tec-006', 'visita_tecnica'), // cédula con puntos: misma persona
    form('c', '111', 'tec-013', 'visita_tecnica'), // propia del técnico nuevo
    form('d', '333', 'tec-006'), // beneficiario de otro técnico, sin traslado
  ];
  const h = visitasHeredadas(padron, forms);
  expect(h.map((x) => x.formulario.id).sort()).toEqual(['a', 'b']);
  expect(h.every((x) => x.tecnicoActualId === 'tec-013')).toBe(true);
});
