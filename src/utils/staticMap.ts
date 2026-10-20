// ============================================================
// GEODAILY — Mosaico de mapa real (tiles) para PDF
// ============================================================
// Arma una imagen de mapa "impresa" para los PDF (expo-print no puede
// depender de que un mapa interactivo (Leaflet/MapLibre) termine de cargar
// teselas asíncronas antes de imprimir), descargando un pequeño mosaico de
// teselas raster ArcGIS (las mismas, sin API key, que ya usa el mapa en
// vivo — ver MapViewOffline.tsx) como imágenes base64 y superponiendo los
// puntos con matemáticas de "slippy map" estándar (Web Mercator).
//
// Sin internet, o si alguna tesela falla, `construirMosaicoMapa` devuelve
// `null` — el PDF se genera igual, solo sin el mapa (mismo criterio que el
// análisis de IA: nunca bloquea la generación).
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const TAMANO_TESELA = 256;
/**
 * Tiles OpenStreetMap (terreno, sin key) — el mismo servidor que
 * MapViewOffline.tsx usa para mapStyle="terreno" (Terreno/Calles).
 *
 * OJO: en zona rural de Caquetá OSM no tiene datos por encima de zoom ~15
 * (devuelve teselas vacías), así que el mosaico del PDF se limita a ese zoom
 * y se ve borroso al acercar — igual que en el mapa en vivo.
 */
const URL_TESELA = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/**
 * Teselas ArcGIS "World Imagery" (satélite, sin key) — el mismo mapa que
 * MapViewOffline.tsx pinta con mapStyle="satelite", que es el que el técnico
 * ve mientras traza y guarda el polígono.
 *
 * OJO: el fondo de terreno solo tiene datos hasta zoom 16 en buena parte del
 * país; a partir de 17 Esri devuelve la tesela gris «Map data not yet
 * available». Por eso la captura de la medición usa satélite: así el fondo se
 * ve igual que en el mapa en vivo.
 */
export const URL_TESELA_SATELITE = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/** Estilo de teselas de la vista estática. */
export type EstiloTesela = 'terreno' | 'satelite';

const urlTeselaSegunEstilo = (estilo: EstiloTesela) =>
  estilo === 'terreno' ? URL_TESELA : URL_TESELA_SATELITE;

/**
 * Zoom máximo con datos reales en OSM para la zona rural de Puerto Rico
 * (Caquetá). Por encima de esto el servidor devuelve teselas vacías, así que
 * el mosaico se limita a este nivel (se ve borroso, pero no en blanco).
 */
const ZOOM_MAX_TERRENO = 15;

/** Máximo de teselas a descargar (ancho × alto) — límite de costo/tiempo razonable para un mapa impreso. */
const MAX_TESELAS_LADO = 6;

export interface PuntoMapa {
  latitud: number;
  longitud: number;
  color: string;
}

interface BBox {
  norte: number;
  sur: number;
  este: number;
  oeste: number;
}

function lon2x(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2y(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/** Elige el mayor zoom (más detalle) cuyo mosaico no exceda MAX_TESELAS_LADO de ancho/alto. */
function elegirZoom(bbox: BBox, zoomMax: number = 18): number {
  for (let z = Math.min(zoomMax, 18); z >= 3; z--) {
    const xMin = Math.floor(lon2x(bbox.oeste, z));
    const xMax = Math.floor(lon2x(bbox.este, z));
    const yMin = Math.floor(lat2y(bbox.norte, z));
    const yMax = Math.floor(lat2y(bbox.sur, z));
    if (xMax - xMin + 1 <= MAX_TESELAS_LADO && yMax - yMin + 1 <= MAX_TESELAS_LADO) {
      return z;
    }
  }
  return 3;
}

/** Descarga una imagen remota y la convierte a data URI — mismo patrón que resolverFirmaComoDataUri en pdfLocal.service.ts. */
async function descargarComoDataUri(url: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const blob = await respuesta.blob();
      return await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(lector.result as string);
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(blob);
      });
    }
    const destino = `${FileSystem.cacheDirectory}mapa_tesela_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`;
    const descarga = await FileSystem.downloadAsync(url, destino);
    const base64 = await FileSystem.readAsStringAsync(descarga.uri, { encoding: FileSystem.EncodingType.Base64 });
    FileSystem.deleteAsync(descarga.uri, { idempotent: true }).catch(() => {});
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

