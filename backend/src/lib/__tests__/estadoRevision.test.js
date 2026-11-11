// ============================================================
// GEODAILY — Pruebas del estado del flujo de revisión
//   node --test src/lib/__tests__/*.test.js
// Casos compartidos con la app: casosEstadoRevision.json
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularEstadoRevision, estadoPublico } = require('../estadoRevision');
const { casos } = require('./casosEstadoRevision.json');

for (const caso of casos) {
  test(`estado: ${caso.nombre}`, () => {
    const estado = calcularEstadoRevision(caso.revisiones, caso.correcciones);
    const pub = estadoPublico(estado, { conAbiertas: true });
    const esp = caso.esperado;
    for (const campo of ['estado_flujo', 'turno', 'rol_flujo', 'coordinador', 'interventor', 'novedades_total', 'por_verificar', 'secciones_aprobadas']) {
      if (campo in esp) assert.equal(pub[campo], esp[campo], campo);
    }
    if ('abiertas' in esp) assert.deepEqual([...pub.novedades_abiertas_ids].sort(), esp.abiertas, 'abiertas');
    if ('cerrado_coordinador' in esp) assert.equal(pub.cerrado_por_rol.coordinador, esp.cerrado_coordinador, 'cerrado');
  });
}

test('estadoPublico no filtra el detalle interno', () => {
  const pub = estadoPublico(calcularEstadoRevision([], []));
  assert.ok(!('_porRol' in pub));
});
