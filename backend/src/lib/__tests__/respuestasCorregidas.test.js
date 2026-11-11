// ============================================================
// GEODAILY — Pruebas: una copia vieja del teléfono no pisa respuestas
// completadas/corregidas en el servidor.
//   node --test src/lib/__tests__/*.test.js
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { conservarRespuestasCorregidas } = require('../respuestasCorregidas');

const servidor = {
  fecha: '17/09/2026',
  acompaniamiento: { observaciones_visita: 'Se realiza la visita sin novedades', capacitacion_obs: 'Si', otra: 'x' },
};
const correcciones = [
  { accion: 'completar_respuesta', path: 'acompaniamiento.observaciones_visita', created_at: '2026-11-11T16:39:36Z' },
  { accion: 'completar_respuesta', path: 'acompaniamiento.capacitacion_obs', created_at: '2026-11-11T16:40:05Z' },
  { accion: 'eliminar_evidencia', path: null, created_at: '2026-11-11T16:41:00Z' },
];

test('copia VIEJA del teléfono: conserva las respuestas completadas en el servidor', () => {
  const entrante = { fecha: '17/09/2026', acompaniamiento: { observaciones_visita: '', capacitacion_obs: '', otra: 'nuevo' } };
  const { caracterizacion, conservados } = conservarRespuestasCorregidas(entrante, servidor, correcciones, '2026-09-17T23:54:21Z');
  assert.equal(caracterizacion.acompaniamiento.observaciones_visita, 'Se realiza la visita sin novedades');
  assert.equal(caracterizacion.acompaniamiento.capacitacion_obs, 'Si');
  // Lo demás de la copia se guarda tal cual.
  assert.equal(caracterizacion.acompaniamiento.otra, 'nuevo');
  assert.deepEqual(conservados.sort(), ['acompaniamiento.capacitacion_obs', 'acompaniamiento.observaciones_visita']);
  // No muta la entrada.
  assert.equal(entrante.acompaniamiento.observaciones_visita, '');
});

test('copia MÁS NUEVA que la corrección: gana el teléfono (el técnico editó después)', () => {
  const entrante = { acompaniamiento: { observaciones_visita: 'Texto editado luego', capacitacion_obs: 'No' } };
  const { caracterizacion, conservados } = conservarRespuestasCorregidas(entrante, servidor, correcciones, '2026-11-12T08:00:00Z');
  assert.equal(caracterizacion, entrante);
  assert.deepEqual(conservados, []);
});

test('copia sin updated_at: se protegen las respuestas corregidas', () => {
  const entrante = { acompaniamiento: {} };
  const { conservados } = conservarRespuestasCorregidas(entrante, servidor, correcciones, null);
  assert.equal(conservados.length, 2);
});

test('sin correcciones de respuesta o sin datos: no cambia nada', () => {
  const entrante = { acompaniamiento: { observaciones_visita: '' } };
  assert.equal(conservarRespuestasCorregidas(entrante, servidor, [], '2026-01-01').caracterizacion, entrante);
  assert.equal(conservarRespuestasCorregidas(null, servidor, correcciones, null).caracterizacion, null);
  assert.equal(conservarRespuestasCorregidas(entrante, null, correcciones, null).caracterizacion, entrante);
});

test('respuesta de una sola parte (path sin punto)', () => {
  const { caracterizacion, conservados } = conservarRespuestasCorregidas(
    { vereda: '' },
    { vereda: 'La Chipa' },
    [{ accion: 'corregir_respuesta', path: 'vereda', created_at: '2026-11-11T10:00:00Z' }],
    '2026-11-01T00:00:00Z'
  );
  assert.equal(caracterizacion.vereda, 'La Chipa');
  assert.deepEqual(conservados, ['vereda']);
});

// ── Ítems Sí/No del acompañamiento (caso Segundo Alfonso / Edinson Salinas) ──
const { esRutaSiNo, leerSiNo, normalizarSiNo, escribirSiNo } = require('../respuestasCorregidas');

test('Sí/No: rutas virtuales reconocidas, la observación NO es ruta Sí/No', () => {
  assert.ok(esRutaSiNo('acompaniamiento.capacitacion'));
  assert.ok(esRutaSiNo('acompaniamiento.actividades_realizadas'));
  assert.ok(!esRutaSiNo('acompaniamiento.capacitacion_obs'));
  assert.ok(!esRutaSiNo('acompaniamiento.observaciones_visita'));
});

test('Sí/No: se lee de las casillas aunque la observación diga «Si» (caso real)', () => {
  const enc = { acompaniamiento: { capacitacion_si: false, capacitacion_no: false, capacitacion_obs: 'Si' } };
  assert.equal(leerSiNo(enc, 'acompaniamiento.capacitacion'), ''); // → «Completar» es válido
  assert.equal(leerSiNo({ acompaniamiento: { capacitacion_si: true, capacitacion_obs: '' } }, 'acompaniamiento.capacitacion'), 'Sí');
  assert.equal(leerSiNo({ acompaniamiento: { capacitacion_no: true } }, 'acompaniamiento.capacitacion'), 'No');
});

test('Sí/No: normaliza Sí/Si/No y rechaza otros valores', () => {
  assert.equal(normalizarSiNo('Sí'), true);
  assert.equal(normalizarSiNo(' si '), true);
  assert.equal(normalizarSiNo('NO'), false);
  assert.equal(normalizarSiNo('tal vez'), null);
});

test('Sí/No: escribe ambas casillas, conserva la observación y no muta', () => {
  const enc = { acompaniamiento: { capacitacion_si: false, capacitacion_no: false, capacitacion_obs: 'Si', otra: 1 } };
  const nuevo = escribirSiNo(enc, 'acompaniamiento.capacitacion', true);
  assert.equal(nuevo.acompaniamiento.capacitacion_si, true);
  assert.equal(nuevo.acompaniamiento.capacitacion_no, false);
  assert.equal(nuevo.acompaniamiento.capacitacion_obs, 'Si');
  assert.equal(nuevo.acompaniamiento.otra, 1);
  assert.equal(enc.acompaniamiento.capacitacion_si, false);
});

test('protección: copia vieja no borra un Sí/No completado en el servidor', () => {
  const servidorSiNo = { acompaniamiento: { capacitacion_si: true, capacitacion_no: false } };
  const entrante = { acompaniamiento: { capacitacion_si: false, capacitacion_no: false, capacitacion_obs: 'x' } };
  const { caracterizacion, conservados } = conservarRespuestasCorregidas(
    entrante,
    servidorSiNo,
    [{ accion: 'completar_respuesta', path: 'acompaniamiento.capacitacion', created_at: '2026-11-11T18:00:00Z' }],
    '2026-09-17T00:00:00Z'
  );
  assert.equal(caracterizacion.acompaniamiento.capacitacion_si, true);
  assert.equal(caracterizacion.acompaniamiento.capacitacion_obs, 'x');
  assert.deepEqual(conservados, ['acompaniamiento.capacitacion']);
});
