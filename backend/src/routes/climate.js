// ============================================================
// Climate Routes — Clima actual e histórico
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// GET /api/climate/actual?lat=X&lon=Y
router.get('/actual', authenticateToken, (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  // Datos mock realistas — Putumayo, Colombia
  res.json({
    fuente: 'IDEAM / OpenWeather (mock)',
    timestamp: new Date().toISOString(),
    ubicacion: {
      latitud: parseFloat(lat),
      longitud: parseFloat(lon),
      nombre: 'Puerto Asís, Putumayo',
    },
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

  res.json({
    ubicacion: {
      latitud: latNum,
      longitud: lonNum,
    },
    actual: {
      fuente: 'IDEAM / OpenWeather (mock)',
      timestamp: new Date().toISOString(),
      ubicacion: {
        latitud: latNum,
        longitud: lonNum,
        nombre: 'Puerto Asís, Putumayo',
      },
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
