// Informes PDF de la Bitácora: el HTML lleva el membrete de interventoría y
// resume visitas y actividades sin valores rotos.
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ moveAsync: jest.fn() }));
jest.mock('../pdfLocal.service', () => ({
  escapeHtml: (t: string) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));
jest.mock('../informeTecnicoPdf.service', () => ({ abrirPdf: jest.fn() }));
jest.mock('../../utils/printWeb', () => ({ descargarHtmlComoPdfWeb: jest.fn() }));
jest.mock('../actividadesHectareas.service', () => ({
  formatearHectareas: (n: number) => String(n).replace('.', ','),
}));

import { htmlInformeBeneficiario, htmlInformeGeneral } from '../bitacoraPdf.service';
import { BitacoraFicha, BitacoraFilaInforme } from '../bitacora.service';
import { ENTIDADES } from '../../utils/membrete';

const prep = { id: 'preparacion_terreno', hectareas: 2.5, respaldadaPorVisita: 2, actas: 1, observacionesPendientes: 1, fotos: { antes: 2, durante: 0, despues: 3 } };

const ficha: BitacoraFicha = {
  beneficiario: { item: 7, nombre: 'Ana <Prueba> Pérez', cedula: '123', telefono: null, correo: null, departamento: 'CAQUETA', municipio: 'PUERTO RICO', corregimiento: 'LA AGUILILLA', vereda: 'El Líbano', tecnico: 'Técnico Uno' },
  predio: { nombre: 'La Cabaña', area: 16.6, calidad: 'propietario' },
  ubicacion: { registrada: { latitud: 2.0076206, longitud: -75.0015314 }, gpsVisita1: null },
  visitas: [
    { id: 'b', tipo: 'visita_tecnica', numero: 2, fecha: '2026-10-23T15:00:00Z', tecnico: 'Técnico Uno' },
    { id: 'a', tipo: 'caracterizacion', numero: 1, fecha: '2026-10-06T15:00:00Z', tecnico: 'Técnico Uno' },
  ],
  actividades: { analisisSuelos: { subido: false }, enHectareas: [prep] },
};

const filas: BitacoraFilaInforme[] = [
  { item: 1, nombre: 'Ana Pérez', cedula: '123', corregimiento: 'X', vereda: 'Y', tecnico: 'Técnico Uno', visitas: [{ numero: 1, fecha: '2026-10-06T15:00:00Z' }, { numero: 2, fecha: '2026-10-23T15:00:00Z' }], suelos: { fecha: '2026-10-30T15:00:00Z' }, enHectareas: [prep] },
  { item: 2, nombre: 'Luis Gómez', cedula: '456', corregimiento: 'X', vereda: 'Z', tecnico: null, visitas: [], suelos: null, enHectareas: [] },
];

const sinValoresRotos = (html: string) => {
  expect(html).not.toMatch(/undefined|NaN|\[object/);
};

describe('Informes PDF de la Bitácora', () => {
  it('el informe individual lleva el membrete de interventoría y escapa el HTML', () => {
    const html = htmlInformeBeneficiario(ficha, 'Interventor Uno');
    expect(html).toContain(ENTIDADES.interventoria.logo.slice(0, 40));
    expect(html).toContain('Informe del Beneficiario');
    expect(html).toContain('Ana &lt;Prueba&gt; Pérez');
    expect(html).toContain('Visita 1');
    expect(html).toContain('Visita 2');
    expect(html).toContain('Sin registrar'); // teléfono y correo
    expect(html).toContain('1 observación pendiente');
    sinValoresRotos(html);
  });

  it('el informe individual no lista actividades aún no conectadas', () => {
    const conPendiente: BitacoraFicha = {
      ...ficha,
      actividades: { ...ficha.actividades, enHectareas: [prep, { ...prep, id: 'siembra_cacao', hectareas: 0, actas: 0, observacionesPendientes: 0, fotos: { antes: 0, durante: 0, despues: 0 } }] },
    };
    const html = htmlInformeBeneficiario(conPendiente, 'Interventor Uno');
    expect(html).toContain('Preparación del Terreno');
    expect(html).not.toContain('Siembra de Cacao');
  });

  it('el informe general agrupa por técnico y totaliza', () => {
    const html = htmlInformeGeneral(filas, 'Interventor Uno');
    expect(html).toContain('Informe General');
    expect(html).toContain('Sin técnico asignado');
    expect(html).toContain('Técnico Uno');
    expect(html).toMatch(/<b>2<\/b><span>Beneficiarios/);
    expect(html).toMatch(/<b>1<\/b><span>Con Visita 1 \(50%\)/);
    sinValoresRotos(html);
  });

  it('el informe general no se rompe sin beneficiarios', () => {
    const html = htmlInformeGeneral([], '');
    expect(html).toContain('Informe General');
    sinValoresRotos(html);
  });
});