export interface MosaicoMapa {
  /** HTML con las teselas ya posicionadas, listo para envolver en un contenedor de anchoPx×altoPx. */
  teselasHtml: string;
  anchoPx: number;
  altoPx: number;
  zoom: number;
  xMin: number;
  yMin: number;
}

/** Descarga el mosaico de teselas para una región fija (sin puntos aún) — se calcula una sola vez y se reutiliza para varios mapas (una ronda de visitas por sección) marcando puntos distintos sobre el mismo fondo. */
export async function construirMosaicoMapa(bbox: BBox): Promise<MosaicoMapa | null> {
  const zoom = elegirZoom(bbox, ZOOM_MAX_TERRENO);
  const xMin = Math.floor(lon2x(bbox.oeste, zoom));
  const xMax = Math.floor(lon2x(bbox.este, zoom));
  const yMin = Math.floor(lat2y(bbox.norte, zoom));
  const yMax = Math.floor(lat2y(bbox.sur, zoom));

  const coords: { x: number; y: number }[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      coords.push({ x, y });
    }
  }

  const descargas = await Promise.all(coords.map((c) => descargarComoDataUri(URL_TESELA(zoom, c.x, c.y))));
  if (descargas.every((d) => !d)) return null; // sin internet o servicio caído — ninguna tesela cargó

  const teselasHtml = coords
    .map((c, i) => {
      const dataUri = descargas[i];
      if (!dataUri) return '';
      const left = (c.x - xMin) * TAMANO_TESELA;
      const top = (c.y - yMin) * TAMANO_TESELA;
      return `<img src="${dataUri}" style="position:absolute;left:${left}px;top:${top}px;width:${TAMANO_TESELA}px;height:${TAMANO_TESELA}px;" />`;
    })
    .join('');

  return {
    teselasHtml,
    anchoPx: (xMax - xMin + 1) * TAMANO_TESELA,
    altoPx: (yMax - yMin + 1) * TAMANO_TESELA,
    zoom,
    xMin,
    yMin,
  };
}

/**
 * Dibuja los puntos (pines) sobre un mosaico ya descargado y devuelve el
 * HTML completo del mapa, ajustado ("contain") dentro de un recuadro de
 * `maxAnchoPx`×`maxAltoPx` — la escala usa el lado más restrictivo para que
 * el mosaico COMPLETO (con todos los puntos) quepa siempre dentro de ese
 * recuadro, sin recortes. El municipio de Puerto Rico es angosto y largo
 * (relación de aspecto ~1:2), así que ajustar solo por ancho producía un
 * mapa demasiado alto para una página impresa — de ahí el límite de alto.
 * Si `puntos` está vacío, igual muestra el mapa base (sin pines).
 */
export function dibujarPuntosEnMosaico(
  mosaico: MosaicoMapa,
  puntos: PuntoMapa[],
  maxAnchoPx: number,
  maxAltoPx: number
): string {
  const escala = Math.min(maxAnchoPx / mosaico.anchoPx, maxAltoPx / mosaico.altoPx);
  const anchoDestinoPx = Math.round(mosaico.anchoPx * escala);
  const altoDestinoPx = Math.round(mosaico.altoPx * escala);

  const pines = puntos
    .map((p) => {
      const pxX = lon2x(p.longitud, mosaico.zoom) * TAMANO_TESELA - mosaico.xMin * TAMANO_TESELA;
      const pxY = lat2y(p.latitud, mosaico.zoom) * TAMANO_TESELA - mosaico.yMin * TAMANO_TESELA;
      return `<circle cx="${pxX.toFixed(1)}" cy="${pxY.toFixed(1)}" r="7" fill="${p.color}" stroke="#ffffff" stroke-width="2" />`;
    })
    .join('');

  return `<div style="width:${anchoDestinoPx}px;height:${altoDestinoPx}px;overflow:hidden;border-radius:8px;border:1px solid #d0d0d0;position:relative;margin:0 auto;">
    <div style="width:${mosaico.anchoPx}px;height:${mosaico.altoPx}px;position:relative;transform:scale(${escala.toFixed(4)});transform-origin:top left;">
      ${mosaico.teselasHtml}
      <svg width="${mosaico.anchoPx}" height="${mosaico.altoPx}" style="position:absolute;left:0;top:0;">${pines}</svg>
    </div>
  </div>`;
}

