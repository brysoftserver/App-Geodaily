// ============================================================
// GEODAILY — Servicio de KML (Importar/Exportar)
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Escapar los caracteres reservados del XML.
 *
 * El nombre del KML ahora lo escribe el técnico (o viene del beneficiario),
 * así que puede contener `&`, `<`, `"`, etc. Sin escapar, el archivo se
 * generaba mal y Google Earth / QGIS lo rechazaban como KML inválido.
 */
const escaparXml = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Construir el nombre de archivo del KML.
 *
 * Antes TODAS las exportaciones se llamaban igual (`Medicion_2026-10-17`),
 * así que la segunda sobrescribía a la primera y dos predios exportados el
 * mismo día quedaban indistinguibles al compartirlos. Ahora:
 *   1. El nombre legible que escribió el usuario va primero
 *      (`Luiz Rojas - Medicion`).
 *   2. Se agrega fecha + hora + segundos para que nunca haya colisión.
 * Los acentos se quitan y los espacios se vuelven `_` para que el archivo
 * ser pueda compartir sin problemas; el `<name>` interno del KML conserva
 * el texto tal cual lo escribió el usuario.
 */
const nombreArchivoKML = (nombre: string): string => {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  const base = limpio || 'KML';
  const ahora = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  const sello =
    `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}` +
    `_${dos(ahora.getHours())}-${dos(ahora.getMinutes())}-${dos(ahora.getSeconds())}`;
  return `${base}_${sello}.kml`;
};

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
  const nombreXml = escaparXml(nombre);

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${nombreXml}</name>
    <Placemark>
      <name>${nombreXml}</name>
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
    const filename = nombreArchivoKML(nombre);
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
 * Generar archivo KML de una RUTA (LineString) a partir de las posiciones
 * grabadas por el tracking — a diferencia de `generarKML`, que cierra un
 * polígono, esto traza una línea abierta con el trayecto completo.
 */
export const generarKMLRuta = (
  nombre: string,
  puntos: { latitud: number; longitud: number; altitud?: number }[]
): string => {
  const coords = puntos
    .map((p) => `${p.longitud},${p.latitud},${p.altitud ?? 0}`)
    .join(' ');
  const nombreXml = escaparXml(nombre);

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${nombreXml}</name>
    <Placemark>
      <name>${nombreXml}</name>
      <Style>
        <LineStyle>
          <color>ff0000ff</color>
          <width>4</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
};

/**
 * Exportar una ruta (trayecto de tracking) a KML y compartir — mismo
 * patrón que `exportarKML`, pero con LineString en vez de Polygon.
 */
export const exportarKMLRuta = async (
  nombre: string,
  puntos: { latitud: number; longitud: number; altitud?: number }[]
): Promise<string | null> => {
  try {
    const kmlContent = generarKMLRuta(nombre, puntos);
    const filename = nombreArchivoKML(nombre);
    const fileUri = `${FileSystem.documentDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(fileUri, kmlContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.google-earth.kml+xml',
        dialogTitle: 'Exportar ruta a KML',
      });
    }

    console.log('[KML] Ruta exportada:', fileUri);
    return fileUri;
  } catch (error) {
    console.error('[KML] Error al exportar ruta:', error);
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
