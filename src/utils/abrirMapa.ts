// ============================================================
// GEODAILY — Abrir una coordenada en Google Maps SIN diálogo "Abrir con"
// ============================================================
// Síntoma reportado (app web abierta en el teléfono): al pulsar «Ver en
// Google Maps» en vez del mapa aparecía un menú del sistema para elegir
// con qué app abrir el enlace (el usuario lo percibe como un menú "para
// compartir") y a veces terminaba abriéndose otra aplicación.
//
// Causa: la URL clásica `https://www.google.com/maps?q=lat,lon` sirve una
// página que, en Android, dispara un
//   intent://…#Intent;scheme=https;package=com.google.android.apps.maps;…
// y el sistema lo resuelve con el selector de aplicaciones.
//
// Solución (solo web): usar el visor `…&output=embed`, que Google
// redirige a `https://www.google.com/maps/embed?...`. Ese HTML es la
// versión para iframes: muestra el mapa con el pin y NO contiene ningún
// `intent://`, así que el navegador lo abre tal cual, sin ofrecer apps.
//
// En el teléfono (app nativa, Platform.OS !== 'web') se mantiene el enlace
// normal, porque ahí sí queremos que se abra la app de Google Maps.
// ============================================================

import { Linking, Platform } from 'react-native';

export type PuntoMapa = { latitud: number; longitud: number };

/**
 * Convierte la coordenada a número aceptando lo que llega guardado en los
 * formularios: número, texto con punto (`"2.9381"`) o texto con coma
 * decimal (`"2,9381"`). Devuelve `null` si no es una coordenada válida.
 */
const normalizarCoordenada = (valor: number | string | null | undefined): number | null => {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!texto) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
};

export const normalizarPuntoMapa = (
  latitud: number | string | null | undefined,
  longitud: number | string | null | undefined
): PuntoMapa | null => {
  const lat = normalizarCoordenada(latitud);
  const lon = normalizarCoordenada(longitud);
  if (lat === null || lon === null) return null;
  // Rango geográfico válido: evita abrir el mapa en (0,0) o en coordenadas
  // corruptas que ya han aparecido en la base de datos.
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitud: lat, longitud: lon };
};

/** Enlace normal de Google Maps: en el teléfono abre la app de Maps. */
export const urlGoogleMaps = (punto: PuntoMapa): string =>
  `https://www.google.com/maps?q=${punto.latitud},${punto.longitud}`;

/**
 * Visor de Google Maps para el navegador: Google lo redirige a
 * `/maps/embed?…`, que no dispara el selector de apps de Android.
 */
export const urlGoogleMapsVisor = (punto: PuntoMapa): string =>
  `https://maps.google.com/maps?q=${punto.latitud},${punto.longitud}&z=17&output=embed&hl=es`;

/**
 * Abre la coordenada en Google Maps.
 *
 * - Web: pestaña nueva con el visor embed (sin diálogo "Abrir con").
 *   `window.open` se ejecuta de forma SÍNCRONA, en el mismo gesto del
 *   usuario; si se llamara después de un `await` el navegador la
 *   bloquearía como ventana emergente.
 * - Nativo: enlace normal, que el sistema resuelve con la app de Maps.
 *
 * Devuelve `false` si la coordenada no es válida o si el navegador bloqueó
 * la pestaña, para que la pantalla pueda avisar al usuario.
 */
export const abrirMapaEnGoogle = (
  latitud: number | string | null | undefined,
  longitud: number | string | null | undefined
): Promise<boolean> => {
  const punto = normalizarPuntoMapa(latitud, longitud);
  if (!punto) return Promise.resolve(false);

  if (Platform.OS === 'web') {
    try {
      const ventana = window.open(urlGoogleMapsVisor(punto), '_blank', 'noopener,noreferrer');
      return Promise.resolve(!!ventana);
    } catch {
      return Promise.resolve(false);
    }
  }

  return Linking.openURL(urlGoogleMaps(punto))
    .then(() => true)
    .catch(() => false);
};
