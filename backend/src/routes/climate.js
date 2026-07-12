// ============================================================
// Climate Routes — Clima actual e histórico
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Resolver nombre de ubicación desde coordenadas (reverse geocode offline)
function resolverUbicacion(lat, lon) {
  // Tabla simplificada de ciudades principales de Colombia
  const zonas = [
    { nombre: 'Puerto Rico (Caquetá)', latMin: 1.0, latMax: 2.5, lonMin: -76.5, lonMax: -74.5 },
    { nombre: 'Florencia (Caquetá)', latMin: 1.2, latMax: 2.0, lonMin: -75.8, lonMax: -75.4 },
    { nombre: 'San Vicente del Caguán', latMin: 1.8, latMax: 3.0, lonMin: -75.0, lonMax: -74.0 },
    { nombre: 'Cartagena del Chairá', latMin: 0.5, latMax: 1.5, lonMin: -75.5, lonMax: -74.0 },
    { nombre: 'Puerto Asís (Putumayo)', latMin: 0.2, latMax: 0.8, lonMin: -77.0, lonMax: -76.0 },
    { nombre: 'Mocoa (Putumayo)', latMin: 0.8, latMax: 1.5, lonMin: -77.0, lonMax: -76.5 },
    { nombre: 'Bogotá', latMin: 4.3, latMax: 4.9, lonMin: -74.3, lonMax: -73.9 },
    { nombre: 'Medellín', latMin: 6.0, latMax: 6.5, lonMin: -75.8, lonMax: -75.4 },
    { nombre: 'Cali', latMin: 3.2, latMax: 3.6, lonMin: -76.7, lonMax: -76.4 },
    { nombre: 'Barranquilla', latMin: 10.8, latMax: 11.2, lonMin: -75.0, lonMax: -74.7 },
  ];

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  let nombreLugar = 'Ubicación actual';

  for (const z of zonas) {
    if (latNum >= z.latMin && latNum <= z.latMax && lonNum >= z.lonMin && lonNum <= z.lonMax) {
      nombreLugar = z.nombre;
      break;
    }
  }

  return { latitud: latNum, longitud: lonNum, nombre: nombreLugar };
}

// GET /api/climate/actual?lat=X&lon=Y
router.get('/actual', authenticateToken, (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  const ubicacion = resolverUbicacion(lat, lon);

  // Datos mock — con ubicación realista según coordenadas
  res.json({
    fuente: 'IDEAM / OpenWeather (mock)',
    timestamp: new Date().toISOString(),
    ubicacion,
    temperatura: {
      actual: 28.5,
      sensacion_termica: 31.2,
      minima: 22.0,
      maxima: 31.0,
    },
    humedad: 82,
    presion: 1012,
    viento: {
      velocidad: 3.2,
      direccion_grados: 135,
    },
    nubosidad: 65,
    visibilidad: 8,
    clima: 'nubes dispersas',
    icono: '02d',
    pais: 'Colombia',
  });
});

// GET /api/climate/historico?lat=X&lon=Y
router.get('/historico', authenticateToken, (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  res.json({
    ubicacion: {
      latitud: parseFloat(lat),
      longitud: parseFloat(lon),
    },
    historico: [
      { variable: 'precipitacion', mes: 1, valor: 180, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 2, valor: 165, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 3, valor: 210, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 4, valor: 280, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 5, valor: 320, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 6, valor: 350, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'temperatura', mes: 1, valor: 24.5, unidad: '°C', periodo: '1991-2020' },
      { variable: 'temperatura', mes: 6, valor: 26.8, unidad: '°C', periodo: '1991-2020' },
      { variable: 'humedad', mes: 1, valor: 78, unidad: '%', periodo: '1991-2020' },
      { variable: 'humedad', mes: 6, valor: 85, unidad: '%', periodo: '1991-2020' },
    ],
  });
});

// GET /api/climate/resumen?lat=X&lon=Y
router.get('/resumen', authenticateToken, (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  const ubicacion = resolverUbicacion(lat, lon);

  res.json({
    ubicacion,
    actual: {
      fuente: 'IDEAM / OpenWeather (mock)',
      timestamp: new Date().toISOString(),
      ubicacion,
      temperatura: {
        actual: 28.5,
        sensacion_termica: 31.2,
        minima: 22.0,
        maxima: 31.0,
      },
      humedad: 82,
      presion: 1012,
      viento: {
        velocidad: 3.2,
        direccion_grados: 135,
      },
      nubosidad: 65,
      visibilidad: 8,
      clima: 'nubes dispersas',
      icono: '02d',
      pais: 'Colombia',
    },
    historico: [
      { variable: 'precipitacion', mes: 1, valor: 180, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 2, valor: 165, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 3, valor: 210, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 4, valor: 280, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 5, valor: 320, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'precipitacion', mes: 6, valor: 350, unidad: 'mm', periodo: '1991-2020' },
      { variable: 'temperatura', mes: 1, valor: 24.5, unidad: '°C', periodo: '1991-2020' },
      { variable: 'temperatura', mes: 6, valor: 26.8, unidad: '°C', periodo: '1991-2020' },
      { variable: 'humedad', mes: 1, valor: 78, unidad: '%', periodo: '1991-2020' },
      { variable: 'humedad', mes: 6, valor: 85, unidad: '%', periodo: '1991-2020' },
    ],
  });
});

module.exports = router;
