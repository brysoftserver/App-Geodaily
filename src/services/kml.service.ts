// ============================================================
// GEODAILY — Servicio de KML (Importar/Exportar)
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Generar archivo KML a partir de un polígono de puntos
 */
export const generarKML = (
  nombre: string,
  puntos: { latitud: number; longitud: number }[]
): string => {
  const coords = puntos
    .map((p) => `${p.longitud},${p.latitud},0`)
    .join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${nombre}</name>
    <Placemark>
      <name>${nombre}</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
};

/**
 * Exportar KML a archivo y compartir
 */
export const exportarKML = async (
  nombre: string,
  puntos: { latitud: number; longitud: number }[]
): Promise<string | null> => {
  try {
    const kmlContent = generarKML(nombre, puntos);
    const filename = `${nombre.replace(/[^a-zA-Z0-9]/g, '_')}.kml`;
    const fileUri = `${FileSystem.documentDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(fileUri, kmlContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // Intentar compartir si está disponible
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.google-earth.kml+xml',
        dialogTitle: 'Exportar KML',
      });
    }

    console.log('[KML] Exportado:', fileUri);
    return fileUri;
  } catch (error) {
    console.error('[KML] Error al exportar:', error);
    return null;
  }
};

/**
 * Importar archivo KML y extraer puntos
 */
export const importarKML = async (
  uri: string
): Promise<{
  nombre: string;
  puntos: { latitud: number; longitud: number }[];
} | null> => {
  try {
    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // Extraer nombre
    const nameMatch = content.match(/<name>([^<]+)<\/name>/);
    const nombre = nameMatch ? nameMatch[1] : 'Importado';

    // Extraer coordenadas del polígono
    const coordsMatch = content.match(
      /<coordinates>([\s\S]*?)<\/coordinates>/
    );
    if (!coordsMatch) {
      console.warn('[KML] No se encontraron coordenadas');
      return { nombre, puntos: [] };
    }

    const coordsStr = coordsMatch[1].trim();
    const puntos = coordsStr
      .split(/[\s]+/)
      .filter((c) => c.trim().length > 0)
      .map((coord) => {
        const [lon, lat] = coord.split(',').map(Number);
        return { latitud: lat, longitud: lon };
      })
      .filter((p) => !isNaN(p.latitud) && !isNaN(p.longitud));

    return { nombre, puntos };
  } catch (error) {
    console.error('[KML] Error al importar:', error);
    return null;
  }
};

/**
 * Calcular área usando fórmula de Shoelace
 */
export const calcularArea = (
  puntos: { latitud: number; longitud: number }[]
): { areaMetros2: number; areaHectareas: number; perimetroMetros: number } => {
  if (puntos.length < 3) {
    return { areaMetros2: 0, areaHectareas: 0, perimetroMetros: 0 };
  }

  // Cerrar el polígono si no está cerrado
  const pts =
    puntos[0].latitud === puntos[puntos.length - 1].latitud &&
    puntos[0].longitud === puntos[puntos.length - 1].longitud
      ? puntos
      : [...puntos, puntos[0]];

  // Convertir a metros (aproximación plana para áreas pequeñas)
  const lat0 = pts[0].latitud;
  const lon0 = pts[0].longitud;

  const ptsM = pts.map((p) => ({
    x: (p.longitud - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180),
    y: (p.latitud - lat0) * 110540,
  }));

  // Fórmula de Shoelace para área
  let area2 = 0;
  for (let i = 0; i < ptsM.length - 1; i++) {
    area2 += ptsM[i].x * ptsM[i + 1].y - ptsM[i + 1].x * ptsM[i].y;
  }
  const areaM2 = Math.abs(area2) / 2;

  // Perímetro
  let perimetro = 0;
  for (let i = 0; i < ptsM.length - 1; i++) {
    const dx = ptsM[i + 1].x - ptsM[i].x;
    const dy = ptsM[i + 1].y - ptsM[i].y;
    perimetro += Math.sqrt(dx * dx + dy * dy);
  }

  return {
    areaMetros2: Math.round(areaM2),
    areaHectareas: Math.round((areaM2 / 10000) * 100) / 100,
    perimetroMetros: Math.round(perimetro),
  };
};
