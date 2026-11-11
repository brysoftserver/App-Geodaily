jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///doc/' }));
jest.mock('../api', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
jest.mock('../pdfLocal.service', () => ({}));
jest.mock('../archivos.service', () => ({ cabecerasDeArchivo: async () => ({}) }));
jest.mock('../database', () => ({ idOtroFormato: () => 'x' }));

import { calcularFaltantesActa, construirDatosActa } from '../otrosFormatos.service';

const FIRMA_A = 'data:image/png;base64,AAAA';
const FIRMA_B = 'data:image/png;base64,BBBB';

const publicada = {
  nombre: 'Ana Pérez',
  cedula: '123',
  tipoDocumento: 'CC',
  instancia: 'e1',
  actividadId: 'siembra_platano',
  fecha: '2026-11-01T15:00:00.000Z',
  corregimiento: 'Centro',
  vereda: 'La Loma',
  predio: 'El Roble',
  actividades: [{ descripcion: 'Realizar siembra de plátano.', actividad: '4', cantidad: '100', unidad: 'Colino' }],
  contratistaNombre: 'Técnico',
  contratistaCargo: 'Técnico de campo',
  interventoriaNombre: '',
  interventoriaCargo: '',
  firmaBeneficiario: '',
  firmaTecnico: FIRMA_A,
  firmaInterventoria: null,
  faltantes: ['Firma del beneficiario'],
};

describe('construirDatosActa', () => {
  it('agrega la firma hecha al reabrir y quita ese pendiente', () => {
    const d = construirDatosActa({ ...publicada, firmaBeneficiario: FIRMA_B }, publicada);
    expect(d.firmaBeneficiario).toBe(FIRMA_B);
    expect(d.faltantes).toEqual([]);
  });

  it('nunca reemplaza una firma publicada por vacío (borrador con firma ilegible)', () => {
    const d = construirDatosActa({ ...publicada, firmaTecnico: null }, publicada);
    expect(d.firmaTecnico).toBe(FIRMA_A);
  });

  it('conserva fecha, instancia y actividad de la versión publicada', () => {
    const d = construirDatosActa({ ...publicada, fecha: 'otra', instancia: 'x', actividadId: 'y', firmaBeneficiario: FIRMA_B }, publicada);
    expect(d.fecha).toBe(publicada.fecha);
    expect(d.instancia).toBe('e1');
    expect(d.actividadId).toBe('siembra_platano');
  });

  it('un acta generada con PDF (sin pendientes) sigue sin pendientes', () => {
    const generada = { ...publicada, firmaBeneficiario: FIRMA_B, faltantes: [] };
    const d = construirDatosActa({ ...generada, predio: '' }, generada);
    expect(d.faltantes).toEqual([]);
  });

  it('descarta filas de actividades sin descripción', () => {
    const d = construirDatosActa({ ...publicada, actividades: [...publicada.actividades, { descripcion: '  ', actividad: '', cantidad: '', unidad: '' }] }, publicada);
    expect(d.actividades).toHaveLength(1);
  });
});

describe('calcularFaltantesActa', () => {
  it('lista lo que falta', () => {
    expect(calcularFaltantesActa({ actividades: [], firmaTecnico: FIRMA_A })).toEqual([
      'Actividades entregadas',
      'Predio',
      'Vereda',
      'Corregimiento',
      'Firma del beneficiario',
    ]);
  });
});
