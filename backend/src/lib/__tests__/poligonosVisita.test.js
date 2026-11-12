// Se ejecutan con el runner de Node: node --test src/lib/__tests__/

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  leerPoligonos,
  escribirPoligonos,
  conservarPoligonos,
  distanciaAPoligono,
  puntoDeVisita,
  filtrarParaBeneficiario,
} = require('../poligonosVisita');

// Cuadrado de ~110 m de lado cerca de Puerto Rico (Caquetá).
const cuadrado = (lat, lon, d = 0.001) => [
  { latitud: lat, longitud: lon },
  { latitud: lat + d, longitud: lon },
  { latitud: lat + d, longitud: lon + d },
  { latitud: lat, longitud: lon + d },
];
const med = (id, extra = {}) => ({ id, nombre: id, area_hectareas: 1, puntos: cuadrado(2.0, -75.0), ...extra });

test('lee el formato anterior (uno + polígono 2 del admin) como lista', () => {
  const act = { medicion_historial: med('a'), medicion_historial_2: med('b') };
  assert.deepEqual(leerPoligonos(act).map((m) => m.id), ['a', 'b']);
});

test('la lista nueva manda y no repite ids', () => {
  const act = { mediciones_historial: [med('a'), med('a'), med('c')], medicion_historial: med('z') };
  assert.deepEqual(leerPoligonos(act).map((m) => m.id), ['a', 'c']);
});

test('si la actividad llegó adelgazada, lee de visita_datos', () => {
  const act = { visita_datos: { medicion_historial: med('a') } };
  assert.deepEqual(leerPoligonos(act).map((m) => m.id), ['a']);
});

test('escribir deja medicion_historial = primero y borra el polígono 2 viejo', () => {
  const act = { medicion_historial_2: med('viejo'), visita_datos: { medicion_historial_2: med('viejo') } };
  escribirPoligonos(act, [med('a'), med('b')]);
  assert.equal(act.medicion_historial.id, 'a');
  assert.equal(act.mediciones_historial.length, 2);
  assert.equal(act.medicion_historial_2, undefined);
  assert.equal(act.visita_datos.medicion_historial_2, undefined);
  assert.equal(act.visita_datos.mediciones_historial.length, 2);
});

test('una resincronización del teléfono conserva los polígonos que agregó el admin', () => {
  const servidor = JSON.stringify({ mediciones_historial: [med('tec'), med('admin')], medicion_historial: med('tec') });
  const delTelefono = { observaciones: 'x', medicion_historial: med('tec'), visita_datos: { medicion_historial: med('tec') } };
  conservarPoligonos(delTelefono, servidor);
  assert.deepEqual(leerPoligonos(delTelefono).map((m) => m.id), ['tec', 'admin']);
  assert.deepEqual(delTelefono.visita_datos.mediciones_historial.map((m) => m.id), ['tec', 'admin']);
  assert.equal(delTelefono.observaciones, 'x');
});

test('la resincronización no puede agregar polígonos si el servidor no tenía', () => {
  const delTelefono = { medicion_historial: med('nuevo') };
  conservarPoligonos(delTelefono, { observaciones: 'y' });
  assert.equal(leerPoligonos(delTelefono).length, 0);
});

test('distancia: 0 dentro del polígono; en metros al vértice más cercano fuera', () => {
  assert.equal(distanciaAPoligono({ latitud: 2.0005, longitud: -74.9995 }, cuadrado(2.0, -75.0)), 0);
  const d = distanciaAPoligono({ latitud: 2.0, longitud: -75.0 - 0.002 }, cuadrado(2.0, -75.0));
  assert.ok(d > 200 && d < 240, `d=${d}`);
});

test('punto de la visita: coordenadas → ítem 4 → visita_datos → centro del polígono', () => {
  assert.deepEqual(puntoDeVisita({}, { latitud: 1, longitud: 2 }), { latitud: 1, longitud: 2 });
  assert.deepEqual(puntoDeVisita({ poligono: [{ latitud: 3, longitud: 4 }] }, {}), { latitud: 3, longitud: 4 });
  assert.deepEqual(puntoDeVisita({ visita_datos: { latitud: '5', longitud: '6' } }, null), { latitud: 5, longitud: 6 });
  const c = puntoDeVisita({ medicion_historial: med('a') }, '{}');
  assert.ok(Math.abs(c.latitud - 2.0005) < 1e-9);
  assert.equal(puntoDeVisita({}, { latitud: 0, longitud: 0 }), null);
});

test('filtro: solo las del beneficiario y las sin cédula cercanas', () => {
  const punto = { latitud: 2.0005, longitud: -74.9995 };
  const lista = [
    med('suya', { beneficiario_cedula: '1.234.567' }),
    med('otro', { beneficiario_cedula: '999' }),
    med('cerca-sin-cedula', { beneficiario_cedula: null }),
    med('lejos-sin-cedula', { beneficiario_cedula: null, puntos: cuadrado(2.1, -75.0) }),
  ];
  const r = filtrarParaBeneficiario(lista, { cedula: '1234567', punto });
  assert.deepEqual(r.map((m) => m.id), ['suya', 'cerca-sin-cedula']);
  assert.equal(r[0].delBeneficiario, true);
  assert.equal(r[1].cercana, true);
  assert.equal(r[1].distancia_m, 0);
});

test('filtro sin punto de visita: solo las de la cédula', () => {
  const r = filtrarParaBeneficiario([med('suya', { beneficiario_cedula: '1' }), med('x')], { cedula: '1', punto: null });
  assert.deepEqual(r.map((m) => m.id), ['suya']);
});

test('selección múltiple: agrega marcadas, quita desmarcadas y conserva KML y no ofrecidas', () => {
  const { aplicarSeleccion } = require('../poligonosVisita');
  const existentes = [med('a'), med('kml-1', { origen: 'kml' }), med('b'), med('fuera-del-filtro')];
  const r = aplicarSeleccion(existentes, ['a', 'b', 'c', 'd'], [med('d'), med('a'), med('c')]);
  assert.deepEqual(r.map((m) => m.id), ['a', 'kml-1', 'fuera-del-filtro', 'd', 'c']);
});

test('para mostrar: mediciones adjuntas con sus métricas', () => {
  const { poligonosParaMostrar } = require('../poligonosVisita');
  const r = poligonosParaMostrar(JSON.stringify({ mediciones_historial: [med('a', { perimetro_metros: 622 }), med('b')] }));
  assert.equal(r.length, 2);
  assert.equal(r[0].nombre, 'a');
  assert.equal(r[0].perimetro_metros, 622);
  assert.equal(r[0].puntos.length, 4);
});

test('para mostrar: sin mediciones usa el polígono del ítem 4; sin nada, lista vacía', () => {
  const { poligonosParaMostrar } = require('../poligonosVisita');
  const r = poligonosParaMostrar({ poligono: cuadrado(2.0, -75.0), area_intervencion: '2,5' });
  assert.equal(r.length, 1);
  assert.equal(r[0].area_hectareas, 2.5);
  assert.deepEqual(poligonosParaMostrar({ poligono: cuadrado(2.0, -75.0).slice(0, 2) }), []);
  assert.deepEqual(poligonosParaMostrar(null), []);
});
