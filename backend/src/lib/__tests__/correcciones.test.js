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

// ── Sin novedades abiertas (caso Jonathan Molano, nov-2026) ──────────────
/** db falso por texto de consulta: revisiones del formulario, correcciones y revisor del técnico. */
const dbSinNovedad = ({ revisiones = [], correcciones = [], revisorDelTecnico = null }) => ({
  queryAll: async (sql) => {
    if (sql.includes('FROM actividad_log')) return correcciones;
    return revisiones;
  },
  queryOne: async (sql) => {
    if (sql.includes('FROM formularios WHERE id = $1') && sql.includes('beneficiario')) return { beneficiario: 'Segundo Alfonso' };
    if (sql.includes('FROM notificaciones')) return null;
    if (sql.includes('JOIN formularios f')) return revisorDelTecnico ? { revisor_id: revisorDelTecnico } : null;
    return null;
  },
});

test('notificarCorreccion: sin novedad y nadie revisó el formulario → avisa al coordinador habitual del técnico', async () => {
  const enviados = [];
  const n = await notificarCorreccion(
    dbSinNovedad({ correcciones: [{ created_at: '2026-11-11T16:39:36Z' }], revisorDelTecnico: 'sup-002' }),
    async (...args) => enviados.push(args),
    { formularioId: 'f1', autor: { id: 'tec-010', nombre: 'Jonathan' } }
  );
  assert.equal(n, 1);
  assert.equal(enviados[0][0], 'sup-002');
  assert.match(enviados[0][3], /corrigió o completó/);
});

test('notificarCorreccion: sin novedad → avisa al coordinador que ya revisó ESTE formulario', async () => {
  const enviados = [];
  const n = await notificarCorreccion(
    dbSinNovedad({
      revisiones: [{ id: 1, revisor_id: 'sup-008', revisor_rol: 'coordinador', tipo: 'visto_bueno', seccion: 'A', created_at: '2026-11-10T10:00:00Z' }],
      correcciones: [{ created_at: '2026-11-11T09:00:00Z' }],
      revisorDelTecnico: 'sup-002',
    }),
    async (...args) => enviados.push(args),
    { formularioId: 'f1', autor: { id: 'tec-010' } }
  );
  assert.equal(n, 1);
  assert.equal(enviados[0][0], 'sup-008');
});

test('notificarCorreccion: el revisor ya vio la corrección (movió después) → no avisa', async () => {
  const enviados = [];
  const n = await notificarCorreccion(
    dbSinNovedad({
      revisiones: [{ id: 1, revisor_id: 'sup-002', revisor_rol: 'coordinador', tipo: 'visto_bueno', seccion: 'A', created_at: '2026-11-11T16:52:00Z' }],
      correcciones: [{ created_at: '2026-11-11T16:40:05Z' }],
      revisorDelTecnico: 'sup-002',
    }),
    async (...args) => enviados.push(args),
    { formularioId: 'f1', autor: { id: 'tec-010' } }
  );
  assert.equal(n, 0);
});
