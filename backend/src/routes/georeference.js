// ============================================================
// Georeference Routes — UTM, MGRS, zonas horarias
// Cálculo matemático local — NO consulta QGIS ni PostGIS pese al nombre
// del stack documentado en el README; esos servicios están desconectados
// del flujo de datos de la app.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// --- Funciones de cálculo local ---

function calcularHusoUTM(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

function calcularBandaUTM(lat) {
  const bandas = 'CDEFGHJKLMNPQRSTUVWXX';
  const idx = Math.min(Math.max(Math.floor((lat + 80) / 8), 0), bandas.length - 1);
  return bandas[idx];
}

function calcularMGRS(lat, lon) {
  const huso = calcularHusoUTM(lon);
  const banda = calcularBandaUTM(lat);
  // Grid 100km aproximado
  const letraE = String.fromCharCode(65 + Math.floor(((lon + 180) % 6) / 0.06));
  const letraN = String.fromCharCode(65 + Math.floor(((lat + 80) % 8) / 0.08));
  return `${huso}${banda} ${letraE}${letraN}`;
}

function calcularZonaHoraria(lon) {
  const utcOffset = Math.round(lon / 15);
  const signo = utcOffset >= 0 ? '+' : '-';
  return `UTC${signo}${Math.abs(utcOffset)}`;
}

// GET /api/georeference?lat=X&lon=Y&alt=Z
router.get('/', authenticateToken, (req, res) => {
  const { lat, lon, alt } = req.query;

  if (lat === undefined || lon === undefined) {
    return res.status(400).json({
      estado: 'error',
      mensaje: 'Parámetros lat y lon son requeridos',
    });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  if (isNaN(latNum) || isNaN(lonNum)) {
    return res.status(400).json({
      estado: 'error',
      mensaje: 'lat y lon deben ser números válidos',
    });
  }

  res.json({
    latitud: latNum,
    longitud: lonNum,
    altitud: alt ? parseFloat(alt) : null,
    huso_utm: calcularHusoUTM(lonNum),
    banda_utm: calcularBandaUTM(latNum),
    codigo_mgrs: calcularMGRS(latNum, lonNum),
    zona_horaria: calcularZonaHoraria(lonNum),
    pais: 'Colombia',
    fuente: 'cálculo local (backend, sin QGIS/PostGIS)',
  });
});

module.exports = router;
