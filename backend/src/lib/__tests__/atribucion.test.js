// ============================================================
// GEODAILY — Pruebas de la atribución de formularios
//
// Se ejecutan con el runner que ya trae Node (sin dependencias nuevas):
//   node --test src/lib/__tests__/
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolverTecnicoVigente,
  snapshotConDueno,
  resolverAtribucionFormulario,
  esTecnicoVigenteDelFormulario,
} = require('../atribucion');

test('resolverTecnicoVigente: un solo técnico entre varias filas', () => {
  assert.equal(
    resolverTecnicoVigente([
      { tecnico_asignado_id: 'tec-010' },
      { tecnico_asignado_id: 'tec-010' },
    ]),
    'tec-010'
  );
});

test('resolverTecnicoVigente: cédula duplicada con técnicos distintos es ambiguo', () => {
  // Caso real: items 180 (tec-003) y 338 (tec-007) con la misma cédula.
  assert.equal(
    resolverTecnicoVigente([
      { tecnico_asignado_id: 'tec-003' },
      { tecnico_asignado_id: 'tec-007' },
    ]),
    null
  );
});

test('resolverTecnicoVigente: sin asignar no hay técnico vigente', () => {
  assert.equal(resolverTecnicoVigente([]), null);
  assert.equal(resolverTecnicoVigente([{ tecnico_asignado_id: null }]), null);
  assert.equal(resolverTecnicoVigente(undefined), null);
});

test('snapshotConDueno: cambia el dueño y conserva los datos del dispositivo', () => {
  const original = JSON.stringify({
    usuario_id: 'tec-006',
    nombre: 'Miller Camacho',
    cedula: '1075215830',
    telefono: '3001112222',
  });
  const resultado = JSON.parse(snapshotConDueno(original, 'tec-010'));
  assert.equal(resultado.usuario_id, 'tec-010');
  assert.equal(resultado.nombre, 'Miller Camacho');
  assert.equal(resultado.telefono, '3001112222');
});

test('snapshotConDueno: tolera snapshot vacío o inválido', () => {
  assert.deepEqual(JSON.parse(snapshotConDueno(null, 'tec-001')), { usuario_id: 'tec-001' });
  assert.deepEqual(JSON.parse(snapshotConDueno('{roto', 'tec-001')), { usuario_id: 'tec-001' });
});

test('resolverAtribucionFormulario: el técnico vigente del beneficiario manda sobre el snapshot viejo', () => {
  // El técnico anterior (tec-006) sube la visita DESPUÉS de que el
  // beneficiario se reasignó a tec-010: el formulario debe quedar de tec-010.
  const r = resolverAtribucionFormulario({
    tecnicoVigente: 'tec-010',
    tecnicoDelSnapshot: 'tec-006',
    usuarioSolicitante: 'tec-006',
    usuarioExistente: null,
  });
  assert.equal(r.usuarioId, 'tec-010');
  assert.equal(r.usarSnapshotDelPayload, false);
});

test('resolverAtribucionFormulario: el dueño vigente sube la copia y se conserva su snapshot', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: 'tec-010',
    tecnicoDelSnapshot: 'tec-010',
    usuarioSolicitante: 'tec-010',
    usuarioExistente: 'tec-010',
  });
  assert.equal(r.usuarioId, 'tec-010');
  assert.equal(r.usarSnapshotDelPayload, true);
});

test('resolverAtribucionFormulario: el dueño vigente sube una copia con snapshot ajeno (móvil reutilizado)', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: 'tec-010',
    tecnicoDelSnapshot: 'tec-006',
    usuarioSolicitante: 'tec-010',
    usuarioExistente: 'tec-006',
  });
  assert.equal(r.usuarioId, 'tec-010');
  // Hay que reconstruir el snapshot: si se dejara el del dispositivo, el
  // dueño vería los botones de edición pero el backend le respondería 403.
  assert.equal(r.usarSnapshotDelPayload, false);
});

test('resolverAtribucionFormulario: sin beneficiario resoluble no se pisa la atribución guardada', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: null,
    tecnicoDelSnapshot: 'tec-003',
    usuarioSolicitante: 'adm-001',
    usuarioExistente: 'tec-003',
  });
  assert.equal(r.usuarioId, 'tec-003');
  assert.equal(r.usarSnapshotDelPayload, true);
});

test('resolverAtribucionFormulario: sin fila previa ni beneficiario resoluble guarda quien sube', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: null,
    tecnicoDelSnapshot: 'tec-003',
    usuarioSolicitante: 'tec-003',
    usuarioExistente: null,
  });
  assert.equal(r.usuarioId, 'tec-003');
  assert.equal(r.usarSnapshotDelPayload, true);
});

test('resolverAtribucionFormulario: supervisor subiendo a nombre del técnico (cédula no resoluble)', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: null,
    tecnicoDelSnapshot: 'tec-005',
    usuarioSolicitante: 'sup-008',
    usuarioExistente: null,
  });
  // La visita es del técnico que nombra el dispositivo, no del supervisor que
  // la sube: antes se guardaba a nombre de la sesión y el técnico perdía la
  // visita cuando un segundo supervisor sincronizaba el mismo formulario.
  assert.equal(r.usuarioId, 'tec-005');
  assert.equal(r.usarSnapshotDelPayload, true);
});

test('resolverAtribucionFormulario: un segundo supervisor no se queda con la visita', () => {
  // Fila creada por sup-008 a nombre de tec-005; ahora sincroniza sup-009.
  const r = resolverAtribucionFormulario({
    tecnicoVigente: null,
    tecnicoDelSnapshot: 'tec-005',
    usuarioSolicitante: 'sup-009',
    usuarioExistente: 'tec-005',
  });
  assert.equal(r.usuarioId, 'tec-005');
  assert.equal(r.usarSnapshotDelPayload, true);
});

test('resolverAtribucionFormulario: ni el dispositivo ni la fila nombran a nadie → sube quien sube', () => {
  const r = resolverAtribucionFormulario({
    tecnicoVigente: null,
    tecnicoDelSnapshot: null,
    usuarioSolicitante: 'tec-010',
    usuarioExistente: null,
  });
  assert.equal(r.usuarioId, 'tec-010');
  assert.equal(r.usarSnapshotDelPayload, false);
});

test('esTecnicoVigenteDelFormulario: permite corregir un formulario heredado', () => {
  // Formulario a nombre de tec-006, beneficiario reasignado a tec-010.
  assert.equal(
    esTecnicoVigenteDelFormulario({
      usuarioSolicitante: 'tec-010',
      duenoDelFormulario: 'tec-006',
      tecnicoVigente: 'tec-010',
    }),
    true
  );
});

test('esTecnicoVigenteDelFormulario: no habilita a un tercero', () => {
  assert.equal(
    esTecnicoVigenteDelFormulario({
      usuarioSolicitante: 'tec-005',
      duenoDelFormulario: 'tec-006',
      tecnicoVigente: 'tec-010',
    }),
    false
  );
});

test('esTecnicoVigenteDelFormulario: no habilita si el beneficiario tiene cédula duplicada', () => {
  assert.equal(
    esTecnicoVigenteDelFormulario({
      usuarioSolicitante: 'tec-007',
      duenoDelFormulario: 'tec-003',
      tecnicoVigente: null,
    }),
    false
  );
});

test('esTecnicoVigenteDelFormulario: falso cuando el solicitante ya es el dueño', () => {
  assert.equal(
    esTecnicoVigenteDelFormulario({
      usuarioSolicitante: 'tec-010',
      duenoDelFormulario: 'tec-010',
      tecnicoVigente: 'tec-010',
    }),
    false
  );
});
