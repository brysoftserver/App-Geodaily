import { presentacionActa, limpiarFaltantes, combinarActa, esFirmaDibujada, unirActasBeneficiario, resumirActas } from '../estadoActa';

describe('presentacionActa', () => {
  it('completa por el técnico sin firma del interventor → amarillo, avisa que falta el interventor', () => {
    const p = presentacionActa('completada');
    expect(p.tono).toBe('amarillo');
    expect(p.txt).toBe('✓ Acta completa por parte del técnico');
    expect(p.tonoTxt).toBe('verde');
    expect(p.interventor?.txt).toMatch(/Falta firma del interventor/);
    expect(p.sub).toMatch(/servidor/);
  });

  it('completa y firmada por el interventor → verde', () => {
    const p = presentacionActa('completada_servidor', [], true);
    expect(p.tono).toBe('verde');
    expect(p.interventor).toEqual({ txt: '✓ Firmada por el interventor', tono: 'verde' });
  });

  it('completada sin señal → la subida va en la línea secundaria, no cambia el tono', () => {
    const p = presentacionActa('pendiente_subir', [], true);
    expect(p.tono).toBe('verde');
    expect(p.sub).toMatch(/señal/);
  });

  it('completada con pendientes → amarillo aunque el interventor haya firmado', () => {
    const p = presentacionActa('completada', ['Firma del beneficiario', '', null], true);
    expect(p.tono).toBe('amarillo');
    expect(p.txt).toContain('Firma del beneficiario');
    expect(p.txt).not.toMatch(/, ,|null/);
  });

  it('borradores → sin color (gris), sin línea de interventor, botón Continuar', () => {
    for (const e of ['borrador', 'borrador_respaldado', 'borrador_servidor'] as const) {
      const p = presentacionActa(e, ['x'], true);
      expect(p.tono).toBe('gris');
      expect(p.txt).toBe('⏳ Acta en borrador');
      expect(p.interventor).toBeNull();
      expect(p.boton).toMatch(/Continuar/);
    }
  });

  it('sin diligenciar → gris', () => {
    const p = presentacionActa('sin_diligenciar');
    expect(p.tono).toBe('gris');
    expect(p.interventor).toBeNull();
  });
});

describe('combinarActa', () => {
  const nada = { estado: 'sin_diligenciar' as const, faltantes: [], firmaInterventoria: false };

  it('tablet sin el acta local: usa la publicada del servidor', () => {
    const r = combinarActa(nada, { estado: 'publicada', firmaInterventoria: false, faltantes: ['Predio'] });
    expect(r).toEqual({ estado: 'completada_servidor', faltantes: ['Predio'], firmaInterventoria: false });
  });

  it('completada en el teléfono: manda, pero toma la firma del interventor del servidor', () => {
    const r = combinarActa(
      { estado: 'pendiente_subir', faltantes: [], firmaInterventoria: false },
      { estado: 'publicada', firmaInterventoria: true, faltantes: ['viejo'] }
    );
    expect(r).toEqual({ estado: 'pendiente_subir', faltantes: [], firmaInterventoria: true });
  });

  it('borrador local pero ya publicada en el servidor: se ve completada', () => {
    const r = combinarActa({ estado: 'borrador', faltantes: [], firmaInterventoria: false }, { estado: 'publicada', firmaInterventoria: false });
    expect(r.estado).toBe('completada_servidor');
  });

  it('solo borrador en el servidor', () => {
    expect(combinarActa(nada, { estado: 'borrador', firmaInterventoria: true }).estado).toBe('borrador_servidor');
  });

  it('sin servidor (sin señal): queda lo del teléfono', () => {
    const tel = { estado: 'borrador_respaldado' as const, faltantes: [], firmaInterventoria: false };
    expect(combinarActa(tel, undefined)).toBe(tel);
    expect(combinarActa(nada, null)).toBe(nada);
  });
});

describe('utilidades', () => {
  it('limpiarFaltantes tolera valores que no son lista', () => {
    expect(limpiarFaltantes(undefined)).toEqual([]);
    expect(limpiarFaltantes('Predio')).toEqual([]);
    expect(limpiarFaltantes([' Predio ', 3])).toEqual(['Predio', '3']);
  });

  it('esFirmaDibujada', () => {
    expect(esFirmaDibujada('data:image/png;base64,xx')).toBe(true);
    expect(esFirmaDibujada('')).toBe(false);
    expect(esFirmaDibujada(null)).toBe(false);
  });
});


describe('unirActasBeneficiario', () => {
  it('servidor: publicada → completada_servidor; borrador → borrador_servidor', () => {
    const r = unirActasBeneficiario([
      { id: 'a', estado: 'publicada', firmaInterventoria: true, faltantes: [] },
      { id: 'b', estado: 'borrador', firmaInterventoria: true },
    ]);
    expect(r).toEqual([
      { estado: 'completada_servidor', faltantes: [], firmaInterventoria: true },
      { estado: 'borrador_servidor', faltantes: [], firmaInterventoria: false },
    ]);
  });

  it('lo completado en el teléfono pisa al borrador del servidor y conserva la firma del servidor', () => {
    const r = unirActasBeneficiario(
      [{ id: 'a', estado: 'publicada', firmaInterventoria: true }],
      [{ id: 'a', sincronizado: false, faltantes: [], firmaInterventoria: false }, { id: 'c', sincronizado: true, faltantes: ['Predio'], firmaInterventoria: false }]
    );
    expect(r).toEqual([
      { estado: 'pendiente_subir', faltantes: [], firmaInterventoria: true },
      { estado: 'completada', faltantes: ['Predio'], firmaInterventoria: false },
    ]);
  });
});

describe('resumirActas', () => {
  const firmada = { estado: 'completada_servidor' as const, faltantes: [], firmaInterventoria: true };
  const sinFirma = { estado: 'completada_servidor' as const, faltantes: [], firmaInterventoria: false };
  const borrador = { estado: 'borrador_servidor' as const, faltantes: [], firmaInterventoria: false };

  it('prioriza la que necesita algo', () => {
    expect(resumirActas([firmada, borrador, sinFirma])).toEqual({ acta: sinFirma, total: 3 });
  });

  it('todas firmadas → una firmada; solo borrador → borrador; nada → sin diligenciar', () => {
    expect(resumirActas([firmada]).acta).toBe(firmada);
    expect(resumirActas([borrador]).acta).toBe(borrador);
    expect(resumirActas([])).toEqual({ acta: { estado: 'sin_diligenciar', faltantes: [], firmaInterventoria: false }, total: 0 });
  });
});
