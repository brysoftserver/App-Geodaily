// ============================================================
// GEODAILY — Tests del ítem 1 (Beneficiario) de la Visita Técnica
// ============================================================
// Cubre el reporte: "al terminar la visita 2 sale error del ítem 1
// Beneficiario, aunque el dato se auto-llena al capturarlo".
//
// La causa era que al retomar un borrador desde "Formularios Incompletos"
// no se restaurase el beneficiario guardado en el borrador: no llegan
// parámetros de navegación y el contexto puede estar vacío (la app se
// cerró, o el técnico venía de otro beneficiario).
// ============================================================

import { describe, expect, it } from '@jest/globals';

import {
  resolverBeneficiarioVisita,
  tieneDatosBeneficiario,
} from '../visitaTecnica';
import { DatosBeneficiario } from '../../types';

const beneficiario = (over: Partial<DatosBeneficiario> = {}): DatosBeneficiario => ({
  nombre: '',
  cedula: '',
  telefono: '',
  departamento: 'Caquetá',
  municipio: 'Puerto Rico',
  vereda: '',
  finca: '',
  ...over,
});

const VACIO = beneficiario();

describe('tieneDatosBeneficiario', () => {
  it('acepta un beneficiario con nombre', () => {
    expect(tieneDatosBeneficiario(beneficiario({ nombre: 'Ana Pérez' }))).toBe(true);
  });

  it('acepta un beneficiario solo con cédula (hay fichas sin nombre capturado)', () => {
    expect(tieneDatosBeneficiario(beneficiario({ cedula: '12345678' }))).toBe(true);
  });

  it('rechaza objetos vacíos, nulos o indefinidos', () => {
    expect(tieneDatosBeneficiario(VACIO)).toBe(false);
    expect(tieneDatosBeneficiario(null)).toBe(false);
    expect(tieneDatosBeneficiario(undefined)).toBe(false);
  });
});

describe('resolverBeneficiarioVisita', () => {
  it('prioriza el beneficiario que llega por parámetros de navegación', () => {
    const deParametros = beneficiario({ nombre: 'Param', cedula: '1' });
    const delContexto = beneficiario({ nombre: 'Contexto', cedula: '2' });
    const delBorrador = beneficiario({ nombre: 'Borrador', cedula: '3' });

    expect(
      resolverBeneficiarioVisita(deParametros, delContexto, delBorrador)?.nombre
    ).toBe('Param');
  });

  it('usa el del contexto cuando no hay parámetros', () => {
    const delContexto = beneficiario({ nombre: 'Contexto', cedula: '2' });

    expect(resolverBeneficiarioVisita(undefined, delContexto)?.nombre).toBe('Contexto');
  });

  it('usa el del borrador cuando no hay parámetros ni contexto (caso del reporte)', () => {
    const delBorrador = beneficiario({ nombre: 'Del borrador', cedula: '3' });

    expect(resolverBeneficiarioVisita(undefined, undefined, delBorrador)?.nombre).toBe(
      'Del borrador'
    );
  });

  it('ignora candidatos vacíos y toma el siguiente válido', () => {
    const delBorrador = beneficiario({ nombre: 'Real', cedula: '9' });

    expect(resolverBeneficiarioVisita(VACIO, null, delBorrador)?.nombre).toBe('Real');
  });

  it('devuelve undefined si ningún candidato tiene datos', () => {
    expect(resolverBeneficiarioVisita(VACIO, VACIO, undefined)).toBeUndefined();
    expect(resolverBeneficiarioVisita()).toBeUndefined();
  });
});

describe('flujo real: retomar un borrador reabre el ítem 1', () => {
  // Simula lo que hace `VisitaTecnicaFormScreen`:
  //   param (no hay, se entra desde "Formularios Incompletos")
  //   → contexto (vacío, la app se cerró)
  //   → borrador guardado (aquí está el dato)
  const contextoInicial: DatosBeneficiario | null = null;
  const borradorGuardado = beneficiario({
    nombre: 'María Gómez',
    cedula: '10987654',
    vereda: 'La Aguillilla',
  });

  it('el beneficiario del borrador evita el error "Beneficiario (ítem 1)"', () => {
    const resuelto = resolverBeneficiarioVisita(undefined, contextoInicial, borradorGuardado);

    expect(resuelto).toBeDefined();
    // Esto es exactamente lo que evalúa la validación `faltantes`.
    expect(resuelto?.nombre).toBeTruthy();
  });

  it('el borrador conserva los datos de ubicación de la ficha', () => {
    const resuelto = resolverBeneficiarioVisita(undefined, null, borradorGuardado);

    expect(resuelto?.cedula).toBe('10987654');
    expect(resuelto?.vereda).toBe('La Aguillilla');
  });

  it('un borrador sin beneficiario no inventa datos (cae al contexto)', () => {
    const delContexto = beneficiario({ nombre: 'Contexto Válido' });

    expect(resolverBeneficiarioVisita(undefined, delContexto, VACIO)?.nombre).toBe(
      'Contexto Válido'
    );
  });
});
