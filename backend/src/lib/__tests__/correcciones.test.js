// ============================================================
// GEODAILY — Pruebas: correcciones del técnico sobre novedades
//   node --test src/lib/__tests__/
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { novedadEstaCorregida, ACCIONES_CORRECCION, notificarCorreccion } = require('../correcciones');

test('novedadEstaCorregida: corrección posterior → por verificar', () => {
  assert.equal(
    novedadEstaCorregida('2026-09-29T21:11:58Z', [{ created_at: '2026-09-30T21:53:30Z' }]),
    true
  );
});

test('novedadEstaCorregida: corrección anterior a la novedad no cuenta', () => {
  assert.equal(
    novedadEstaCorregida('2026-09-29T21:11:58Z', [{ created_at: '2026-09-20T10:00:00Z' }]),
    false
  );
});

test('novedadEstaCorregida: sin correcciones o fecha inválida', () => {
  assert.equal(novedadEstaCorregida('2026-09-29T21:11:58Z', []), false);
  assert.equal(novedadEstaCorregida('2026-09-29T21:11:58Z', undefined), false);
  assert.equal(novedadEstaCorregida('no-es-fecha', [{ created_at: '2026-09-30T00:00:00Z' }]), false);
});

test('las re-sincronizaciones automáticas NO cuentan como corrección', () => {
  assert.ok(!ACCIONES_CORRECCION.includes('actualizar_formulario'));
  assert.ok(!ACCIONES_CORRECCION.includes('guardar_formulario'));
});

/** db falso: responde según el texto de la consulta. */
const dbFalso = ({ revisores, yaAvisados = [] }) => ({
  // Una novedad abierta por cada revisor (lo que lee revisiones_formulario).
  queryAll: async () =>
    revisores.map((id, i) => ({
      id: i + 1,
      revisor_id: id,
      revisor_rol: i === 0 ? 'coordinador' : 'interventor',
      tipo: 'novedad',
      seccion: 'A',
      created_at: '2026-09-29T15:00:00Z',
    })),
  queryOne: async (sql, params) => {
    if (sql.includes('FROM formularios')) return { beneficiario: 'Pedro Andrade' };
    if (sql.includes('FROM notificaciones')) return yaAvisados.includes(params[0]) ? { id: 1 } : null;
    return null;
  },
});

test('notificarCorreccion: avisa a cada revisor con novedades pendientes', async () => {
  const enviados = [];
  const n = await notificarCorreccion(
    dbFalso({ revisores: ['sup-002', 'int-001'] }),
    async (...args) => enviados.push(args),
    { formularioId: 'f1', autor: { id: 'tec-007', nombre: 'Deily' } }
  );
  assert.equal(n, 2);
  assert.equal(enviados[0][0], 'sup-002');
  assert.equal(enviados[0][1], 'correccion_formulario');
  assert.match(enviados[0][2], /Pedro Andrade/);
  assert.equal(enviados[0][4], 'f1');
});

test('notificarCorreccion: no repite si el revisor tiene un aviso sin leer', async () => {
  const enviados = [];
  const n = await notificarCorreccion(
    dbFalso({ revisores: ['sup-002'], yaAvisados: ['sup-002'] }),
    async (...args) => enviados.push(args),
    { formularioId: 'f1', autor: { id: 'tec-007' } }
  );
  assert.equal(n, 0);
  assert.equal(enviados.length, 0);
});

test('notificarCorreccion: nunca lanza aunque la BD falle', async () => {
  const roto = { queryAll: async () => { throw new Error('caída'); }, queryOne: async () => null };
  const n = await notificarCorreccion(roto, async () => {}, { formularioId: 'f1', autor: {} });
  assert.equal(n, 0);
});
