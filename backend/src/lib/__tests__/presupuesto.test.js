// ============================================================
// GEODAILY — Pruebas del presupuesto de tiempo (datos externos)
//
// Se ejecutan con el runner que ya trae Node (sin dependencias nuevas):
//   node --test src/lib/__tests__/*.test.js
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const { conPresupuesto } = require('../presupuesto');

test('conPresupuesto: usa el valor real si llega dentro del presupuesto', async () => {
  const promesa = new Promise((resolve) => setTimeout(() => resolve('clima'), 20));
  assert.equal(await conPresupuesto(promesa, 500, null), 'clima');
});

test('conPresupuesto: se rinde con el respaldo si el dato externo no responde', async () => {
  // Caso reportado: Open-Meteo/Nominatim colgados con internet lento.
  const nuncaResuelve = new Promise(() => {});
  const inicio = Date.now();
  const resultado = await conPresupuesto(nuncaResuelve, 120, null);
  const transcurrido = Date.now() - inicio;

  assert.equal(resultado, null);
  assert.ok(transcurrido >= 100, `debe esperar el presupuesto (transcurrió ${transcurrido} ms)`);
  assert.ok(transcurrido < 1500, `no debe quedarse colgado (transcurrió ${transcurrido} ms)`);
});

test('conPresupuesto: un rechazo devuelve el respaldo, nunca propaga el error', async () => {
  const falla = Promise.reject(new Error('sin internet'));
  assert.equal(await conPresupuesto(falla, 500, 'respaldo'), 'respaldo');
});

test('conPresupuesto: acepta un valor ya resuelto (no promesa)', async () => {
  assert.equal(await conPresupuesto('listo', 500, null), 'listo');
});

test('conPresupuesto: dos consultas en paralelo no suman su presupuesto', async () => {
  // Ubicación y clima se piden a la vez: el peor caso debe ser UN
  // presupuesto, no dos (si no, la foto seguiría esperando el doble).
  const inicio = Date.now();
  await Promise.all([
    conPresupuesto(new Promise(() => {}), 150, null),
    conPresupuesto(new Promise(() => {}), 150, null),
  ]);
  const transcurrido = Date.now() - inicio;
  assert.ok(transcurrido < 400, `deben correr en paralelo (transcurrió ${transcurrido} ms)`);
});
