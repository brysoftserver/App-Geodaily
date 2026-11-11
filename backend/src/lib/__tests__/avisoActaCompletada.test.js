// ============================================================
// GEODAILY — Pruebas: aviso a la interventoría al completar un acta
//   node --test src/lib/__tests__/
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { debeAvisarActa, textoAvisoActa, avisarActaCompletada } = require('../avisoActaCompletada');

const FIRMA = 'data:image/png;base64,xx';
const base = { tipo: 'acta_entrega_individual', completo: true, previoCompleto: false };

test('debeAvisarActa: primera vez, actividad con firma, sin firma del interventor → sí', () => {
  for (const a of ['siembra_platano', 'siembra_forestales', 'siembra_cacao', 'preparacion_terreno', 'siembra_platano.fertilizacion']) {
    assert.equal(debeAvisarActa({ ...base, datos: { actividadId: a } }), true, a);
  }
});

test('debeAvisarActa: no repite, no avisa ya firmada, ni sin actividad, ni otros formatos', () => {
  assert.equal(debeAvisarActa({ ...base, previoCompleto: true, datos: { actividadId: 'siembra_platano' } }), false);
  assert.equal(debeAvisarActa({ ...base, datos: { actividadId: 'siembra_platano', firmaInterventoria: FIRMA } }), false);
  assert.equal(debeAvisarActa({ ...base, datos: {} }), false);
  assert.equal(debeAvisarActa({ ...base, datos: { actividadId: 'fertilizacion' } }), false);
  assert.equal(debeAvisarActa({ ...base, tipo: 'acta_compromiso', datos: { actividadId: 'siembra_platano' } }), false);
  assert.equal(debeAvisarActa({ ...base, completo: false, datos: { actividadId: 'siembra_platano' } }), false);
});

test('textoAvisoActa: entrega con número', () => {
  const t = textoAvisoActa({
    datos: { actividadId: 'siembra_platano' },
    beneficiarioNombre: 'Bernardo Arturo',
    tecnicoNombre: 'Deily Torres',
    entregaNumero: 3,
  });
  assert.equal(t.titulo, '📦 Acta completada · Siembra de Plátano');
  assert.match(t.mensaje, /Entrega de Colinos de Plátano · Entrega 3/);
  assert.match(t.mensaje, /Beneficiario: Bernardo Arturo/);
  assert.match(t.mensaje, /Técnico: Deily Torres/);
  assert.match(t.mensaje, /revísela y fírmela/);
});

test('textoAvisoActa: preparación del terreno y subactividad', () => {
  assert.match(textoAvisoActa({ datos: { actividadId: 'preparacion_terreno', nombre: 'Ana' } }).mensaje, /^Preparación del Terreno · Beneficiario: Ana/);
  const t = textoAvisoActa({ datos: { actividadId: 'siembra_cacao.fertilizacion' } });
  assert.equal(t.titulo, '📦 Acta completada · Siembra de Cacao');
  assert.match(t.mensaje, /^Fertilización · /);
});

test('avisarActaCompletada: avisa a cada interventor activo con los datos para abrir el acta', async () => {
  const enviadas = [];
  const db = {
    queryOne: async () => ({ numero: 7 }),
    queryAll: async () => [{ id: 'int-1' }, { id: 'int-2' }],
  };
  const n = await avisarActaCompletada({
    db,
    crearNotificacion: async (...a) => enviadas.push(a),
    id: 'of-acta_entrega_individual-123-abc',
    cedula: '123',
    instancia: 'abc',
    datos: { actividadId: 'siembra_forestales' },
    beneficiarioNombre: 'Ana',
  });
  assert.equal(n, 2);
  assert.deepEqual(enviadas.map((e) => e[0]), ['int-1', 'int-2']);
  assert.equal(enviadas[0][1], 'acta_por_firmar');
  assert.match(enviadas[0][3], /Entrega de Plántulas Forestales · Entrega 7/);
  assert.deepEqual(enviadas[0][5], {
    actaId: 'of-acta_entrega_individual-123-abc',
    cedula: '123',
    instancia: 'abc',
    actividadId: 'siembra_forestales',
    beneficiarioNombre: 'Ana',
    titulo: 'Acta · Entrega 7',
  });
});

test('avisarActaCompletada: nunca lanza', async () => {
  const db = { queryOne: async () => { throw new Error('db caída'); }, queryAll: async () => [] };
  const n = await avisarActaCompletada({ db, crearNotificacion: async () => {}, id: 'x', cedula: '1', instancia: 'i', datos: { actividadId: 'siembra_platano' } });
  assert.equal(n, 0);
});
