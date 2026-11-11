// "Ya corregí": la acción explícita del técnico cuenta como corrección y deja
// la novedad "corregida — por verificar" (sin cerrarla: eso es el visto bueno).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACCIONES_CORRECCION, novedadEstaCorregida, SQL_INDICE_CORRECCIONES } = require('../correcciones');
const { calcularEstadoRevision } = require('../estadoRevision');

test('marcar_novedad_corregida cuenta como corrección', () => {
  assert.ok(ACCIONES_CORRECCION.includes('marcar_novedad_corregida'));
  // Las de antes siguen contando.
  for (const a of ['corregir_respuesta', 'completar_respuesta', 'eliminar_evidencia']) assert.ok(ACCIONES_CORRECCION.includes(a));
});

test('el índice parcial cubre la acción nueva', () => {
  assert.match(SQL_INDICE_CORRECCIONES, /marcar_novedad_corregida/);
  assert.match(SQL_INDICE_CORRECCIONES, /idx_actividad_correcciones_v2/);
});

test('"Ya corregí" posterior a la novedad → por verificar; anterior → no', () => {
  const novedad = '2026-11-10T10:00:00Z';
  assert.equal(novedadEstaCorregida(novedad, [{ accion: 'marcar_novedad_corregida', created_at: '2026-11-10T12:00:00Z' }]), true);
  assert.equal(novedadEstaCorregida(novedad, [{ accion: 'marcar_novedad_corregida', created_at: '2026-11-10T09:00:00Z' }]), false);
});

test('marcarla corregida NO cierra la novedad: sigue abierta hasta el visto bueno', () => {
  const revisiones = [{ id: 1, revisor_id: 'int-1', revisor_rol: 'interventor', tipo: 'novedad', seccion: 'Actividad Realizada', created_at: '2026-11-10T10:00:00Z' }];
  const correcciones = [{ accion: 'marcar_novedad_corregida', created_at: '2026-11-10T12:00:00Z' }];
  const estado = calcularEstadoRevision(revisiones, correcciones);
  assert.equal(estado._porRol.interventor.abiertas.length, 1);
});
