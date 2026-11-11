// Guardado local de "Otros formatos" contra un SQLite REAL (node:sqlite), no
// un simulacro: las pruebas anteriores mockeaban la base y no podían ver que
// el INSERT del Acta de Entrega fallaba en los teléfonos.

jest.mock('expo-sqlite', () => {
  const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
  const estado: { conexion: any; crudo: any } = { conexion: null, crudo: null };
  const envolver = (d: any) => ({
    execAsync: async (sql: string) => {
      d.exec(sql);
    },
    runAsync: async (sql: string, params: any[] = []) => {
      const r = d.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async (sql: string, params: any[] = []) => d.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: any[] = []) => d.prepare(sql).get(...params) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      d.exec('BEGIN');
      try {
        await fn();
        d.exec('COMMIT');
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  });
  return {
    openDatabaseAsync: async () => {
      if (!estado.conexion) {
        estado.crudo = new DatabaseSync(':memory:');
        estado.conexion = envolver(estado.crudo);
      }
      return estado.conexion;
    },
    __estado: estado,
  };
});

const FIRMA = `data:image/png;base64,${'A'.repeat(120_000)}`;

const formato = (instancia: string, extra: Record<string, any> = {}) => ({
  tecnico_id: 'tec-1',
  tecnico_nombre: 'Técnico',
  tecnico_usuario: 'tecnico',
  beneficiario_cedula: '17646484',
  beneficiario_nombre: 'Beneficiario',
  tipo: 'acta_entrega_individual',
  datos: { instancia, nombre: 'Beneficiario', firmaBeneficiario: FIRMA, firmaTecnico: FIRMA, firmaInterventoria: FIRMA, ...extra },
  completo: true,
});

describe('otros_formatos_locales con SQLite real', () => {
  beforeEach(() => {
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    sqlite.__estado.conexion = null;
    sqlite.__estado.crudo = null;
  });

  it('guarda un acta con 3 firmas, la lee y la marca subida solo si no cambió', async () => {
    const db = require('../database');
    await db.initDatabase();
    await db.saveOtroFormatoLocal(formato('emwatmbxf761b'));
    const id = db.idOtroFormato('acta_entrega_individual', '17646484', 'emwatmbxf761b');

    const leido = await db.getOtroFormatoLocalPorId(id);
    expect(leido?.datos.firmaBeneficiario).toBe(FIRMA);
    expect(leido?.sincronizado).toBe(false);
    const pendientes = await db.getOtrosFormatosNoSincronizados();
    expect(pendientes.map((p: any) => p.id)).toContain(id);

    expect(await db.marcarOtroFormatoSincronizadoSiSinCambios(id, 'otra-fecha')).toBe(false);
    expect(await db.marcarOtroFormatoSincronizadoSiSinCambios(id, leido!.updated_at)).toBe(true);
    expect((await db.getOtroFormatoLocalPorId(id))?.sincronizado).toBe(true);
  });

  it('volver a guardar la misma acta actualiza la fila y la deja pendiente otra vez', async () => {
    const db = require('../database');
    await db.initDatabase();
    await db.saveOtroFormatoLocal(formato('e1'));
    const id = db.idOtroFormato('acta_entrega_individual', '17646484', 'e1');
    const v1 = await db.getOtroFormatoLocalPorId(id);
    await db.marcarOtroFormatoSincronizadoSiSinCambios(id, v1!.updated_at);
    await new Promise((r) => setTimeout(r, 5));
    await db.saveOtroFormatoLocal(formato('e1', { predio: 'El Roble' }));
    const v2 = await db.getOtroFormatoLocalPorId(id);
    expect(v2?.datos.predio).toBe('El Roble');
    expect(v2?.sincronizado).toBe(false);
    expect(v2?.created_at).toBe(v1?.created_at);
    expect((await db.getOtrosFormatosLocales('17646484')).length).toBe(1);
  });

  it('repara una tabla creada por una versión vieja (sin columnas) y guarda sin borrar lo que había', async () => {
    const sqlite = require('expo-sqlite');
    const conexion = await sqlite.openDatabaseAsync('geodaily.db');
    // Tabla vieja: sin `completo` ni `sincronizado`, con una fila previa.
    await conexion.execAsync(`
      CREATE TABLE otros_formatos_locales (
        id TEXT PRIMARY KEY, tecnico_id TEXT, tecnico_nombre TEXT, tecnico_usuario TEXT,
        beneficiario_cedula TEXT NOT NULL, beneficiario_nombre TEXT, tipo TEXT NOT NULL,
        datos TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO otros_formatos_locales (id, beneficiario_cedula, tipo, datos, created_at, updated_at)
      VALUES ('of-evaluacion_eca-96353946', '96353946', 'evaluacion_eca', '{"a":1}', '2026-10-27', '2026-10-27');
    `);
    const db = require('../database');
    await db.initDatabase();
    await db.saveOtroFormatoLocal(formato('e2'));

    const id = db.idOtroFormato('acta_entrega_individual', '17646484', 'e2');
    expect((await db.getOtroFormatoLocalPorId(id))?.datos.firmaTecnico).toBe(FIRMA);
    // La fila vieja sigue ahí.
    expect((await db.getOtroFormatoLocalPorId('of-evaluacion_eca-96353946'))?.datos).toEqual({ a: 1 });
  });

  it('guarda en la tabla vieja con datos_json NOT NULL (esquema real reportado por el teléfono de Deily)', async () => {
    const sqlite = require('expo-sqlite');
    const conexion = await sqlite.openDatabaseAsync('geodaily.db');
    await conexion.execAsync(`
      CREATE TABLE otros_formatos_locales (
        id TEXT PRIMARY KEY,
        tecnico_id TEXT,
        tecnico_nombre TEXT,
        tecnico_usuario TEXT,
        beneficiario_cedula TEXT NOT NULL,
        beneficiario_nombre TEXT,
        tipo TEXT NOT NULL,
        datos_json TEXT NOT NULL,
        completo INTEGER DEFAULT 1,
        sincronizado INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const db = require('../database');
    await db.initDatabase();
    await db.saveOtroFormatoLocal(formato('emwatmbxf761b'));
    // Segundo guardado (actualización) por la misma vía.
    await db.saveOtroFormatoLocal(formato('emwatmbxf761b', { predio: 'La Esperanza' }));
    const id = db.idOtroFormato('acta_entrega_individual', '17646484', 'emwatmbxf761b');
    const leido = await db.getOtroFormatoLocalPorId(id);
    expect(leido?.datos.firmaBeneficiario).toBe(FIRMA);
    expect(leido?.datos.predio).toBe('La Esperanza');
    expect((await db.getOtrosFormatosNoSincronizados()).map((p: any) => p.id)).toContain(id);
  });

  it('un guardado no queda dentro de la transacción larga de beneficiarios', async () => {
    const db = require('../database');
    await db.initDatabase();
    const conexion = await db.getDbSafe();
    let liberar: () => void = () => {};
    const transaccion = db.ejecutarTransaccionLarga(() =>
      conexion.withTransactionAsync(async () => {
        await new Promise<void>((r) => (liberar = r));
        throw new Error('falla el espejo de beneficiarios');
      })
    );
    const guardado = db.saveOtroFormatoLocal(formato('e3'));
    await new Promise((r) => setTimeout(r, 10));
    liberar();
    await expect(transaccion).rejects.toThrow('falla el espejo');
    await guardado;
    const id = db.idOtroFormato('acta_entrega_individual', '17646484', 'e3');
    // Sin el candado, el ROLLBACK de la otra transacción se habría llevado el acta.
    expect(await db.getOtroFormatoLocalPorId(id)).not.toBeNull();
  });
});
