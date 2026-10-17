// ============================================================
// GEODAILY — Abrir un área medida en Google Earth
// ============================================================
// Coordinadores e interventores ven en el Detalle del Formulario la captura
// de la medición y pueden abrirla en Google Earth para ver el predio en 3D.
//
// Estrategia por plataforma:
//  - Android: VIEW del KML (content://) → el sistema ofrece Google Earth si
//    está instalado. Si no hay app que lo abra, cae al menú de compartir.
//  - iOS: no hay esquema público de Google Earth, así que se usa el menú de
//    compartir (ahí aparece Google Earth si está instalado).
//  - Web: no hay sistema de archivos ni apps externas; se abre Google Earth
//    Web centrado en el polígono.
// ============================================================

import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { generarKML } from './kml.service';

type Punto = { latitud: number; longitud: number };

/** Nombre de archivo seguro (sin acentos ni caracteres reservados). */
const nombreArchivoSeguro = (nombre: string): string => {
  const limpio = (nombre || 'Medicion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 60);
  return `${limpio || 'Medicion'}_${Date.now()}.kml`;
};

const centroide = (puntos: Punto[]): Punto => {
  const suma = puntos.reduce(
    (acc, p) => ({ latitud: acc.latitud + p.latitud, longitud: acc.longitud + p.longitud }),
    { latitud: 0, longitud: 0 }
  );
  return { latitud: suma.latitud / puntos.length, longitud: suma.longitud / puntos.length };
};

/** Abre Google Earth Web centrado en el polígono (fallback universal). */
export const abrirGoogleEarthWeb = async (puntos: Punto[]): Promise<boolean> => {
  try {
    const centro = centroide(puntos);
    // `1000d` = altitud/distancia de cámara; `35y` inclinación; `0t` rumbo.
    const url = `https://earth.google.com/web/@${centro.latitud.toFixed(6)},${centro.longitud.toFixed(6)},0a,1200d,35y,0h,0t,0r`;
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir Google Earth Web:', error);
    return false;
  }
};

/**
 * Escribe el KML del polígono en un archivo temporal y lo abre con la app
 * externa correspondiente. Devuelve `true` si se pudo lanzar una acción.
 */
export const abrirKMLEnGoogleEarth = async (
  nombre: string,
  puntos: Punto[]
): Promise<boolean> => {
  if (!Array.isArray(puntos) || puntos.length < 3) return false;

  // Web: no hay archivos locales ni apps externas.
  if (Platform.OS === 'web') {
    return abrirGoogleEarthWeb(puntos);
  }

  let fileUri: string | null = null;
  try {
    const contenido = generarKML(nombre, puntos);
    fileUri = `${FileSystem.cacheDirectory}${nombreArchivoSeguro(nombre)}`;
    await FileSystem.writeAsStringAsync(fileUri, contenido, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo escribir el KML:', error);
    return abrirGoogleEarthWeb(puntos);
  }

  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(fileUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.google-earth.kml+xml',
      });
      return true;
    } catch (error) {
      console.log('[GoogleEarth] VIEW del KML no disponible, usando compartir:', error);
    }
  }

  // iOS (y Android sin app registrada): menú de compartir → aquí aparece
  // Google Earth si está instalado.
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.google-earth.kml+xml',
        UTI: 'com.google.earth.kml',
        dialogTitle: 'Abrir el área en Google Earth',
      });
      return true;
    }
  } catch (error) {
    console.log('[GoogleEarth] Compartir no disponible:', error);
  }

  return abrirGoogleEarthWeb(puntos);
};
