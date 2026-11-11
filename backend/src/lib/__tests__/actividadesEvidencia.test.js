// Se ejecutan con el runner de Node: node --test src/lib/__tests__/

const test = require('node:test');
const assert = require('node:assert/strict');

const { ACTIVIDADES, descomponer, revisionDe, carpeta } = require('../actividadesEvidencia');

test('las actividades principales siguen siendo válidas', () => {
  for (const id of ['preparacion_terreno', 'siembra_cacao', 'siembra_platano', 'siembra_forestales', 'fertilizacion', 'control_sanitario']) {
    assert.ok(ACTIVIDADES.has(id), id);
  }
});

test('las subactividades usan clave compuesta y no chocan con la principal', () => {
  assert.ok(ACTIVIDADES.has('siembra_platano.fertilizacion'));
  assert.ok(ACTIVIDADES.has('siembra_forestales.trazado_ahoyado_encalado'));
  assert.ok(!ACTIVIDADES.has('siembra_platano.entrega_colinos'), 'las entregas tienen su propia pantalla');
  assert.notEqual('siembra_platano.fertilizacion', 'fertilizacion');
  // Cabe en actividad_evidencias.actividad VARCHAR(50).
  for (const id of ACTIVIDADES) assert.ok(id.length <= 50, id);
});

test('descomponer separa actividad y subactividad', () => {
  assert.deepEqual(descomponer('preparacion_terreno'), { actividad: 'preparacion_terreno', sub: null });
  assert.deepEqual(descomponer('siembra_platano.siembra_colinos'), { actividad: 'siembra_platano', sub: 'siembra_colinos' });
});

test('el OK de interventoría: principal por item, subactividad "{sub}:{item}" en la actividad padre', () => {
  assert.deepEqual(revisionDe('preparacion_terreno', 12), { actividad: 'preparacion_terreno', referencia: '12' });
  assert.deepEqual(revisionDe('siembra_platano.fertilizacion', 12), { actividad: 'siembra_platano', referencia: 'fertilizacion:12' });
});

test('la carpeta en MinIO anida la subactividad dentro de su actividad', () => {
  assert.equal(carpeta('preparacion_terreno'), 'preparacion_terreno');
  assert.equal(carpeta('siembra_platano.fertilizacion'), 'siembra_platano/fertilizacion');
});
