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
  `https://maps.google.com/maps?q=${punto.latitud},${punto.longitud}&z=17&t=k&output=embed&hl=es`;

const escaparHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Página mínima que muestra el visor de Google Maps dentro de un iframe. */
const paginaVisorMapa = (punto: PuntoMapa): string => {
  const coords = `${punto.latitud}, ${punto.longitud}`;
  const visor = escaparHtml(urlGoogleMapsVisor(punto));
  const busqueda = escaparHtml(
    `https://www.google.com/maps/search/?api=1&query=${punto.latitud},${punto.longitud}`
  );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ubicación ${escaparHtml(coords)}</title>
<style>
html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#fff}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:#1b5e20;color:#fff;font-size:14px}
header a{color:#fff;font-weight:600;white-space:nowrap}
iframe{flex:1;width:100%;border:0}
</style></head><body>
<header><span>📍 ${escaparHtml(coords)}</span><a href="${busqueda}" target="_blank" rel="noopener">Abrir en Google Maps</a></header>
<iframe src="${visor}" allowfullscreen loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe>
</body></html>`;
};

/**
 * Abre la coordenada en Google Maps.
 *
 * - Web: pestaña nueva con una página propia que muestra el visor embed
 *   dentro de un iframe (sin diálogo "Abrir con").
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
      // Google ya NO deja abrir `/maps/embed` directamente en una pestaña
      // ("The Google Maps Embed API must be used in an iframe"). Por eso se
      // abre una página propia (Blob, generada aquí mismo) que contiene el
      // visor dentro de un <iframe>. Todo es síncrono: sigue siendo el mismo
      // gesto del usuario y el navegador no lo bloquea.
      const html = paginaVisorMapa(punto);
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const ventana = window.open(blobUrl, '_blank');
      if (ventana) {
        try { ventana.opener = null; } catch { /* sin acceso: no importa */ }
      }
      return Promise.resolve(!!ventana);
    } catch {
      return Promise.resolve(false);
    }
  }

  return Linking.openURL(urlGoogleMaps(punto))
    .then(() => true)
    .catch(() => false);
};
