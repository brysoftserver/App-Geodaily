// ============================================================
// Maps Routes — Teselas, veredas y datos geoespaciales
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// ============================================================
// Veredas de Puerto Rico, Caquetá
// ============================================================
// Se obtienen desde Overpass API (OpenStreetMap) y se cachean
// en memoria para evitar consultas repetitivas.
// ============================================================

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
let veredasCache = null;
let veredasCacheTime = 0;
const CACHE_TTL = 3600000; // 1 hora

/**
 * Query Overpass para obtener las veredas de Puerto Rico, Caquetá
 * Busca boundary=administrative + admin_level=9 dentro del municipio
 */
const OVERPASS_QUERY = `
[out:json][timeout:25];
area["name"="Puerto Rico"]["admin_level"="8"]["boundary"="administrative"]({{bbox}});
rel(area)["admin_level"="9"]["boundary"="administrative"];
out geom;
`;

// Coordenadas de Puerto Rico, Caquetá
const PUERTO_RICO = {
  municipio: 'Puerto Rico',
  departamento: 'Caquetá',
  centro: { lat: 1.914, lon: -75.145 },
  zoom: 13,
};

/**
 * Convierte un nodo de Overpass a [lon, lat]
 */
function toCoord(node) {
  return [node.lon, node.lat];
}

/**
 * Procesa la respuesta de Overpass: extrae geometrías y propiedades
 */
function procesarVeredas(data) {
  const veredas = [];

  if (!data || !data.elements) return veredas;

  for (const el of data.elements) {
    if (el.type !== 'relation' && el.type !== 'way') continue;

    const tags = el.tags || {};
    const nombre = tags.name || tags['addr:hamlet'] || 'Vereda sin nombre';

    let coordinates = [];

    if (el.type === 'relation' && el.members) {
      // Buscar el miembro con role 'outer' (polígono exterior)
      const outer = el.members.filter(m => m.role === 'outer' || !m.role);
      for (const member of outer) {
        if (member.geometry) {
          const ring = member.geometry.map(toCoord);
          if (ring.length > 2) coordinates.push(ring);
        }
      }
    } else if (el.type === 'way' && el.geometry) {
      const ring = el.geometry.map(toCoord);
      if (ring.length > 2) coordinates.push(ring);
    }

    if (coordinates.length > 0) {
      veredas.push({
        id: `vereda-${el.id}`,
        nombre,
        type: 'Feature',
        properties: {
          id: `vereda-${el.id}`,
          nombre,
          osm_id: el.id,
          admin_level: tags.admin_level || '9',
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: coordinates.map(ring => [ring]),
        },
      });
    }
  }

  return veredas;
}

/**
 * Fallback: veredas conocidas de Puerto Rico, Caquetá con polígonos
 * aproximados (círculos alrededor de puntos conocidos).
 * Se usa cuando Overpass no devuelve datos.
 */
function getFallbackVeredas() {
  const veredasConocidas = [
    { nombre: 'Puerto Rico (cabecera)', lat: 1.914, lon: -75.145, radio: 0.008 },
    { nombre: 'Vereda Santana', lat: 1.885, lon: -75.120, radio: 0.007 },
    { nombre: 'Vereda San Juan', lat: 1.940, lon: -75.160, radio: 0.007 },
    { nombre: 'Vereda La Esperanza', lat: 1.900, lon: -75.180, radio: 0.006 },
    { nombre: 'Vereda El Recreo', lat: 1.870, lon: -75.140, radio: 0.006 },
    { nombre: 'Vereda Las Palmas', lat: 1.930, lon: -75.130, radio: 0.006 },
    { nombre: 'Vereda Buenos Aires', lat: 1.955, lon: -75.175, radio: 0.006 },
    { nombre: 'Vereda La Vega', lat: 1.895, lon: -75.105, radio: 0.006 },
    { nombre: 'Vereda El Porvenir', lat: 1.920, lon: -75.200, radio: 0.006 },
    { nombre: 'Vereda El Triunfo', lat: 1.880, lon: -75.165, radio: 0.006 },
  ];

  return veredasConocidas.map((v, i) => {
    // Crear un polígono circular aproximado
    const points = 16;
    const ring = [];
    for (let a = 0; a < 360; a += 360 / points) {
      const rad = (a * Math.PI) / 180;
      const dlat = v.radio * Math.cos(rad);
      const dlon = v.radio * Math.sin(rad) / Math.cos(v.lat * Math.PI / 180);
      ring.push([v.lon + dlon, v.lat + dlat]);
    }
    ring.push(ring[0]); // cerrar anillo

    return {
      id: `vereda-fallback-${i}`,
      nombre: v.nombre,
      type: 'Feature',
      properties: {
        id: `vereda-fallback-${i}`,
        nombre: v.nombre,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[ring]],
      },
    };
  });
}

