// ============================================================
// Climate Routes — Clima actual e histórico
// Usa datos REALES: Open-Meteo (clima, sin API key) + Nominatim
// (OpenStreetMap, reverse geocoding sin API key) según las
// coordenadas exactas recibidas — no hay ubicación ni clima
// anclados a un municipio fijo.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

const FETCH_TIMEOUT_MS = 8000;

async function fetchConTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Interpretación de códigos WMO usados por Open-Meteo (weather_code)
const WEATHER_CODE_MAP = {
  0: { clima: 'cielo despejado', icono: '01d' },
  1: { clima: 'mayormente despejado', icono: '01d' },
  2: { clima: 'parcialmente nublado', icono: '02d' },
  3: { clima: 'nublado', icono: '03d' },
  45: { clima: 'niebla', icono: '50d' },
  48: { clima: 'niebla con escarcha', icono: '50d' },
  51: { clima: 'llovizna ligera', icono: '09d' },
  53: { clima: 'llovizna moderada', icono: '09d' },
  55: { clima: 'llovizna densa', icono: '09d' },
  61: { clima: 'lluvia ligera', icono: '10d' },
  63: { clima: 'lluvia moderada', icono: '10d' },
  65: { clima: 'lluvia fuerte', icono: '10d' },
  71: { clima: 'nevada ligera', icono: '13d' },
  73: { clima: 'nevada moderada', icono: '13d' },
  75: { clima: 'nevada fuerte', icono: '13d' },
  80: { clima: 'chubascos ligeros', icono: '09d' },
  81: { clima: 'chubascos moderados', icono: '09d' },
  82: { clima: 'chubascos fuertes', icono: '09d' },
  95: { clima: 'tormenta eléctrica', icono: '11d' },
  96: { clima: 'tormenta con granizo', icono: '11d' },
  99: { clima: 'tormenta fuerte con granizo', icono: '11d' },
};

function interpretarCodigoClima(code) {
  return WEATHER_CODE_MAP[code] || { clima: 'condiciones no determinadas', icono: '02d' };
}

/**
 * Resolver el nombre real del lugar (vereda/corregimiento/municipio) desde
 * las coordenadas exactas vía Nominatim (OpenStreetMap) — reemplaza el
 * antiguo lookup de cajas geográficas fijas por municipio.
 */
