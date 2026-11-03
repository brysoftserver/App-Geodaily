// ============================================================
// GEODAILY — Abrir un área medida en Google Earth
// ============================================================
// Coordinadores e interventores ven en el Detalle del Formulario la captura
// de la medición y pueden abrirla en Google Earth para ver el predio en 3D.
//
// IMPORTANTE: Google Earth se abre SIEMPRE en el navegador (Google Earth
// Web). No se invoca la app nativa de Google Earth a propósito:
//  - En móvil, `Linking.openURL` con una URL https la resuelve el sistema y
//    puede terminar en la app instalada (o en un diálogo "¿Abrir con…?").
//    Para evitarlo se usa `expo-web-browser`, que abre un navegador in-app
//    y nunca delega a apps externas.
//  - En web se abre una pestaña nueva con `window.open`.
//
// El KML (polígono completo) sigue disponible para quien quiera abrirlo en
// la app de escritorio/móvil de Google Earth.
// ============================================================

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { generarKML, generarKMLPunto } from './kml.service';

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

/** URL del visor web de Google Earth centrado en el centroide del área. */
export const urlGoogleEarthWeb = (puntos: Punto[]): string => {
  const centro = centroide(puntos);
  // `1200d` = distancia de cámara; `35y` inclinación; `0h` rumbo; `0t` tilt.
  return `https://earth.google.com/web/@${centro.latitud.toFixed(6)},${centro.longitud.toFixed(6)},0a,1200d,35y,0h,0t,0r`;
};

/**
 * URL de Google Maps con un MARCADOR (pin rojo) en la coordenada exacta.
 *
 * Google Earth Web NO dibuja marcadores a partir de un KML pasado como
 * `data:` URI (rechaza ese esquema por CSP), así que el usuario veía el
 * área pero nunca el punto. Google Maps sí muestra siempre el pin, tanto
 * en web como en móvil, y es la forma fiable de decir «aquí es».
 */
export const urlGoogleMapsConPin = (punto: Punto): string => {
  const lat = punto.latitud.toFixed(6);
  const lon = punto.longitud.toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
};

/**
 * URL del visor web de Google Earth centrado en un punto (sin marcador).
 * Se mantiene como vista complementaria en 3D del área.
 */
export const urlGoogleEarthWebConPin = (punto: Punto, _nombre = 'Ubicación'): string => {
  return `https://earth.google.com/web/@${punto.latitud.toFixed(6)},${punto.longitud.toFixed(6)},0a,600d,35y,0h,0t,0r`;
};

/**
 * Abre Google Earth Web en una pestaña nueva (solo web).
 *
 * Debe llamarse de forma SÍNCRONA, como primera línea del manejador del
 * clic (antes de cualquier `await`): los navegadores solo permiten
 * `window.open()` como respuesta directa a un gesto del usuario — si se
 * llama después de esperar una promesa, la bloquean como pop-up.
 */
export const abrirGoogleEarthWebSincrono = (puntos: Punto[]): boolean => {
  if (Platform.OS !== 'web') return false;
  try {
    const ventana = window.open(urlGoogleEarthWeb(puntos), '_blank', 'noopener,noreferrer');
    return !!ventana;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir la pestaña:', error);
    return false;
  }
};

/**
 * Abre Google Maps con el pin en la coordenada (solo web).
 * Debe llamarse de forma SÍNCRONA desde el manejador del clic.
 */
export const abrirGoogleMapsConPinSincrono = (punto: Punto): boolean => {
  if (Platform.OS !== 'web') return false;
  try {
    const ventana = window.open(urlGoogleMapsConPin(punto), '_blank', 'noopener,noreferrer');
    return !!ventana;
  } catch (error) {
    console.warn('[GoogleMaps] No se pudo abrir la pestaña con el pin:', error);
    return false;
  }
};

/**
 * Igual que `abrirGoogleEarthWebSincrono`, pero centrado en un punto.
 * Debe llamarse de forma SÍNCRONA desde el manejador del clic.
 */
export const abrirGoogleEarthWebConPinSincrono = (
  punto: Punto,
  nombre = 'Ubicación'
): boolean => {
  if (Platform.OS !== 'web') return false;
  try {
    const ventana = window.open(
      urlGoogleEarthWebConPin(punto, nombre),
      '_blank',
      'noopener,noreferrer'
    );
    return !!ventana;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir la pestaña con el pin:', error);
    return false;
  }
};

/**
 * Abre Google Earth Web SIEMPRE en el navegador, nunca en la app nativa.
 *  - Web: pestaña nueva.
 *  - Android/iOS: navegador in-app (`expo-web-browser`), que no delega a
 *    apps externas ni muestra el diálogo "¿Abrir con…?".
 */
export const abrirGoogleEarthWeb = async (puntos: Punto[]): Promise<boolean> => {
  if (!Array.isArray(puntos) || puntos.length === 0) return false;
  const url = urlGoogleEarthWeb(puntos);

  if (Platform.OS === 'web') {
    return abrirGoogleEarthWebSincrono(puntos);
  }

  try {
    await WebBrowser.openBrowserAsync(url, {
      // Barra de herramientas con botón de cerrar: el usuario vuelve a la app.
      toolbarColor: '#1B5E20',
      controlsColor: '#FFFFFF',
      enableBarCollapsing: true,
      showTitle: true,
    });
    return true;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir el navegador in-app:', error);
  }

  // Último recurso: si el navegador in-app falla, se intenta el enlace del
  // sistema. Puede abrir la app nativa, pero solo si todo lo anterior falló.
  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir Google Earth Web:', error);
    return false;
  }
};

/**
 * Abre Google Maps con el pin en la coordenada, siempre en el navegador
 * (nunca en la app nativa de Maps). Mismo patrón que `abrirGoogleEarthWeb`.
 */
export const abrirGoogleMapsConPin = async (punto: Punto): Promise<boolean> => {
  if (!Number.isFinite(punto?.latitud) || !Number.isFinite(punto?.longitud)) return false;
  const url = urlGoogleMapsConPin(punto);

  if (Platform.OS === 'web') {
    return abrirGoogleMapsConPinSincrono(punto);
  }

  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: '#1B5E20',
      controlsColor: '#FFFFFF',
      enableBarCollapsing: true,
      showTitle: true,
    });
    return true;
  } catch (error) {
    console.warn('[GoogleMaps] No se pudo abrir el navegador in-app con el pin:', error);
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn('[GoogleMaps] No se pudo abrir Google Maps con el pin:', error);
    return false;
  }
};

/**
 * Abre Google Earth Web centrado en la coordenada, siempre en el navegador
 * (nunca en la app nativa). Mismo patrón que `abrirGoogleEarthWeb`.
 */
export const abrirGoogleEarthWebConPin = async (
  punto: Punto,
  nombre = 'Ubicación'
): Promise<boolean> => {
  if (!Number.isFinite(punto?.latitud) || !Number.isFinite(punto?.longitud)) return false;
  const url = urlGoogleEarthWebConPin(punto, nombre);

  if (Platform.OS === 'web') {
    return abrirGoogleEarthWebConPinSincrono(punto, nombre);
  }

  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: '#1B5E20',
      controlsColor: '#FFFFFF',
      enableBarCollapsing: true,
      showTitle: true,
    });
    return true;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir el navegador in-app con el pin:', error);
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn('[GoogleEarth] No se pudo abrir Google Earth Web con el pin:', error);
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
