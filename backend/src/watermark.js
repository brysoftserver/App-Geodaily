// ============================================================
// GEODAILY — Marca de agua para fotos de evidencia
// ============================================================
// Estampa de forma PERMANENTE en la imagen (no metadatos, píxeles):
//   - Fecha y hora de CAPTURA (no de subida — clave para fotos tomadas
//     offline en campo y sincronizadas días después)
//   - Coordenadas GPS (lat/lon/altitud)
//   - Ubicación (municipio, vía Nominatim)
//   - Condiciones ambientales a la HORA DE CAPTURA (Open-Meteo horario:
//     si la foto es vieja, se consulta el histórico de esa hora, no el
//     clima del momento de subida)
// Si cualquier dato externo falla (sin internet a Nominatim/Open-Meteo),
// la marca se estampa con lo que haya (GPS + fecha siempre existen).
// La subida NUNCA falla por culpa de la marca: ante error se guarda la
// foto original.
// ============================================================

const sharp = require('sharp');
const { resolverUbicacion, interpretarCodigoClima, fetchConTimeout } = require('./routes/climate');

const TZ = 'America/Bogota';

/** Formatear fecha en hora colombiana legible. */
function formatearFecha(fechaISO) {
  try {
    const d = new Date(fechaISO);
    if (Number.isNaN(d.getTime())) throw new Error('fecha inválida');
    const fmt = new Intl.DateTimeFormat('es-CO', {
      timeZone: TZ,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(d);
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Clima a la hora exacta de captura. Open-Meteo permite pedir datos
 * horarios de fechas pasadas (hasta ~90 días con el API de forecast).
 * Devuelve null si no se puede obtener (ej. sin internet).
 */
async function obtenerClimaEnFecha(lat, lon, fechaISO) {
  try {
    const fecha = new Date(fechaISO);
    if (Number.isNaN(fecha.getTime())) return null;

    const ahora = Date.now();
    const edadDias = (ahora - fecha.getTime()) / (24 * 3600 * 1000);
    if (edadDias < 0 || edadDias > 88) return null; // fuera de rango consultable

    // Fecha local Colombia (UTC-5, sin DST) para start_date/end_date
    const fechaLocal = new Date(fecha.getTime() - 5 * 3600 * 1000);
    const dia = fechaLocal.toISOString().slice(0, 10);

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${parseFloat(lat)}&longitude=${parseFloat(lon)}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,weather_code` +
      `&start_date=${dia}&end_date=${dia}&timezone=${encodeURIComponent(TZ)}`;

    const response = await fetchConTimeout(url, {}, 8000);
    if (!response.ok) return null;
    const data = await response.json();
    const horas = data.hourly?.time || [];
    if (horas.length === 0) return null;

    // Hora local de la captura → índice más cercano en el arreglo horario
    const horaLocal = parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(fecha),
      10
    );
    const idx = Math.min(Math.max(horaLocal, 0), horas.length - 1);

    const { clima } = interpretarCodigoClima(data.hourly.weather_code?.[idx]);
    return {
      temperatura: data.hourly.temperature_2m?.[idx],
      humedad: data.hourly.relative_humidity_2m?.[idx],
      viento: data.hourly.wind_speed_10m?.[idx],
      nubosidad: data.hourly.cloud_cover?.[idx],
      clima,
    };
  } catch (error) {
    console.warn('[Watermark] Sin clima para la marca:', error.message);
    return null;
  }
}

/** Escapar texto para SVG/XML. */
function esc(texto) {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Estampar la banda de marca de agua (abajo, semitransparente) sobre el
 * buffer de imagen. Devuelve el buffer JPEG resultante.
 */
async function estamparMarca(buffer, lineas) {
  // Materializar PRIMERO la rotación EXIF a un buffer real: metadata() de
  // un pipeline con .rotate() pendiente reporta las dimensiones ORIGINALES
  // (pre-rotación), y con fotos de celular en vertical la banda salía más
  // ancha que la imagen → "Image to composite must have same dimensions
  // or smaller" y la foto quedaba sin marca.
  const imagenRotada = await sharp(buffer).rotate().toBuffer();
  const meta = await sharp(imagenRotada).metadata();
  const ancho = meta.width || 1000;
  const alto = meta.height || 1000;

  const fontSize = Math.max(14, Math.round(ancho / 42));
  const lineHeight = Math.round(fontSize * 1.45);
  const padding = Math.round(fontSize * 0.8);
  const bandaAlto = padding * 2 + lineHeight * lineas.length;

  const textos = lineas
    .map((linea, i) =>
      `<text x="${padding}" y="${padding + lineHeight * i + fontSize}" ` +
      `font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" fill="#FFFFFF">${esc(linea)}</text>`
    )
    .join('');

  const svg = Buffer.from(
    `<svg width="${ancho}" height="${bandaAlto}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${ancho}" height="${bandaAlto}" fill="#000000" fill-opacity="0.55"/>` +
    textos +
    `</svg>`
  );

  return sharp(imagenRotada)
    .composite([{ input: svg, top: alto - bandaAlto, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * Punto de entrada: aplica la marca de agua completa a una foto de
 * evidencia. Nunca lanza — si algo falla devuelve el buffer original.
 *
 * @param {Buffer} buffer   Imagen original (jpeg/png)
 * @param {object} datos    { latitud, longitud, altitud, timestampCaptura }
 * @returns {Promise<{ buffer: Buffer, marcada: boolean }>}
 */
async function aplicarMarcaAgua(buffer, datos) {
  try {
    const { latitud, longitud, altitud, timestampCaptura } = datos;
    const fechaISO = timestampCaptura || new Date().toISOString();

    const lineas = [`GEODAILY · Evidencia · ${formatearFecha(fechaISO)}`];

    const lat = parseFloat(latitud);
    const lon = parseFloat(longitud);
    const hayGPS = Number.isFinite(lat) && Number.isFinite(lon);

    if (hayGPS) {
      let lineaGPS = `Lat ${lat.toFixed(6)}  Lon ${lon.toFixed(6)}`;
      const alt = parseFloat(altitud);
      if (Number.isFinite(alt)) lineaGPS += `  Alt ${Math.round(alt)} m`;
      lineas.push(lineaGPS);

      // Ubicación y clima en paralelo — cualquiera puede fallar sin romper
      const [ubicacion, clima] = await Promise.all([
        resolverUbicacion(lat, lon).catch(() => null),
        obtenerClimaEnFecha(lat, lon, fechaISO),
      ]);

      if (ubicacion?.nombre && ubicacion.nombre !== 'Ubicación actual') {
        lineas.push(ubicacion.nombre);
      }
      if (clima && clima.temperatura != null) {
        lineas.push(
          `${Math.round(clima.temperatura)}°C · Humedad ${Math.round(clima.humedad ?? 0)}% · ` +
          `Viento ${Math.round(clima.viento ?? 0)} m/s · Nubosidad ${Math.round(clima.nubosidad ?? 0)}% · ${clima.clima}`
        );
      }
    }

    const marcado = await estamparMarca(buffer, lineas);
    return { buffer: marcado, marcada: true };
  } catch (error) {
    console.warn('[Watermark] No se pudo estampar (se guarda original):', error.message);
    return { buffer, marcada: false };
  }
}

module.exports = { aplicarMarcaAgua };