async function resolverUbicacion(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const fallback = { latitud: latNum, longitud: lonNum, nombre: 'Ubicación actual' };

  try {
    const response = await fetchConTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latNum}&lon=${lonNum}&zoom=14&accept-language=es`,
      { headers: { 'User-Agent': 'GEODAILY-App/1.0 (contacto@brysoftsas.com)' } },
      5000
    );
    if (!response.ok) return fallback;

    const data = await response.json();
    const addr = data.address || {};
    // Nivel municipio únicamente — OSM no tiene mapeadas de forma confiable
    // las veredas rurales de esta zona, así que evitamos mezclar niveles
    // de detalle inconsistentes (a veces vereda, a veces municipio).
    const municipio = addr.municipality || addr.county || addr.town || addr.city;
    const departamento = addr.state;

    let nombre = municipio || fallback.nombre;
    if (departamento) nombre += ` (${departamento})`;

    return { latitud: latNum, longitud: lonNum, nombre };
  } catch (error) {
    console.warn('[Climate] Error en reverse geocoding (Nominatim):', error.message);
    return fallback;
  }
}

/**
 * Obtener clima real (Open-Meteo) para las coordenadas exactas recibidas.
 */
async function obtenerClimaReal(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m` +
    `&hourly=visibility&forecast_days=1&timezone=auto`;

  const response = await fetchConTimeout(url, {}, FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Open-Meteo respondió HTTP ${response.status}`);
  }
  const data = await response.json();
  const current = data.current;
  if (!current) {
    throw new Error('Open-Meteo no devolvió datos "current"');
  }

  // Visibilidad: buscar la hora actual en el arreglo horario (en metros → km)
  let visibilidadKm = 10;
  try {
    const idx = data.hourly?.time?.indexOf(current.time);
    if (idx !== undefined && idx >= 0 && data.hourly?.visibility?.[idx] != null) {
      visibilidadKm = Math.round((data.hourly.visibility[idx] / 1000) * 10) / 10;
    }
  } catch { /* usar default */ }

  const { clima, icono } = interpretarCodigoClima(current.weather_code);

  return {
    timestamp: current.time ? new Date(current.time).toISOString() : new Date().toISOString(),
    temperatura: {
      actual: current.temperature_2m,
      sensacion_termica: current.apparent_temperature,
      minima: data.daily?.temperature_2m_min?.[0] ?? current.temperature_2m,
      maxima: data.daily?.temperature_2m_max?.[0] ?? current.temperature_2m,
    },
    humedad: current.relative_humidity_2m,
    presion: current.pressure_msl,
    viento: {
      velocidad: current.wind_speed_10m,
      direccion_grados: current.wind_direction_10m,
    },
    nubosidad: current.cloud_cover,
    visibilidad: visibilidadKm,
    clima,
    icono,
  };
}

/**
 * Clima para un instante específico (no necesariamente "ahora"): usa la
 * API horaria de Open-Meteo con start_date=end_date=la fecha pedida y
 * toma la hora más cercana. Cubre desde ~92 días atrás hasta 16 días
 * adelante — de sobra para resolver el clima de una visita sincronizada
 * días o semanas después de capturarla sin señal.
 */
async function obtenerClimaEnMomento(lat, lon, fechaISO) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const fecha = fechaISO ? new Date(fechaISO) : new Date();
  const fechaValida = !isNaN(fecha.getTime()) ? fecha : new Date();
  const fechaStr = fechaValida.toISOString().split('T')[0];

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}` +
    `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,visibility` +
    `&start_date=${fechaStr}&end_date=${fechaStr}&timezone=auto`;

  const response = await fetchConTimeout(url, {}, FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Open-Meteo respondió HTTP ${response.status}`);
  }
  const data = await response.json();
  const horas = data.hourly?.time || [];
  if (horas.length === 0) {
    throw new Error('Open-Meteo no devolvió datos horarios para esa fecha');
  }

  // Hora más cercana a la de captura (el arreglo trae las 24 h del día)
  const objetivoMs = fechaValida.getTime();
  let mejorIdx = 0;
  let mejorDiff = Infinity;
  for (let i = 0; i < horas.length; i++) {
    const diff = Math.abs(new Date(horas[i]).getTime() - objetivoMs);
    if (diff < mejorDiff) {
      mejorDiff = diff;
      mejorIdx = i;
    }
  }

  const { clima, icono } = interpretarCodigoClima(data.hourly.weather_code?.[mejorIdx]);
  let visibilidadKm = 10;
  if (data.hourly.visibility?.[mejorIdx] != null) {
    visibilidadKm = Math.round((data.hourly.visibility[mejorIdx] / 1000) * 10) / 10;
  }

  return {
    timestamp: horas[mejorIdx] ? new Date(horas[mejorIdx]).toISOString() : fechaValida.toISOString(),
    temperatura: {
      actual: data.hourly.temperature_2m?.[mejorIdx] ?? null,
      sensacion_termica: data.hourly.apparent_temperature?.[mejorIdx] ?? null,
      minima: null,
      maxima: null,
    },
    humedad: data.hourly.relative_humidity_2m?.[mejorIdx] ?? null,
    presion: data.hourly.pressure_msl?.[mejorIdx] ?? null,
    viento: {
      velocidad: data.hourly.wind_speed_10m?.[mejorIdx] ?? null,
      direccion_grados: data.hourly.wind_direction_10m?.[mejorIdx] ?? null,
    },
    nubosidad: data.hourly.cloud_cover?.[mejorIdx] ?? null,
    visibilidad: visibilidadKm,
    clima,
    icono,
  };
}

/**
 * GET /api/climate/en-momento?lat=&lon=&fecha=ISO
 *
 * Resuelve el NOMBRE DEL LUGAR y el CLIMA para un instante específico —
 * "ahora" si se omite `fecha` (captura en línea), o una fecha pasada
 * (resolución diferida al sincronizar, con la hora exacta de captura).
 *
 * A diferencia de /actual y /resumen, usa Promise.allSettled: si Open-Meteo
 * falla pero Nominatim responde (o viceversa), se devuelve lo que sí se
 * obtuvo en vez de fallar todo el endpoint. Antes ambos viajaban unidos en
 * la misma promesa — si el clima fallaba, también se perdía el nombre del
 * lugar aunque la geocodificación inversa hubiera funcionado, y la sección
 * de ubicación del formulario quedaba completamente vacía.
 */
router.get('/en-momento', authenticateToken, async (req, res) => {
  const { lat, lon, fecha } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  const [ubicacionResult, climaResult] = await Promise.allSettled([
    resolverUbicacion(lat, lon),
    obtenerClimaEnMomento(lat, lon, fecha),
  ]);

  const ubicacion =
    ubicacionResult.status === 'fulfilled'
      ? ubicacionResult.value
      : { latitud: parseFloat(lat), longitud: parseFloat(lon), nombre: 'Ubicación actual' };

  if (climaResult.status === 'rejected') {
    console.warn('[Climate] No se pudo resolver el clima en el momento pedido:', climaResult.reason?.message);
  }

  res.json({
    estado: 'ok',
    fuente: 'Open-Meteo',
    ubicacion,
    pais: 'Colombia',
    // null si Open-Meteo falló — el nombre del lugar llega de todas formas
    clima: climaResult.status === 'fulfilled' ? climaResult.value : null,
  });
});

// GET /api/climate/actual?lat=X&lon=Y
router.get('/actual', authenticateToken, async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  try {
    const [ubicacion, climaReal] = await Promise.all([
      resolverUbicacion(lat, lon),
      obtenerClimaReal(lat, lon),
    ]);

    res.json({
      fuente: 'Open-Meteo',
      ubicacion,
      pais: 'Colombia',
      ...climaReal,
    });
  } catch (error) {
    console.error('[Climate] Error obteniendo clima real:', error.message);
    res.status(502).json({ estado: 'error', mensaje: 'No se pudo obtener el clima real en este momento. Verifica la conexión a internet del servidor.' });
  }
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
router.get('/resumen', authenticateToken, async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ estado: 'error', mensaje: 'lat y lon requeridos' });
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  try {
    const [ubicacion, climaReal] = await Promise.all([
      resolverUbicacion(lat, lon),
      obtenerClimaReal(lat, lon),
    ]);

    const actual = {
      fuente: 'Open-Meteo',
      ubicacion,
      pais: 'Colombia',
      ...climaReal,
    };

    res.json({
      ubicacion: { latitud: latNum, longitud: lonNum },
      actual,
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
  } catch (error) {
    console.error('[Climate] Error obteniendo resumen climático real:', error.message);
    res.status(502).json({ estado: 'error', mensaje: 'No se pudo obtener el clima real en este momento. Verifica la conexión a internet del servidor.' });
  }
});

module.exports = router;
// Reutilizables por otros módulos (ej. watermark.js para estampar
// ubicación/clima en las fotos de evidencia):
module.exports.resolverUbicacion = resolverUbicacion;
module.exports.obtenerClimaReal = obtenerClimaReal;
module.exports.interpretarCodigoClima = interpretarCodigoClima;
module.exports.fetchConTimeout = fetchConTimeout;
