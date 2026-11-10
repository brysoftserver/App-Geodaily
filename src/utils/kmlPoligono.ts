// ============================================================
// GEODAILY — Leer un polígono de un archivo KML o KMZ
// ============================================================
// Toma el primer <Polygon> (su borde exterior) y, si no hay, el primer
// <coordinates> con 3 o más puntos (ej. una LineString cerrada). El área la
// recalcula el servidor; aquí solo se extraen nombre y vértices.
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';

export interface PoligonoKML {
  nombre: string;
  puntos: { latitud: number; longitud: number }[];
}

const coordenadas = (bloque: string) =>
  bloque
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => {
      const [lon, lat] = c.split(',').map(Number);
      return { latitud: lat, longitud: lon };
    })
    .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud) && Math.abs(p.latitud) <= 90 && Math.abs(p.longitud) <= 180);

/** Quita el último punto si repite el primero (los KML cierran el anillo). */
const sinCierre = (pts: PoligonoKML['puntos']) =>
  pts.length > 3 && pts[0].latitud === pts[pts.length - 1].latitud && pts[0].longitud === pts[pts.length - 1].longitud
    ? pts.slice(0, -1)
    : pts;

const desescapar = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Extrae el polígono de un texto KML. null si no trae ninguno con 3 o más puntos. */
export function parsearPoligonoKML(texto: string, nombrePorDefecto = 'Polígono KML'): PoligonoKML | null {
  const poligono = /<Polygon[\s>][\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(texto);
  let puntos = poligono ? coordenadas(poligono[1]) : [];
  if (puntos.length < 3) {
    for (const m of texto.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
      const pts = coordenadas(m[1]);
      if (pts.length >= 3) {
        puntos = pts;
        break;
      }
    }
  }
  puntos = sinCierre(puntos);
  if (puntos.length < 3) return null;
  // Nombre: el del Placemark que contiene el polígono, o el primero del archivo.
  const placemark = /<Placemark[\s>][\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<coordinates>/i.exec(texto);
  const primero = /<name>([\s\S]*?)<\/name>/i.exec(texto);
  const nombre = desescapar((placemark || primero)?.[1] || '') || nombrePorDefecto;
  return { nombre: nombre.slice(0, 150), puntos };
}

/** Lee un archivo elegido con el selector (KML o KMZ) y devuelve su polígono. */
export async function leerPoligonoDeArchivo(archivo: { uri: string; name?: string | null }): Promise<PoligonoKML | null> {
  const nombreArchivo = (archivo.name || '').replace(/\.(kml|kmz)$/i, '') || 'Polígono KML';
  const esKmz = /\.kmz$/i.test(archivo.name || archivo.uri);
  let texto: string;
  if (Platform.OS === 'web') {
    const resp = await fetch(archivo.uri);
    if (esKmz) texto = await extraerKmlDeKmz(await resp.arrayBuffer());
    else texto = await resp.text();
  } else if (esKmz) {
    const b64 = await FileSystem.readAsStringAsync(archivo.uri, { encoding: FileSystem.EncodingType.Base64 });
    texto = await extraerKmlDeKmz(b64, true);
  } else {
    texto = await FileSystem.readAsStringAsync(archivo.uri, { encoding: FileSystem.EncodingType.UTF8 });
  }
  return parsearPoligonoKML(texto, nombreArchivo);
}

/** Un KMZ es un ZIP: se toma el doc.kml (o el primer .kml que traiga). */
async function extraerKmlDeKmz(datos: ArrayBuffer | string, base64 = false): Promise<string> {
  const zip = await JSZip.loadAsync(datos as any, base64 ? { base64: true } : undefined);
  const entrada = zip.file(/(^|\/)doc\.kml$/i)[0] || zip.file(/\.kml$/i)[0];
  if (!entrada) throw new Error('El KMZ no contiene ningún archivo .kml');
  return entrada.async('string');
}
