// Se ejecutan con el runner de Node: node --test src/lib/__tests__/

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizarCedula, numeroVisitaFormulario } = require('../visitas');

test('normalizarCedula quita puntos, espacios y guiones', () => {
  assert.equal(normalizarCedula('1.234 567'), '1234567');
  assert.equal(normalizarCedula(' 12-34a '), '1234A');
  assert.equal(normalizarCedula(null), '');
});

test('la caracterización es siempre la visita 1, aunque el cliente mande otro número', () => {
  assert.equal(numeroVisitaFormulario('caracterizacion', undefined), 1);
  assert.equal(numeroVisitaFormulario('caracterizacion', 2), 1);
});

test('la visita técnica usa visita_numero', () => {
  assert.equal(numeroVisitaFormulario('visita_tecnica', 2), 2);
  assert.equal(numeroVisitaFormulario('visita_tecnica', '3'), 3);
});

test('números inválidos o fuera de 1..12 no representan ninguna visita', () => {
  assert.equal(numeroVisitaFormulario('visita_tecnica', undefined), null);
  assert.equal(numeroVisitaFormulario('visita_tecnica', 0), null);
  assert.equal(numeroVisitaFormulario('visita_tecnica', 13), null);
  assert.equal(numeroVisitaFormulario('visita_tecnica', 1.5), null);
});
