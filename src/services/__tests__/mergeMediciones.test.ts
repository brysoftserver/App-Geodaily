// Fusión del historial de mediciones traído del servidor al SQLite local.

const mockInsertadas: unknown[][] = [];
let mockLocales: { id: string; sincronizado: number }[] = [];
let mockFormularios: { id: string }[] = [];

const mockDb = {
  execAsync: jest.fn(async () => undefined),
  getFirstAsync: jest.fn(async () => null),
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT id, sincronizado FROM mediciones_terreno')) return mockLocales;
    if (sql === 'SELECT id FROM formularios') return mockFormularios;
    return [];
  }),
  runAsync: jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('INSERT OR REPLACE INTO mediciones_terreno')) mockInsertadas.push(params);
    return { changes: 1, lastInsertRowId: 0 };
  }),
};

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

import { mergeMedicionesDelServidor } from '../database';

const puntos = [
  { latitud: 2.1, longitud: -75.1 },
  { latitud: 2.2, longitud: -75.2 },
  { latitud: 2.3, longitud: -75.1 },
];

beforeEach(() => {
  mockInsertadas.length = 0;
  mockLocales = [];
  mockFormularios = [];
});

describe('mergeMedicionesDelServidor', () => {
  it('inserta las del servidor como sincronizadas y respeta las pendientes locales', async () => {
    mockLocales = [{ id: 'pendiente', sincronizado: 0 }, { id: 'vieja', sincronizado: 1 }];
    mockFormularios = [{ id: 'form-local' }];
    const n = await mergeMedicionesDelServidor([
      { id: 'pendiente', puntos, area_hectareas: 9 },
      { id: 'vieja', puntos, area_hectareas: 1.5, area_metros2: 15000, perimetro_metros: 500,
        nombre: 'Lote 1', formulario_id: 'form-local', usuario_id: 'tec-1', timestamp: '2026-11-01T15:00:00.000Z' },
      { id: 'otro-form', puntos, tipo_medicion: 'area', valor: 2, formulario_id: 'form-remoto' },
      { id: 'sin-puntos', puntos: [] },
      { id: '' , puntos },
    ]);
    expect(n).toBe(2);
    const ids = mockInsertadas.map((p) => p[0]);
    expect(ids).toEqual(['vieja', 'otro-form']);

    const [, formId, formPend, usuario, ha, m2, per, pts, nombre, , , , , , creada] = mockInsertadas[0];
    expect([formId, formPend, usuario, ha, m2, per, nombre, creada]).toEqual(
      ['form-local', null, 'tec-1', 1.5, 15000, 500, 'Lote 1', '2026-11-01T15:00:00.000Z']);
    expect(JSON.parse(pts as string)).toEqual(puntos);

    // Formulario que no existe localmente → queda pendiente de vincular; área desde `valor`.
    expect(mockInsertadas[1].slice(1, 3)).toEqual([null, 'form-remoto']);
    expect(mockInsertadas[1][4]).toBe(2);
    expect(mockInsertadas[1][5]).toBe(20000);
  });

  it('lista vacía o inválida no toca la base', async () => {
    expect(await mergeMedicionesDelServidor([])).toBe(0);
    expect(await mergeMedicionesDelServidor(null as any)).toBe(0);
    expect(mockInsertadas).toHaveLength(0);
  });
});
