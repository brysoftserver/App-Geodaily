import { describe, expect, it } from '@jest/globals';

import {
  puedeEditarRespuestasFormulario,
  puedeGestionarEvidenciasFormulario,
  resolverDuenoFormulario,
} from '../permisosFormulario';

/**
 * Estos casos salen de un problema real en producción: un beneficiario se
 * reasignó a otro técnico y el formulario 1 (ya diligenciado por el técnico
 * anterior) quedó a nombre de éste. Al interventor pedirle al técnico nuevo
 * corregir unos datos, el guardado fallaba. La causa raíz se arregló en el
 * backend; estas pruebas fijan la regla del cliente para que no vuelva a
 * desalinearse con la del servidor.
 */
describe('resolverDuenoFormulario', () => {
  it('prefiere el snapshot tecnico.usuario_id (atribución vigente)', () => {
    expect(
      resolverDuenoFormulario({ tecnico: { usuario_id: 'tec-010' }, usuario_id: 'adm-001' })
    ).toBe('tec-010');
  });

  it('cae a la columna usuario_id cuando el snapshot no trae usuario_id', () => {
    expect(resolverDuenoFormulario({ tecnico: { usuario_id: '' }, usuario_id: 'tec-006' })).toBe(
      'tec-006'
    );
    expect(resolverDuenoFormulario({ tecnico: { usuario_id: null }, usuario_id: 'tec-006' })).toBe(
      'tec-006'
    );
    expect(resolverDuenoFormulario({ usuario_id: 'tec-006' })).toBe('tec-006');
  });

  it('devuelve null cuando no hay ninguna atribución', () => {
    expect(resolverDuenoFormulario({})).toBeNull();
    expect(resolverDuenoFormulario(null)).toBeNull();
    expect(resolverDuenoFormulario(undefined)).toBeNull();
  });
});

describe('puedeEditarRespuestasFormulario', () => {
  it('el técnico dueño sí puede', () => {
    expect(
      puedeEditarRespuestasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-003',
        duenoFormulario: 'tec-003',
      })
    ).toBe(true);
  });

  it('el técnico reasignado puede cuando el dueño ya es él (propietario reparado)', () => {
    // Beneficiario reasignado a tec-010; tras la reparación del backend el
    // formulario hereado queda a su nombre.
    expect(
      puedeEditarRespuestasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-010',
        duenoFormulario: 'tec-010',
      })
    ).toBe(true);
  });

  it('el técnico reasignado NO puede mientras el dueño siga siendo el anterior', () => {
    // Aquí es donde el cliente está en lo correcto al ocultar el botón: el
    // backend resuelve el dueño con el mismo criterio, así que el botón solo
    // se muestra cuando el guardado va a funcionar.
    expect(
      puedeEditarRespuestasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-010',
        duenoFormulario: 'tec-006',
      })
    ).toBe(false);
  });

  it('otro técnico no puede', () => {
    expect(
      puedeEditarRespuestasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-007',
        duenoFormulario: 'tec-003',
      })
    ).toBe(false);
  });

  it('sin dueño resuelto o sin sesión no puede (no se habilita "por si acaso")', () => {
    expect(
      puedeEditarRespuestasFormulario({ rol: 'tecnico', usuarioId: 'tec-010', duenoFormulario: null })
    ).toBe(false);
    expect(
      puedeEditarRespuestasFormulario({ rol: 'tecnico', usuarioId: null, duenoFormulario: 'tec-010' })
    ).toBe(false);
    expect(
      puedeEditarRespuestasFormulario({ rol: 'tecnico', usuarioId: '', duenoFormulario: '' })
    ).toBe(false);
  });

  it('el admin puede en cualquier formulario, incluso sin ser el dueño', () => {
    expect(
      puedeEditarRespuestasFormulario({
        rol: 'admin',
        usuarioId: 'adm-001',
        duenoFormulario: 'tec-006',
      })
    ).toBe(true);
  });

  it('interventor, coordinador, supervisor y gerente revisan pero no editan respuestas', () => {
    for (const rol of ['interventor', 'coordinador', 'supervisor', 'gerente']) {
      expect(puedeEditarRespuestasFormulario({ rol, usuarioId: 'int-009', duenoFormulario: 'int-009' })).toBe(
        false
      );
    }
  });
});

describe('puedeGestionarEvidenciasFormulario', () => {
  it('admin y coordinador pueden en cualquier formulario', () => {
    for (const rol of ['admin', 'coordinador']) {
      expect(
        puedeGestionarEvidenciasFormulario({ rol, usuarioId: 'x-001', duenoFormulario: 'tec-006' })
      ).toBe(true);
    }
  });

  it('el técnico solo en su propio formulario', () => {
    expect(
      puedeGestionarEvidenciasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-006',
        duenoFormulario: 'tec-006',
      })
    ).toBe(true);
    expect(
      puedeGestionarEvidenciasFormulario({
        rol: 'tecnico',
        usuarioId: 'tec-010',
        duenoFormulario: 'tec-006',
      })
    ).toBe(false);
  });

  it('interventor y supervisor no gestionan evidencias de campo', () => {
    for (const rol of ['interventor', 'supervisor', 'gerente']) {
      expect(
        puedeGestionarEvidenciasFormulario({ rol, usuarioId: 'int-009', duenoFormulario: 'int-009' })
      ).toBe(false);
    }
  });
});