// ============================================================
// Vista de mapa para una MEDICIÓN (componente en pantalla)
// ============================================================
// A diferencia de `construirMosaicoMapa` (que descarga las teselas a base64
// para el PDF), esto solo calcula la geometría: qué teselas hacen falta y en
// qué píxel cae cada punto del polígono. El componente `MedicionCaptura`
// pinta las teselas como <Image> remotos y encima el polígono con SVG.

export interface VistaMapa {
  zoom: number;
  xMin: number;
  yMin: number;
  columnas: number;
  filas: number;
  /** Tamaño del mosaico completo en píxeles (256 por tesela). */
  anchoPx: number;
  altoPx: number;
  /** URL de una tesela concreta del mosaico. */
  urlTesela: (x: number, y: number) => string;
  /** Convierte coordenadas a píxeles DENTRO del mosaico. */
  proyectar: (latitud: number, longitud: number) => { x: number; y: number };
}

/** Extensión mínima del recuadro (~110 m) para que un polígono diminuto no quede en un zoom absurdo. */
const SPAN_MINIMO_GRADOS = 0.001;

/**
 * Calcula el encuadre (zoom + teselas) que contiene todos los puntos con un
 * margen del 20 %. Devuelve `null` si no hay puntos.
 *
 * `estilo` decide el fondo: `satelite` (por defecto) es el mismo que ve el
 * técnico al trazar el área en el mapa en vivo; `terreno` es el topográfico
 * que usan los PDF.
 */
export function construirVistaMapa(
  puntos: { latitud: number; longitud: number }[],
  maxTeselasLado = 3,
  estilo: EstiloTesela = 'satelite'
): VistaMapa | null {
  const validos = puntos.filter(
    (p) => Number.isFinite(p?.latitud) && Number.isFinite(p?.longitud)
  );
  if (validos.length === 0) return null;

  const lats = validos.map((p) => p.latitud);
  const lons = validos.map((p) => p.longitud);
  let norte = Math.max(...lats);
  let sur = Math.min(...lats);
  let este = Math.max(...lons);
  let oeste = Math.min(...lons);

  // Margen del 20 % y un mínimo, para que el polígono no toque los bordes.
  const spanLat = Math.max(norte - sur, SPAN_MINIMO_GRADOS);
  const spanLon = Math.max(este - oeste, SPAN_MINIMO_GRADOS);
  norte += spanLat * 0.2;
  sur -= spanLat * 0.2;
  este += spanLon * 0.2;
  oeste -= spanLon * 0.2;

  const bbox: BBox = { norte, sur, este, oeste };
  const zoom = elegirZoomConLimite(bbox, maxTeselasLado, estilo === 'terreno' ? ZOOM_MAX_TERRENO : 18);
  const xMin = Math.floor(lon2x(oeste, zoom));
  const xMax = Math.floor(lon2x(este, zoom));
  const yMin = Math.floor(lat2y(norte, zoom));
  const yMax = Math.floor(lat2y(sur, zoom));

  const columnas = xMax - xMin + 1;
  const filas = yMax - yMin + 1;

  return {
    zoom,
    xMin,
    yMin,
    columnas,
    filas,
    anchoPx: columnas * TAMANO_TESELA,
    altoPx: filas * TAMANO_TESELA,
    urlTesela: (x, y) => urlTeselaSegunEstilo(estilo)(zoom, x, y),
    proyectar: (latitud, longitud) => ({
      x: (lon2x(longitud, zoom) - xMin) * TAMANO_TESELA,
      y: (lat2y(latitud, zoom) - yMin) * TAMANO_TESELA,
    }),
  };
}

/** Igual que `elegirZoom` pero con un límite de teselas configurable. */
function elegirZoomConLimite(bbox: BBox, maxTeselasLado: number, zoomMax: number = 18): number {
  const limite = Math.max(1, Math.min(maxTeselasLado, MAX_TESELAS_LADO));
  for (let z = Math.min(zoomMax, 18); z >= 3; z--) {
    const xMin = Math.floor(lon2x(bbox.oeste, z));
    const xMax = Math.floor(lon2x(bbox.este, z));
    const yMin = Math.floor(lat2y(bbox.norte, z));
    const yMax = Math.floor(lat2y(bbox.sur, z));
    if (xMax - xMin + 1 <= limite && yMax - yMin + 1 <= limite) {
      return z;
    }
  }
  return 3;
}
