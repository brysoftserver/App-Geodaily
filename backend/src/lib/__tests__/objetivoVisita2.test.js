// Se ejecutan con el runner de Node: node --test src/lib/__tests__/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { OBJETIVO_VISITA_2, fijarObjetivoVisita2 } = require('../objetivoVisita2');

test('fija el objetivo y su espejo en visita_datos de una Visita 2', () => {
  const act = { formato_visita: 'v2', objetivo: 'Otro texto', visita_datos: { objetivo: 'Otro texto', recomendaciones: 'x' }, recomendaciones: 'x' };
  assert.equal(fijarObjetivoVisita2(act), true);
  assert.equal(act.objetivo, OBJETIVO_VISITA_2);
  assert.equal(act.visita_datos.objetivo, OBJETIVO_VISITA_2);
  assert.equal(act.recomendaciones, 'x');
  assert.equal(act.visita_datos.recomendaciones, 'x');
});

test('corrige también el texto oficial con punto final', () => {
  const act = { formato_visita: 'v2', objetivo: OBJETIVO_VISITA_2 + '.' };
  assert.equal(fijarObjetivoVisita2(act), true);
  assert.equal(act.objetivo, OBJETIVO_VISITA_2);
});

test('no reporta cambio si ya tiene el objetivo oficial', () => {
  const act = { formato_visita: 'v2', objetivo: OBJETIVO_VISITA_2, visita_datos: { objetivo: OBJETIVO_VISITA_2 } };
  assert.equal(fijarObjetivoVisita2(act), false);
});

test('no toca Visita 3, formularios antiguos ni valores vacíos', () => {
  const v3 = { formato_visita: 'v3', objetivo: 'Objetivo V3', visita_datos: { objetivo: 'Objetivo V3' } };
  assert.equal(fijarObjetivoVisita2(v3), false);
  assert.equal(v3.objetivo, 'Objetivo V3');
  const antiguo = { objetivo: 'Antiguo' };
  assert.equal(fijarObjetivoVisita2(antiguo), false);
  assert.equal(antiguo.objetivo, 'Antiguo');
  assert.equal(fijarObjetivoVisita2(null), false);
  assert.equal(fijarObjetivoVisita2(undefined), false);
});

test('el texto coincide con el de la app', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../../../src/utils/visitaTecnica.ts'), 'utf8');
  assert.ok(app.includes(`'${OBJETIVO_VISITA_2}'`));
});