// GET /api/maps/veredas — Veredas de Puerto Rico, Caquetá
router.get('/veredas', authenticateToken, async (req, res) => {
  try {
    // Usar cache si está fresco
    if (veredasCache && (Date.now() - veredasCacheTime) < CACHE_TTL) {
      return res.json({
        estado: 'ok',
        fuente: 'cache',
        municipio: PUERTO_RICO.municipio,
        departamento: PUERTO_RICO.departamento,
        centro: PUERTO_RICO.centro,
        zoom: PUERTO_RICO.zoom,
        total: veredasCache.length,
        veredas: veredasCache,
      });
    }

    // Consultar Overpass API
    let veredas = [];
    let fuente = 'overpass';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        veredas = procesarVeredas(data);
      }
    } catch (err) {
      console.warn('[Maps] Overpass API error:', err.message);
    }

    // Si Overpass no devolvió datos, usar fallback
    if (veredas.length === 0) {
      veredas = getFallbackVeredas();
      fuente = 'fallback';
      console.log(`[Maps] Usando fallback: ${veredas.length} veredas aproximadas`);
    }

    // Actualizar cache
    veredasCache = veredas;
    veredasCacheTime = Date.now();

    res.json({
      estado: 'ok',
      fuente,
      municipio: PUERTO_RICO.municipio,
      departamento: PUERTO_RICO.departamento,
      centro: PUERTO_RICO.centro,
      zoom: PUERTO_RICO.zoom,
      total: veredas.length,
      veredas,
    });
  } catch (error) {
    console.error('[Maps] Error al obtener veredas:', error);

    // Fallback de emergencia
    const fallback = getFallbackVeredas();
    res.json({
      estado: 'ok',
      fuente: 'fallback-emergencia',
      municipio: PUERTO_RICO.municipio,
      departamento: PUERTO_RICO.departamento,
      centro: PUERTO_RICO.centro,
      zoom: PUERTO_RICO.zoom,
      total: fallback.length,
      veredas: fallback,
    });
  }
});

// ============================================================
// Estilos de mapa (MapLibre Style Spec) — para renderizar Y para que
// OfflineManager.createPack() del cliente pueda descargar un paquete
// offline apuntando a una URL real.
//
// SIN authenticateToken a propósito: los SDKs nativos de mapas (MapLibre/
// Mapbox) que descargan estilos/teselas para caché offline generalmente no
// soportan adjuntar un header Authorization personalizado en esas
// peticiones. El estilo solo referencia fuentes de teselas ya públicas
// (CartoDB, Esri) — no expone datos privados de la app.
//
// Reemplaza el antiguo intento de servir teselas vectoriales propias vía
// /tesela (esa ruta nunca existió; QGIS no tiene datos base cargados —
// documentado en MapViewOffline.tsx). Aquí solo se sirven las capas raster
// que sí funcionan hoy.
// ============================================================

const MAP_STYLES = {
  relieve: {
    version: 8,
    name: 'GEODAILY - Relieve',
    sources: {
      'carto-positron': {
        type: 'raster',
        // Sin {r}: convención de Leaflet que MapLibre nativo no sustituye.
        tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors, © CARTO',
      },
    },
    layers: [
      { id: 'carto-bg', source: 'carto-positron', type: 'raster', paint: { 'raster-opacity': 1 } },
    ],
  },
  satelite: {
    version: 8,
    name: 'GEODAILY - Satélite',
    sources: {
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      { id: 'satellite-layer', source: 'satellite', type: 'raster', paint: { 'raster-opacity': 1 } },
    ],
  },
};

// GET /api/maps/style/:tipo — Estilo de mapa (relieve | satelite)
router.get('/style/:tipo', (req, res) => {
  const estilo = MAP_STYLES[req.params.tipo];
  if (!estilo) {
    return res.status(404).json({ estado: 'error', mensaje: 'Estilo no encontrado. Usa "relieve" o "satelite".' });
  }
  res.json(estilo);
});

module.exports = router;
