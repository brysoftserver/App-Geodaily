import { presentacionActa, limpiarFaltantes } from '../estadoActa';

describe('presentacionActa', () => {
  it('completada y subida → verde, en el servidor', () => {
    const p = presentacionActa('completada');
    expect(p.tono).toBe('verde');
    expect(p.sub).toMatch(/servidor/);
  });

  it('completada sin señal → verde igual (la subida va en la línea secundaria)', () => {
    const p = presentacionActa('pendiente_subir');
    expect(p.tono).toBe('verde');
    expect(p.sub).toMatch(/señal/);
  });

  it('completada en el servidor (otro dispositivo) → verde', () => {
    expect(presentacionActa('completada_servidor').tono).toBe('verde');
  });

  it('completada con pendientes → amarillo y los lista', () => {
    const p = presentacionActa('pendiente_subir', ['Firma del beneficiario', '', null]);
    expect(p.tono).toBe('amarillo');
    expect(p.txt).toContain('Firma del beneficiario');
    expect(p.txt).not.toMatch(/, ,|null/);
  });

  it('borradores → amarillo con botón Continuar', () => {
    for (const e of ['borrador', 'borrador_respaldado', 'borrador_servidor'] as const) {
      const p = presentacionActa(e, ['x']);
      expect(p.tono).toBe('amarillo');
      expect(p.boton).toMatch(/Continuar/);
    }
  });

  it('sin diligenciar → gris', () => {
    expect(presentacionActa('sin_diligenciar').tono).toBe('gris');
  });
});

describe('limpiarFaltantes', () => {
  it('tolera valores que no son lista', () => {
    expect(limpiarFaltantes(undefined)).toEqual([]);
    expect(limpiarFaltantes('Predio')).toEqual([]);
    expect(limpiarFaltantes([' Predio ', 3])).toEqual(['Predio', '3']);
  });
});
