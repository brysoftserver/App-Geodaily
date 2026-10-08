// ============================================================
// GEODAILY — Pruebas de la marca de agua de evidencia
//
// Regla que se protege aquí: la marca de agua NUNCA puede retrasar ni
// impedir el guardado de una foto. El clima y el nombre del lugar son
// datos externos decorativos; si Open-Meteo o Nominatim no responden,
// la foto se marca igual con fecha + GPS.
//
// Se ejecutan con el runner que ya trae Node:
//   node --test src/lib/__tests__/*.test.js
// ============================================================

// `watermark` arrastra `routes/climate` → `middleware/auth`, que exige
// JWT_SECRET al cargarse. Se define ANTES del require para poder probarlo.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { aplicarMarcaAgua } = require('../../watermark');

/** Imagen de prueba (pequeña para que el test sea rápido). */
async function imagenDePrueba() {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: '#8899aa' },
  })
    .jpeg()
    .toBuffer();
}

/** Ejecuta `fn` con `global.fetch` sustituido. */
async function conFetchFalso(falso, fn) {
  const original = global.fetch;
  global.fetch = falso;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test('marca de agua: con el clima colgado la foto se marca igual (no se bloquea)', async () => {
  const buffer = await imagenDePrueba();
  // Simula "internet lento": la petición nunca responde ni rechaza — el
  // peor caso reportado en campo ("se demora mucho / nunca se guarda").
  const colgado = () => new Promise(() => {});

  const resultado = await conFetchFalso(colgado, async () => {
    const inicio = Date.now();
    const r = await aplicarMarcaAgua(buffer, {
      latitud: '4.8',
      longitud: '-75.7',
      altitud: '1500',
      timestampCaptura: new Date().toISOString(),
    });
    return { ...r, transcurrido: Date.now() - inicio };
  });

  assert.equal(resultado.marcada, true, 'la foto debe quedar marcada (y guardada)');
  assert.ok(resultado.buffer?.length > 0, 'debe devolver un buffer de imagen válido');
  // Presupuesto de 2.5 s + procesamiento de sharp. Muy por debajo de los
  // ~13 s que se esperaba antes (5 s Nominatim + 8 s Open-Meteo).
  assert.ok(
    resultado.transcurrido < 4000,
    `no debe esperar al dato externo (transcurrió ${resultado.transcurrido} ms)`
  );
});

test('marca de agua: si el clima falla, se guarda la foto con los demás datos', async () => {
  const buffer = await imagenDePrueba();
  const falla = () => Promise.reject(new Error('sin internet'));

  const resultado = await conFetchFalso(falla, () =>
    aplicarMarcaAgua(buffer, {
      latitud: '4.8',
      longitud: '-75.7',
      altitud: '1500',
      timestampCaptura: new Date().toISOString(),
    })
  );

  assert.equal(resultado.marcada, true);
  assert.ok(resultado.buffer?.length > 0);
});

test('marca de agua: sin GPS tampoco consulta clima y termina de inmediato', async () => {
  const buffer = await imagenDePrueba();
  let consulto = false;
  const vigilante = () => {
    consulto = true;
    return new Promise(() => {});
  };

  const resultado = await conFetchFalso(vigilante, () =>
    aplicarMarcaAgua(buffer, { timestampCaptura: new Date().toISOString() })
  );

  assert.equal(resultado.marcada, true);
  assert.equal(consulto, false, 'sin coordenadas no hay nada que consultar');
});
