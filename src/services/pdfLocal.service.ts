// ============================================================
// GEODAILY — Servicio de PDF Local (expo-print)
// Genera el PDF directamente en el dispositivo con TODAS
// las evidencias incluidas: fotos reales redimensionadas,
// firmas, sello de verificación biométrica.
// ============================================================

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Formulario, FotoGeotag } from '../types';
import { API_CONFIG } from '../theme';
import { formatFecha, formatFechaHora, formatCoordenadas } from '../utils/formatters';
import {
  construirSeccionesEncuesta,
  SeccionResuelta,
} from '../utils/encuestaSchema';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss, MembreteVariante } from '../utils/membrete';
import { cabecerasDeArchivo, resolverFirmasRemotas, FirmaResuelta } from './archivos.service';

/**
 * Descargar (si hace falta autenticación) y convertir una firma resuelta a
 * data URI para embeberla en el HTML del PDF. expo-print no puede adjuntar
 * cabeceras a un <img src="http://...">, así que las firmas remotas (ya
 * sincronizadas, servidas vía /api/archivos/:id/contenido) hay que
 * descargarlas primero — mismo patrón que las fotos remotas en
 * `convertirFotosAHTML`.
 */
async function resolverFirmaComoDataUri(firma: FirmaResuelta | null): Promise<string | null> {
  if (!firma) return null;
  if (firma.uri.startsWith('data:')) return firma.uri;
  try {
    // En web no existe FileSystem.cacheDirectory/downloadAsync (son del
    // dispositivo, no del navegador) — por eso las firmas remotas nunca se
    // embebían ahí. `fetch` sí funciona en el navegador y, como `firma.uri`
    // ya trae el token en la URL cuando aplica (ver `fuenteConAuth` en
    // archivos.service.ts), no hace falta nada más para autenticarlo.
    if (Platform.OS === 'web') {
      const respuesta = await fetch(firma.uri, { headers: firma.headers });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const blob = await respuesta.blob();
      return await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(lector.result as string);
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(blob);
      });
    }
    const destino = `${FileSystem.cacheDirectory}pdf_firma_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`;
    const descarga = await FileSystem.downloadAsync(firma.uri, destino, { headers: firma.headers });
    const base64 = await FileSystem.readAsStringAsync(descarga.uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/png;base64,${base64}`;
  } catch (e) {
    console.warn('[PDF Local] No se pudo descargar la firma remota:', e);
    return null;
  }
}

/**
 * Descarga una tesela de mapa pública (sin autenticación) y la convierte a
 * data URI. Si no hay señal en el momento de generar el PDF, retorna null
 * y el mapa se omite — nunca debe impedir que el resto del PDF se genere.
 */
async function descargarImagenPublicaComoDataUri(url: string): Promise<string | null> {
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
    const destino = `${FileSystem.cacheDirectory}pdf_tile_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`;
    const descarga = await FileSystem.downloadAsync(url, destino);
    const base64 = await FileSystem.readAsStringAsync(descarga.uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/png;base64,${base64}`;
  } catch (e) {
    console.warn('[PDF Local] No se pudo descargar la tesela de mapa:', e);
    return null;
  }
}

// Mismo servidor de teselas raster satélite que usa MapViewOffline.tsx
// (estilo "satelite"). Se eligió satélite y no el estilo "relieve" (Canvas/
// World_Light_Gray_Base) porque ese último no tiene datos vectoriales para
// zonas rurales como el Caquetá: a partir de zoom ~12 devuelve una tesela
// placeholder ("Map data not yet available") en vez de mapa real, incluso
// con conexión. El satélite (World_Imagery) sí tiene cobertura fotográfica
// real en todo el planeta.
const MAPA_TILE_URL_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
// Zoom más alejado que el original (17) para dar contexto de vereda/finca
// en vez de quedar tan cerca que solo se ve el punto exacto sin referencia.
const MAPA_ZOOM = 14;
const MAPA_TILE_PX = 140;

/**
 * Construye el HTML de un mapa pequeño (2×2 teselas + pin) centrado en el
 * punto capturado, para incrustar en el PDF donde no se puede embeber el
 * mapa interactivo de la app (preguntas 20 y 32). Usa una cuadrícula 2×2
 * en vez de una sola tesela para que el punto nunca quede pegado al borde
 * de la imagen, sin importar en qué parte de su tesela caiga.
 * Retorna '' si no hay coordenadas o si falla la descarga (sin señal).
 */
async function construirMapaEstaticoHtml(lat?: number, lon?: number, ubicacionTexto?: string): Promise<string> {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return '';

  const n = Math.pow(2, MAPA_ZOOM);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const pxFrac = x - tileX;
  const pyFrac = y - tileY;

  // Tesela vecina al lado donde cae el punto dentro de su propia tesela,
  // para que quede dentro del cuarto central de la cuadrícula 2×2.
  const otherTileX = pxFrac < 0.5 ? tileX - 1 : tileX + 1;
  const otherTileY = pyFrac < 0.5 ? tileY - 1 : tileY + 1;
  const leftTileX = Math.min(tileX, otherTileX);
  const topTileY = Math.min(tileY, otherTileY);

  const puntoXFrac = (tileX - leftTileX + pxFrac) / 2;
  const puntoYFrac = (tileY - topTileY + pyFrac) / 2;

  const [tl, tr, bl, br] = await Promise.all([
    descargarImagenPublicaComoDataUri(`${MAPA_TILE_URL_BASE}/${MAPA_ZOOM}/${topTileY}/${leftTileX}`),
    descargarImagenPublicaComoDataUri(`${MAPA_TILE_URL_BASE}/${MAPA_ZOOM}/${topTileY}/${leftTileX + 1}`),
    descargarImagenPublicaComoDataUri(`${MAPA_TILE_URL_BASE}/${MAPA_ZOOM}/${topTileY + 1}/${leftTileX}`),
    descargarImagenPublicaComoDataUri(`${MAPA_TILE_URL_BASE}/${MAPA_ZOOM}/${topTileY + 1}/${leftTileX + 1}`),
  ]);
  if (!tl || !tr || !bl || !br) return '';

  const size = MAPA_TILE_PX * 2;
  const pinLeft = puntoXFrac * size;
  const pinTop = puntoYFrac * size;

  // El mapa satelital no trae nombres de lugar (y el estilo con etiquetas
  // no tiene cobertura en veredas rurales — ver nota de MAPA_TILE_URL_BASE
  // arriba), así que el municipio/vereda se imprime como texto, tomado del
  // dato que el formulario ya conoce, en vez de depender de la cartografía.
  const etiquetaHtml = ubicacionTexto
    ? `<div style="width:${size}px;font-size:11px;color:#2d3436;background:#f1f2f6;padding:3px 6px;border:1px solid #dfe6e9;border-bottom:none;border-radius:6px 6px 0 0;margin-top:6px;">📍 ${escapeHtml(ubicacionTexto)}</div>`
    : '';

  return `
      ${etiquetaHtml}
      <div style="position:relative;width:${size}px;height:${size}px;overflow:hidden;border:1px solid #dfe6e9;border-radius:${ubicacionTexto ? '0 0 6px 6px' : '6px'};${ubicacionTexto ? '' : 'margin-top:6px;'}">
        <img src="${tl}" style="position:absolute;left:0;top:0;width:${MAPA_TILE_PX}px;height:${MAPA_TILE_PX}px;" />
        <img src="${tr}" style="position:absolute;left:${MAPA_TILE_PX}px;top:0;width:${MAPA_TILE_PX}px;height:${MAPA_TILE_PX}px;" />
        <img src="${bl}" style="position:absolute;left:0;top:${MAPA_TILE_PX}px;width:${MAPA_TILE_PX}px;height:${MAPA_TILE_PX}px;" />
        <img src="${br}" style="position:absolute;left:${MAPA_TILE_PX}px;top:${MAPA_TILE_PX}px;width:${MAPA_TILE_PX}px;height:${MAPA_TILE_PX}px;" />
        <svg width="24" height="30" viewBox="0 0 28 36" style="position:absolute;left:${pinLeft}px;top:${pinTop}px;transform:translate(-50%,-100%);">
          <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="#d63031" />
          <circle cx="14" cy="14" r="6" fill="#ffffff" />
        </svg>
      </div>`;
}

/**
 * Generar PDF local con fotos, firmas y huella embebidas.
 *
 * Siempre lleva el membrete de Ejecución (ACPR) — caracterización y visita
 * técnica son formatos institucionales fijos, sin importar el rol de quien
 * los genera (a diferencia del PDF de revisión, que sí varía con el rol).
 *
 * @param fotosResueltas  Evidencias YA resueltas (ver
 *                  `resolverEvidenciasRemotas`): locales si existen en este
 *                  dispositivo, o URLs del servidor si no. Si se omite, se
 *                  usa `formulario.fotos` tal cual — correcto solo en el
 *                  dispositivo que capturó la visita. Sin este parámetro,
 *                  generar el PDF desde OTRO rol/teléfono intentaba leer
 *                  rutas file:// que no existen ahí y el PDF salía sin
 *                  evidencias, aunque el resto del documento (membrete,
 *                  datos, respuestas) sí se generaba bien.
 */
/**
 * Construye el HTML completo del PDF institucional (membrete, respuestas,
 * fotos, firmas y sello biométrico) sin generar el archivo — extraído de
 * `generarPDFLocal` para poder reusarlo en web, donde `expo-print` no genera
 * un PDF real (ver `imprimirHtmlWeb` en `utils/printWeb.ts`): ahí este mismo
 * HTML se abre en una pestaña aparte para imprimir/guardar como PDF.
 */
export const construirHtmlFormulario = async (
  formulario: Formulario,
  fotosResueltas?: FotoGeotag[]
): Promise<string> => {
  // 1. Convertir fotos a base64 para embedir en HTML — local o remota
  const fotosHtml = await convertirFotosAHTML(fotosResueltas ?? formulario.fotos ?? []);

  // 2. Resolver firmas — recién completado el formulario son base64 en
  // memoria, pero tras sincronizar el backend las reemplaza por su ruta
  // interna de MinIO; hay que buscarlas en /api/archivos y descargarlas
  // con autenticación antes de poder embeberlas en el PDF.
  const firmasResueltas = await resolverFirmasRemotas(
    formulario.id,
    formulario.firma_beneficiario,
    formulario.firma_tecnico
  );
  const [firmaBenefDataUri, firmaTecDataUri] = await Promise.all([
    resolverFirmaComoDataUri(firmasResueltas.beneficiario),
    resolverFirmaComoDataUri(firmasResueltas.tecnico),
  ]);

  const firmaBenefHtml = firmaBenefDataUri
    ? `<div class="firma-item">
         <p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(formulario.beneficiario.nombre)}</strong> (C.C. ${escapeHtml(formulario.beneficiario.cedula || '—')})</p>
         <img src="${firmaBenefDataUri}" alt="Firma del beneficiario" class="firma-img" />
       </div>`
    : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

  const firmaTecHtml = firmaTecDataUri
    ? `<div class="firma-item">
         <p class="evidencia-label">🖊️ Firma del Técnico en Terreno — <strong>${escapeHtml(formulario.tecnico.nombre)}</strong> (C.C. ${escapeHtml(formulario.tecnico.cedula || '—')})</p>
         <img src="${firmaTecDataUri}" alt="Firma del técnico" class="firma-img" />
       </div>`
    : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

  // 3. Generar sello de verificación biométrica (con gráfico de huella SVG)
  const selloBiometricoHtml = formulario.huella_beneficiario
    ? generarSelloBiometrico(formulario.beneficiario.nombre)
    : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Certificación biométrica del técnico</p><p class="no-data">No registrada</p></div>`;

  // 4. Construir HTML completo según el tipo de formulario
  if (formulario.tipo === 'caracterizacion' && (formulario as any).caracterizacion_nueva) {
    return await construirHTMLCaracterizacion(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
  }
  return construirHTML(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
};

export const generarPDFLocal = async (
  formulario: Formulario,
  fotosResueltas?: FotoGeotag[]
): Promise<string | null> => {
  try {
    const html = await construirHtmlFormulario(formulario, fotosResueltas);

    // 5. Generar PDF con expo-print
    // Carta (612 × 792 pt), igual que el membrete oficial de ACPR.
    // Antes se generaba en A4, así que el encabezado y el pie no cuadraban
    // con el formato impreso de la entidad.
    const { uri } = await Print.printToFileAsync({
      html,
      width: 612,
      height: 792,
    });

    // 6. Renombrar PDF con formato: TECNICO-BENEFICIARIO-VEREDA-FECHA.pdf
    const nombreTecnico = (formulario.tecnico?.nombre || 'tecnico').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const nombreBenef = (formulario.beneficiario?.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const vereda = (formulario.beneficiario?.vereda || 'vereda').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date(formulario.created_at || Date.now()).toISOString().split('T')[0];
    const pdfName = `${nombreTecnico}-${nombreBenef}-${vereda}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;

    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      console.log('[PDF Local] PDF renombrado:', pdfPath);
      return pdfPath;
    } catch (moveErr) {
      console.warn('[PDF Local] No se pudo renombrar, retornando original:', moveErr);
      return uri;
    }
  } catch (error) {
    console.error('[PDF Local] Error al generar PDF:', error);
    return null;
  }
};

export interface ItemChecklistRevision {
  texto: string;
  respuesta: string;
}

export interface DatosRevisionChecklist {
  rol: 'coordinador' | 'interventor';
  revisorNombre: string;
  /** 'linea' = revisión documental/remota; 'campo' = verificación en sitio */
  tipoChecklist: 'linea' | 'campo';
  items: ItemChecklistRevision[];
}

const TITULO_CHECKLIST: Record<'linea' | 'campo', string> = {
  linea: 'FORMULARIO EN LÍNEA',
  campo: 'FORMULARIO EN CAMPO',
};
const INTRO_CHECKLIST: Record<'linea' | 'campo', string> = {
  linea: 'Durante esta revisión se verificará:',
  campo: 'En esta etapa se verificará:',
};

/**
 * Generar el PDF de una de las dos listas de verificación del revisor
 * (coordinador o interventor): "Formulario en línea" (revisión documental
 * de lo que el técnico registró) o "Formulario en campo" (verificación
 * presencial). Lleva el membrete de la entidad de ESE rol — Ejecución
 * (ACPR) para coordinador, Interventoría (ASEMP) para interventor — a
 * diferencia del PDF del formulario del técnico, que siempre usa Ejecución
 * sin importar quién lo descargue.
 */
export const generarPDFRevisionChecklist = async (
  formulario: Formulario,
  datos: DatosRevisionChecklist
): Promise<string | null> => {
  try {
    const variante: MembreteVariante = datos.rol === 'interventor' ? 'interventoria' : 'ejecucion';
    const html = construirHTMLRevisionChecklist(formulario, datos, variante);

    const { uri } = await Print.printToFileAsync({
      html,
      width: 612,
      height: 792,
    });

    const rolPrefijo = datos.rol === 'interventor' ? 'INTERVENTORIA' : 'COORDINACION';
    const tipoPrefijo = datos.tipoChecklist === 'linea' ? 'EN-LINEA' : 'EN-CAMPO';
    const nombreBenef = (formulario.beneficiario?.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `${rolPrefijo}-${tipoPrefijo}-${nombreBenef}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;

    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch (moveErr) {
      console.warn('[PDF Revisión] No se pudo renombrar, retornando original:', moveErr);
      return uri;
    }
  } catch (error) {
    console.error('[PDF Revisión] Error al generar PDF:', error);
    return null;
  }
};

export interface DatosPDFSeguimiento {
  autorRol: 'coordinador' | 'interventor';
  autorNombre: string;
  actividad: string;
  objetivoVisita?: string | null;
  descripcionActividad?: string | null;
  observaciones?: string | null;
  beneficiarioNombre?: string | null;
  /** created_at del seguimiento */
  fecha: string;
  /** Cada foto trae archivo_id (ya subida) y/o uri local — se prefiere la uri local si existe, para poder generar el PDF sin conexión. */
  fotos: { archivo_id?: string; uri?: string }[];
  /** Si se grabó algún video — no se embebe en el PDF, solo se menciona (igual que el formulario del técnico). */
  tieneVideo?: boolean;
  /** 'data:...' (base64 local, aún no subida) o archivo_id de MinIO */
  firmaBeneficiario?: string;
  /** 'data:...' (base64 local, aún no subida) o archivo_id de MinIO */
  firmaAutor?: string;
  /** Georeferencia puntual (captura única de 8s de alta precisión — CapturaGPSPrecisa) */
  geoLatitud?: number;
  geoLongitud?: number;
  geoAltitud?: number;
  geoPrecision?: number;
}

/**
 * Generar el PDF de un seguimiento de Coordinación o Interventoría — lleva
 * el membrete de la entidad de ESE rol (Ejecución/ACPR para coordinador,
 * Interventoría/ASEMP para interventor), igual criterio que
 * `generarPDFRevisionChecklist`.
 */
export const generarPDFSeguimiento = async (datos: DatosPDFSeguimiento): Promise<string | null> => {
  try {
    const variante: MembreteVariante = datos.autorRol === 'interventor' ? 'interventoria' : 'ejecucion';
    const html = await construirHTMLSeguimiento(datos, variante);

    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

    const rolPrefijo = datos.autorRol === 'interventor' ? 'INTERVENTORIA' : 'COORDINACION';
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `SEGUIMIENTO-${rolPrefijo}-${fechaStr}-${Date.now()}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;

    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch (moveErr) {
      console.warn('[PDF Seguimiento] No se pudo renombrar, retornando original:', moveErr);
      return uri;
    }
  } catch (error) {
    console.error('[PDF Seguimiento] Error al generar PDF:', error);
    return null;
  }
};

/**
 * Igual que `generarPDFSeguimiento` pero devuelve SOLO el HTML institucional,
 * sin generar archivo. Lo usa el flujo web (ver `imprimirHtmlEnVentana` en
 * `utils/printWeb.ts`): en el navegador expo-print no produce un PDF real, así
 * que este mismo HTML se abre en una pestaña y se imprime desde ahí.
 */
export const construirHtmlSeguimiento = async (datos: DatosPDFSeguimiento): Promise<string> => {
  const variante: MembreteVariante = datos.autorRol === 'interventor' ? 'interventoria' : 'ejecucion';
  return construirHTMLSeguimiento(datos, variante);
};

export interface FilaIngresoBeneficiario {
  nombre: string;
  identificacion: string;
  telefono: string;
  vereda: string;
  finca: string;
  latitud: string;
  longitud: string;
}

/**
 * Generar el PDF del "Formato de Ingreso de Beneficiarios" (PA. 2 FO. 31,
 * Otros Formatos) a partir de las filas que el técnico escribió a mano en
 * la planilla de la app.
 */
export const generarPDFIngresoBeneficiarios = async (
  filas: FilaIngresoBeneficiario[],
  tecnicoNombre: string
): Promise<string | null> => {
  try {
    const html = construirHTMLIngresoBeneficiarios(filas);

    // El formato oficial (PA. 2 FO. 31) es horizontal — la tabla de 8
    // columnas no cabe legible en una hoja carta vertical.
    const { uri } = await Print.printToFileAsync({
      html,
      width: 792,
      height: 612,
    });

    const nombreTecnico = (tecnicoNombre || 'tecnico').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `INGRESO-BENEFICIARIOS-${nombreTecnico}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;

    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch (moveErr) {
      console.warn('[PDF Ingreso Beneficiarios] No se pudo renombrar, retornando original:', moveErr);
      return uri;
    }
  } catch (error) {
    console.error('[PDF Ingreso Beneficiarios] Error al generar PDF:', error);
    return null;
  }
};

// Verificado contra el PDF oficial (coordenadas extraídas con pdftohtml):
// 12 filas por página, 3 páginas fijas = 36 filas en blanco.
const IB_FILAS_POR_PAGINA = 12;
const IB_PAGINAS_FIJAS = 3;

const IB_ENCABEZADO_TABLA = `
      <tr>
        <th>No.</th>
        <th>Nombre y Apellidos</th>
        <th>Identificación</th>
        <th>Teléfono</th>
        <th>Vereda</th>
        <th>Nombre de la Finca</th>
        <th>Latitud</th>
        <th>Longitud</th>
      </tr>`;

function ibFilaHtml(f: FilaIngresoBeneficiario | undefined, numero: number): string {
  if (f) {
    return `
    <tr>
      <td class="ib-no">${numero}</td>
      <td>${escapeHtml(f.nombre) || '—'}</td>
      <td>${escapeHtml(f.identificacion) || '—'}</td>
      <td>${escapeHtml(f.telefono) || '—'}</td>
      <td>${escapeHtml(f.vereda) || '—'}</td>
      <td>${escapeHtml(f.finca) || '—'}</td>
      <td>${escapeHtml(f.latitud) || '—'}</td>
      <td>${escapeHtml(f.longitud) || '—'}</td>
    </tr>`;
  }
  return `
    <tr>
      <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
      <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
    </tr>`;
}

function construirHTMLIngresoBeneficiarios(
  filas: FilaIngresoBeneficiario[]
): string {
  // El formato oficial siempre trae 3 páginas de 12 filas (36 en blanco),
  // sin importar cuántas se diligencien — es una plantilla fija. Si el
  // técnico registra más de 36, se agregan páginas adicionales completas.
  const totalConRelleno = Math.max(
    IB_FILAS_POR_PAGINA * IB_PAGINAS_FIJAS,
    Math.ceil(filas.length / IB_FILAS_POR_PAGINA) * IB_FILAS_POR_PAGINA
  );
  const totalPaginas = totalConRelleno / IB_FILAS_POR_PAGINA;
  const proyectoHtml = '“Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”';

  // El oficial repite el membrete COMPLETO (número de página correcto, y
  // el renglón del proyecto) en cada una de sus 3 hojas — no es un
  // encabezado que se repite igual en todas, cada página es su propio
  // bloque. Confiar en que el navegador reparta 36 filas de una sola tabla
  // en 3 páginas (dejándolo decidir dónde cortar, o incluso forzando el
  // corte cada 12 filas) nunca iba a poder variar "Página X de 3" ni
  // repetir el renglón del proyecto — por eso se arma cada página como un
  // bloque independiente y completo, igual que el original.
  const paginasHtml = Array.from({ length: totalPaginas }).map((_, p) => {
    const inicio = p * IB_FILAS_POR_PAGINA;
    const filasHtml = Array.from({ length: IB_FILAS_POR_PAGINA })
      .map((_, i) => ibFilaHtml(filas[inicio + i], inicio + i + 1))
      .join('');

    return `
    <div class="ib-pagina"${p > 0 ? ' style="page-break-before: always; break-before: page;"' : ''}>
      ${membreteAperturaHtml('ejecucion', 'ingreso_beneficiarios', totalPaginas, p + 1)}

      <div class="ib-proyecto">${proyectoHtml}</div>

      <table class="ib-tabla">
        <thead>${IB_ENCABEZADO_TABLA}</thead>
        <tbody>${filasHtml}</tbody>
      </table>

      ${membreteCierreHtml()}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Formato de Ingreso de Beneficiarios</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    /* El formato oficial (PA. 2 FO. 31) es horizontal — se sobreescribe el
       tamaño de página vertical que define membreteCss() por defecto. */
    @page {
      size: 27.94cm 21.59cm;
      margin: 1.3cm 2.5cm 1.0cm 2.5cm;
    }
    html, body { height: 100%; }
    .ib-pagina { height: 100%; }
    table.mb-doc { height: 100%; }
    /* Estira cada página a su alto completo para que el pie quede fijo
       abajo — cada bloque .ib-pagina es corto (12 filas), así que sin
       esto el pie de página quedaría pegado justo debajo de la tabla. */
    table.mb-doc > tbody > tr > td.mb-contenido {
      height: 100%;
      vertical-align: top;
    }
    body { font-family: 'Arial Narrow', Arial, sans-serif; color: #000; }
    .ib-proyecto {
      border: 1pt solid #000;
      text-align: center;
      font-weight: bold;
      font-size: 9.5pt;
      padding: 0.2cm;
    }
    table.ib-tabla {
      width: 100%;
      border-collapse: collapse;
      border: 1pt solid #000;
      font-size: 8.5pt;
    }
    table.ib-tabla th, table.ib-tabla td {
      border: 1pt solid #000;
      padding: 0.15cm 0.2cm;
      text-align: left;
      height: 0.7cm;
    }
    table.ib-tabla th {
      font-size: 8pt;
      text-align: center;
      text-transform: uppercase;
    }
    .ib-no { width: 0.9cm; text-align: center; }
  </style>
</head>
<body>
  ${paginasHtml}
</body>
</html>`;
}

// ============================================================
// Acta de Compromiso (PA. 2 FO. 30, Otros Formatos)
// ============================================================

export interface DatosActaCompromiso {
  nombre: string;
  cedula: string;
  telefono: string;
  correo: string;
  vereda: string;
  corregimiento: string;
  predio: string;
  calidadPredio: 'propietario' | 'poseedor' | 'otro';
  /** Fecha de la firma (ISO) — de ahí se toman día/mes/año del cierre del acta. */
  fecha: string;
  /** Firma del beneficiario, como data URI (ver SignaturePad). */
  firmaBeneficiario: string;
  /** Firma del técnico de campo, como data URI. */
  firmaTecnico: string;
  tecnicoNombre: string;
}

const AC_MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const AC_DISPONIBILIDAD = [
  'Facilitar el desarrollo de las actividades técnicas y operativas previstas en el proyecto, proporcionando al personal autorizado el acceso al predio y las condiciones necesarias para la realización de diagnósticos, visitas técnicas, georreferenciación, toma de muestras de suelo, establecimiento, seguimiento y demás actividades contempladas.',
  'Participar activa y responsablemente en las actividades programadas dentro del proyecto, incluyendo jornadas de asistencia técnica, capacitación, socialización, Escuelas de Campo para Agricultores – ECA y demás actividades de fortalecimiento de capacidades.',
  'Disponer del tiempo y colaboración necesarios para atender las visitas y actividades programadas por el equipo técnico, de acuerdo con el cronograma establecido para la ejecución del proyecto.',
  'Informar oportunamente a AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S. cualquier circunstancia que pueda afectar su participación, la disponibilidad del predio o el normal desarrollo de las actividades previstas.',
];
export const AC_ACREDITACION = [
  'Presentar y mantener actualizada la documentación requerida para acreditar la relación jurídica o material con el predio objeto de intervención, de conformidad con los requisitos establecidos para el proyecto, incluyendo, cuando corresponda, certificado de libertad y tradición o certificado de sana posesión.',
  'Manifestar que mantiene una relación efectiva con el predio rural objeto de intervención, en calidad de propietario(a) o poseedor(a) regular, de acuerdo con los requisitos establecidos para la vinculación al proyecto.',
  'Permitir la georreferenciación, identificación, diagnóstico y verificación técnica del predio, así como las demás actividades necesarias para determinar su aptitud y condiciones para el establecimiento de la unidad productora.',
];
export const AC_USO_MANEJO = [
  'Dar un uso adecuado y exclusivo a las herramientas, equipos, materiales, accesorios e insumos entregados en el marco del proyecto, destinándolos exclusivamente a las actividades relacionadas con la implementación y manejo de la unidad productora.',
  'Asumir la custodia, conservación y adecuado manejo de los elementos, herramientas, equipos e insumos que le sean entregados para el desarrollo de las actividades del proyecto.',
  'Abstenerse de vender, arrendar, permutar, transferir, ceder o destinar a fines diferentes los elementos, herramientas, equipos, materiales e insumos entregados en el marco del proyecto.',
  'Informar oportunamente cualquier pérdida, daño, deterioro o inconveniente técnico que se presente respecto de los equipos o elementos entregados, con el fin de adelantar, cuando corresponda, las gestiones relacionadas con las garantías respectivas.',
  'Utilizar los materiales e insumos entregados exclusivamente para las actividades contempladas en el proyecto, de acuerdo con las recomendaciones impartidas por el personal técnico.',
];
export const AC_TECNICOS_PRODUCTIVOS = [
  'Seguir las recomendaciones, orientaciones e instrucciones técnicas impartidas por los profesionales y técnicos vinculados al proyecto para el adecuado establecimiento, manejo y mantenimiento de la unidad productora de cacao.',
  'Implementar las buenas prácticas agrícolas y ambientales recomendadas durante las jornadas de asistencia técnica y capacitación.',
  'Participar en las actividades relacionadas con el establecimiento, manejo, fertilización, manejo fitosanitario, conservación del suelo y mantenimiento del arreglo agroforestal, conforme a las orientaciones técnicas impartidas.',
  'Permitir y facilitar el seguimiento técnico periódico de la unidad productora durante la ejecución del proyecto y el periodo de seguimiento establecido.',
];
export const AC_AMBIENTALES = [
  'Respetar las franjas de protección de los cuerpos de agua, manteniendo una distancia mínima de treinta (30) metros, conforme a las condiciones y lineamientos establecidos para el proyecto.',
  'Abstenerse de realizar actividades de deforestación o intervención de áreas boscosas para el establecimiento del sistema agroforestal, particularmente en áreas que correspondan a cañeros con antigüedad superior a cinco (5) años, de acuerdo con los criterios ambientales establecidos para el proyecto.',
  'Implementar las prácticas de manejo recomendadas para contribuir a la conservación del suelo, protección de los recursos naturales, manejo adecuado de residuos y uso eficiente de los recursos.',
];
export const AC_PERMANENCIA = [
  'Garantizar, dentro de sus posibilidades y de acuerdo con las orientaciones técnicas recibidas, el mantenimiento, cuidado y continuidad de la unidad productora de cacao implementada en el marco del proyecto.',
  'Destinar los recursos, materiales e insumos entregados al cumplimiento de las finalidades previstas en el proyecto, teniendo en cuenta que estos se encuentran asociados a recursos de origen público y tienen una destinación específica.',
  'En caso de decidir retirarse voluntariamente del proyecto, informar oportunamente a AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S. y atender las disposiciones que correspondan respecto de los elementos y recursos entregados.',
  'En caso de retiro del proyecto, cuando así corresponda de acuerdo con las condiciones aplicables, restituir los elementos, herramientas, equipos, materiales o demás bienes entregados que deban ser objeto de devolución.',
];
export const AC_ENTIDAD = [
  'Brindar asistencia técnica y acompañamiento especializado a los beneficiarios durante las etapas previstas para la implementación y manejo de las unidades productoras de cacao.',
  'Realizar las actividades técnicas contempladas en el proyecto, de acuerdo con el plan operativo, cronograma, términos de referencia y demás documentos que regulan su ejecución.',
  'Entregar los materiales, herramientas, equipos e insumos contemplados dentro de los componentes del proyecto, conforme a las condiciones, cantidades y especificaciones establecidas.',
  'Desarrollar jornadas de capacitación, fortalecimiento de capacidades y Escuelas de Campo para Agricultores – ECA, de acuerdo con la programación definida.',
  'Realizar el seguimiento técnico al establecimiento y manejo de las unidades productoras, verificando el avance de las actividades y formulando las recomendaciones que correspondan.',
  'Brindar orientación a los beneficiarios respecto del uso adecuado de los materiales, herramientas, equipos e insumos suministrados en el marco del proyecto.',
  'Promover, dentro del alcance y condiciones del proyecto, acciones orientadas al fortalecimiento productivo, comercial y organizativo de los beneficiarios y al cumplimiento de los objetivos establecidos.',
];

function acListaHtml(items: string[]): string {
  return `<ol class="ac-lista">${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`;
}

export const generarPDFActaCompromiso = async (datos: DatosActaCompromiso): Promise<string | null> => {
  try {
    const html = construirHTMLActaCompromiso(datos);
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

    const nombreBenef = (datos.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date(datos.fecha || Date.now()).toISOString().split('T')[0];
    const pdfName = `ACTA-COMPROMISO-${nombreBenef}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;

    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch (moveErr) {
      console.warn('[PDF Acta Compromiso] No se pudo renombrar, retornando original:', moveErr);
      return uri;
    }
  } catch (error) {
    console.error('[PDF Acta Compromiso] Error al generar PDF:', error);
    return null;
  }
};

function construirHTMLActaCompromiso(datos: DatosActaCompromiso): string {
  const nombre = escapeHtml(datos.nombre) || '—';
  const cedula = escapeHtml(datos.cedula) || '—';
  const predio = escapeHtml(datos.predio) || '—';
  const vereda = escapeHtml(datos.vereda) || '—';
  const corregimiento = escapeHtml(datos.corregimiento) || '—';

  const fecha = datos.fecha ? new Date(datos.fecha) : new Date();
  const dia = fecha.getDate();
  const mes = AC_MESES[fecha.getMonth()];
  const anio = fecha.getFullYear();

  const marcaCalidad = (valor: 'propietario' | 'poseedor' | 'otro') =>
    datos.calidadPredio === valor ? '<span class="ac-check">✓</span>' : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Acta de Compromiso</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    html, body { height: 100%; }
    table.mb-doc { height: 100%; }
    /* Sin esto, el motor de impresión encoge la ÚLTIMA página al tamaño
       real del contenido en vez de dejarla en tamaño carta completo — el
       pie de página quedaba más arriba que en las demás hojas. */
    table.mb-doc > tbody > tr > td.mb-contenido {
      height: 100%;
      vertical-align: top;
    }
    body { font-family: 'Arial Narrow', Arial, sans-serif; color: #000; font-size: 9.5pt; line-height: 1.4; }
    .ac-proyecto { margin-bottom: 0.3cm; }
    table.ac-info {
      width: 100%;
      border-collapse: collapse;
      border: 1pt solid #000;
      margin-bottom: 0.3cm;
    }
    table.ac-info td, table.ac-info th {
      border: 1pt solid #000;
      padding: 0.15cm 0.25cm;
      text-align: left;
      font-size: 9pt;
    }
    table.ac-info th { text-align: center; font-weight: bold; }
    .ac-info-label { font-weight: bold; width: 5.5cm; }
    .ac-calidad-op { display: inline-block; margin-right: 0.6cm; }
    .ac-check { font-weight: bold; margin-right: 3px; }
    .ac-h1 { font-weight: bold; margin: 0.35cm 0 0.15cm; font-size: 10.5pt; }
    .ac-h2 { font-weight: bold; margin: 0.3cm 0 0.1cm; font-size: 9.5pt; }
    p.ac-p { margin-bottom: 0.2cm; text-align: justify; }
    ol.ac-lista { margin: 0 0 0.2cm 0.6cm; padding: 0; }
    ol.ac-lista li { margin-bottom: 0.12cm; text-align: justify; }
    .ac-blank { text-decoration: underline; font-weight: bold; padding: 0 2px; }
    table.ac-firmas {
      width: 100%;
      border-collapse: collapse;
      border: 1pt solid #000;
      margin-top: 0.6cm;
    }
    table.ac-firmas td {
      border: 1pt solid #000;
      width: 50%;
      text-align: center;
      vertical-align: bottom;
      padding: 0.2cm;
    }
    .ac-firma-img { max-height: 2.2cm; max-width: 90%; margin-bottom: 0.15cm; }
    .ac-firma-label { font-weight: bold; font-size: 9pt; border-top: 1pt solid #000; padding-top: 0.1cm; }
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'acta_compromiso')}

  <p class="ac-proyecto"><strong>Proyecto:</strong> “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”.</p>

  <table class="ac-info">
    <tr><th colspan="2">INFORMACIÓN DEL BENEFICIARIO Y DEL PREDIO</th></tr>
    <tr><td class="ac-info-label">Nombre del beneficiario(a)</td><td>${nombre}</td></tr>
    <tr><td class="ac-info-label">Identificación</td><td>${cedula}</td></tr>
    <tr><td class="ac-info-label">Teléfono</td><td>${escapeHtml(datos.telefono) || '—'}</td></tr>
    <tr><td class="ac-info-label">Correo electrónico</td><td>${escapeHtml(datos.correo) || '—'}</td></tr>
    <tr><td class="ac-info-label">Vereda</td><td>${vereda}</td></tr>
    <tr><td class="ac-info-label">Corregimiento</td><td>${corregimiento}</td></tr>
    <tr><td class="ac-info-label">Predio</td><td>${predio}</td></tr>
    <tr>
      <td class="ac-info-label">Calidad respecto del predio</td>
      <td>
        <span class="ac-calidad-op">${marcaCalidad('propietario')}Propietario(a)</span>
        <span class="ac-calidad-op">${marcaCalidad('poseedor')}Poseedor(a)</span>
        <span class="ac-calidad-op">${marcaCalidad('otro')}Otro</span>
      </td>
    </tr>
  </table>

  <div class="ac-h1">1. Consideración</div>
  <p class="ac-p">El proyecto “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá” tiene como propósito el establecimiento y fortalecimiento de unidades productoras de cacao mediante sistemas de arreglo agroforestal, integrando clones mejorados de cacao de alto rendimiento, asociados con plátano como sombrío temporal y especies forestales como sombrío permanente, bajo criterios de sostenibilidad productiva y ambiental.</p>
  <p class="ac-p">En el marco de la ejecución del proyecto se contempla el desarrollo de un proceso integral de acompañamiento a los beneficiarios, que comprende, entre otras actividades, la realización de análisis de suelos, establecimiento y fortalecimiento de biofactorías para la producción de insumos orgánicos, aplicación de fertilización órgano-mineral de acuerdo con los requerimientos nutricionales del cultivo y los resultados de los análisis de suelo, manejo fitosanitario, suministro de herramientas, materiales e insumos, fortalecimiento de capacidades mediante jornadas de capacitación y Escuelas de Campo para Agricultores – ECA, así como asistencia técnica especializada durante el establecimiento y manejo de la unidad productora.</p>
  <p class="ac-p">En este contexto, el(la) señor(a) <span class="ac-blank">${nombre}</span>, identificado(a) con cédula de ciudadanía No. <span class="ac-blank">${cedula}</span>, en calidad de beneficiario(a) del proyecto y en relación con el predio denominado <span class="ac-blank">${predio}</span>, ubicado en la vereda <span class="ac-blank">${vereda}</span>, corregimiento <span class="ac-blank">${corregimiento}</span>, del municipio de Puerto Rico, Caquetá, manifiesta de manera <strong>libre, voluntaria y expresa</strong> su decisión de participar en el proyecto y se compromete a facilitar las condiciones necesarias para el adecuado desarrollo de las actividades técnicas, productivas, ambientales y de acompañamiento previstas.</p>
  <p class="ac-p">En consecuencia, mediante la suscripción de la presente acta, el(la) beneficiario(a) declara conocer las condiciones generales de participación y asume los compromisos relacionados con la implementación, cuidado, manejo y sostenibilidad de la unidad productora de cacao que sea establecida en el marco del proyecto.</p>

  <div class="ac-h1">2. Compromisos del Beneficiario</div>
  <p class="ac-p">Para garantizar el adecuado desarrollo de las actividades previstas, el(la) beneficiario(a) se compromete a:</p>

  <div class="ac-h2">2.1. Disponibilidad y participación</div>
  ${acListaHtml(AC_DISPONIBILIDAD)}
  <div class="ac-h2">2.2. Acreditación y disponibilidad del predio</div>
  ${acListaHtml(AC_ACREDITACION)}
  <div class="ac-h2">2.3. Uso y manejo de los elementos entregados</div>
  ${acListaHtml(AC_USO_MANEJO)}
  <div class="ac-h2">2.4. Compromisos técnicos y productivos</div>
  ${acListaHtml(AC_TECNICOS_PRODUCTIVOS)}
  <div class="ac-h2">2.5. Compromisos ambientales</div>
  ${acListaHtml(AC_AMBIENTALES)}
  <div class="ac-h2">2.6. Permanencia y sostenibilidad de la unidad productora</div>
  ${acListaHtml(AC_PERMANENCIA)}

  <div class="ac-h1">3. Compromisos de la Entidad Ejecutora</div>
  <p class="ac-p">En el marco de sus competencias y de las condiciones establecidas para la ejecución del proyecto, AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S. se compromete a:</p>
  ${acListaHtml(AC_ENTIDAD)}

  <div class="ac-h1">4. Vigencia</div>
  <p class="ac-p">La presente Acta de Compromiso tendrá vigencia durante la ejecución del proyecto y durante el periodo de seguimiento establecido para las unidades productoras de cacao, sin perjuicio de aquellos compromisos que, por su naturaleza, deban mantenerse con posterioridad a la finalización de las actividades de implementación.</p>
  <p class="ac-p">En constancia de lo anterior, se suscribe la presente Acta de Compromiso para la Implementación y Manejo Sostenible de Unidades Productoras de Cacao, en el municipio de Puerto Rico, departamento del Caquetá, a los <span class="ac-blank">${dia}</span> días del mes de <span class="ac-blank">${mes}</span> de <span class="ac-blank">${anio}</span>, previa lectura y aceptación de su contenido por quienes intervienen.</p>

  <table class="ac-firmas">
    <tr>
      <td>
        ${datos.firmaBeneficiario ? `<img class="ac-firma-img" src="${datos.firmaBeneficiario}" />` : '<div style="height:2.2cm"></div>'}
        <div class="ac-firma-label">Firma del Beneficiario</div>
      </td>
      <td>
        ${datos.firmaTecnico ? `<img class="ac-firma-img" src="${datos.firmaTecnico}" />` : '<div style="height:2.2cm"></div>'}
        <div class="ac-firma-label">Firma del Técnico de Campo</div>
      </td>
    </tr>
  </table>

  ${membreteCierreHtml()}
</body>
</html>`;
}

// ============================================================
// Estilos compartidos por los formatos cortos de "Otros Formatos"
// (autorizaciones y consentimiento) — recuadro de check, párrafos
// justificados y bloque de firma, reutilizados por los 3 generadores
// de abajo.
// ============================================================
const OF_ESTILOS_COMUNES = `
  html, body { height: 100%; }
  table.mb-doc { height: 100%; }
  table.mb-doc > tbody > tr > td.mb-contenido {
    height: 100%;
    vertical-align: top;
  }
  body { font-family: 'Arial Narrow', Arial, sans-serif; color: #000; font-size: 9.5pt; line-height: 1.4; }
  p.of-p { margin-bottom: 0.25cm; text-align: justify; }
  .of-h1 { font-weight: bold; margin: 0.3cm 0 0.15cm; font-size: 10pt; }
  .of-blank { text-decoration: underline; font-weight: bold; padding: 0 2px; }
  .of-check-row { display: flex; flex-wrap: wrap; gap: 0.5cm; margin: 0.2cm 0 0.3cm; }
  .of-check-item { display: flex; align-items: center; font-weight: bold; }
  .of-check-box {
    display: inline-block; width: 0.35cm; height: 0.35cm;
    border: 1pt solid #000; margin-right: 4px; text-align: center;
    line-height: 0.35cm; font-size: 8pt;
  }
  ol.of-lista { margin: 0 0 0.25cm 0.6cm; padding: 0; }
  ol.of-lista li { margin-bottom: 0.12cm; text-align: justify; }
  table.of-firma {
    width: 60%;
    border-collapse: collapse;
    margin-top: 0.6cm;
  }
  table.of-firma td { border-bottom: 1pt solid #000; padding: 0.15cm 0; font-size: 9pt; }
  .of-firma-img { max-height: 2cm; max-width: 6cm; display: block; margin-bottom: 0.1cm; }
`;

function ofCheck(marcado: boolean): string {
  return `<span class="of-check-box">${marcado ? '✓' : ''}</span>`;
}

// ============================================================
// Autorización Uso de Imagen (PA. 2 FO. 11)
// ============================================================

export interface DatosAutorizacionImagen {
  nombre: string;
  cedula: string;
  expedidaEn: string;
  telefono: string;
  autorizaFotos: boolean;
  autorizaAudios: boolean;
  autorizaVideos: boolean;
  autorizaOtros: boolean;
  firma: string;
}

export const generarPDFAutorizacionImagen = async (datos: DatosAutorizacionImagen): Promise<string | null> => {
  try {
    const html = construirHTMLAutorizacionImagen(datos);
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    const nombreBenef = (datos.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `AUTORIZACION-IMAGEN-${nombreBenef}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;
    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch {
      return uri;
    }
  } catch (error) {
    console.error('[PDF Autorización Imagen] Error:', error);
    return null;
  }
};

function construirHTMLAutorizacionImagen(datos: DatosAutorizacionImagen): string {
  const nombre = escapeHtml(datos.nombre) || '—';
  const cedula = escapeHtml(datos.cedula) || '—';
  const expedidaEn = escapeHtml(datos.expedidaEn) || '—';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Autorización Uso de Imagen</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    ${OF_ESTILOS_COMUNES}
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'autorizacion_imagen')}

  <p class="of-p"><strong>Proyecto:</strong> “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”.</p>

  <div class="of-h1">Autorización para el uso de imagen, voz y datos personales con fines institucionales y de divulgación del proyecto:</div>
  <p class="of-p"><span class="of-blank">${nombre}</span>, identificado(a) con cédula de ciudadanía No. <span class="of-blank">${cedula}</span> expedida en <span class="of-blank">${expedidaEn}</span>, en calidad de beneficiario(a) del proyecto antes mencionado, actuando de manera libre, voluntaria, previa, expresa e informada, de conformidad con lo dispuesto en la Ley 1581 de 2012, el Decreto 1074 de 2015 y las demás normas que regulan la protección de datos personales, mediante el presente escrito, autorizo a <strong>AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S.</strong>, como contratista ejecutor del proyecto, así como a <strong>E-DESARROLLO</strong>, y a las demás entidades que participen en su ejecución, para recolectar y divulgar:</p>

  <div class="of-check-row">
    <span class="of-check-item">${ofCheck(datos.autorizaFotos)}Fotos</span>
    <span class="of-check-item">${ofCheck(datos.autorizaAudios)}Audios</span>
    <span class="of-check-item">${ofCheck(datos.autorizaVideos)}Videos</span>
    <span class="of-check-item">${ofCheck(datos.autorizaOtros)}Otros datos personales</span>
  </div>

  <div class="of-h1">La presente autorización comprende y tiene como finalidad:</div>
  <ol class="of-lista">
    <li>Autorizar a AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S., en calidad de contratista ejecutor del proyecto, así como a E-DESARROLLO y a las entidades que participen en la ejecución, supervisión o interventoría del proyecto, para captar, registrar, almacenar, editar, reproducir, utilizar y conservar fotografías, imágenes, videos, audios, testimonios y demás registros audiovisuales obtenidos durante el desarrollo de las actividades relacionadas con el proyecto.</li>
    <li>Autorizar la utilización, reproducción, publicación, comunicación, difusión y divulgación del material anteriormente descrito a través de cualquier medio físico, impreso, audiovisual, electrónico, digital o virtual, existente o que llegue a existir, incluyendo, entre otros, informes técnicos, administrativos y de supervisión, páginas web institucionales, redes sociales, boletines, cartillas, material pedagógico, piezas gráficas, presentaciones institucionales, publicaciones impresas o digitales, pendones, vallas informativas, material publicitario, campañas institucionales, eventos de socialización, rendición de cuentas y demás estrategias de comunicación y divulgación desarrolladas en el marco del proyecto.</li>
    <li>Autorizar que el material obtenido sea utilizado exclusivamente con fines institucionales, técnicos, informativos, educativos, académicos, de seguimiento, supervisión, interventoría, promoción, divulgación y visibilización de las actividades, avances, resultados, impactos y buenas prácticas derivadas de la ejecución del proyecto.</li>
  </ol>

  <div class="of-h1">Declaraciones:</div>
  <p class="of-p">Declaro que esta autorización se otorga de manera libre, voluntaria y sin generar contraprestación económica alguna por el uso autorizado de mi imagen, voz o registros audiovisuales. Así mismo, manifiesto que conozco mis derechos como titular de los datos personales, especialmente los de conocer, actualizar, rectificar, solicitar la supresión de mis datos y revocar la presente autorización cuando sea legalmente procedente, a través de los canales dispuestos por el responsable del tratamiento de la información.</p>

  <p class="of-p">Atentamente,</p>

  <table class="of-firma">
    <tr><td>${datos.firma ? `<img class="of-firma-img" src="${datos.firma}" />` : ''}Nombre: ${nombre}</td></tr>
    <tr><td>C.C. No. ${cedula}</td></tr>
    <tr><td>Teléfono: ${escapeHtml(datos.telefono) || '—'}</td></tr>
  </table>

  ${membreteCierreHtml()}
</body>
</html>`;
}

// ============================================================
// Autorización Uso de Imagen — Menores de Edad (PA. 2 FO. 11)
// ============================================================

export interface DatosAutorizacionImagenMenor {
  nombreRepresentante: string;
  cedulaRepresentante: string;
  expedidaEn: string;
  documentoMenor: string;
  calidad: 'padre' | 'madre' | 'representante';
  telefono: string;
  autorizaFotos: boolean;
  autorizaAudios: boolean;
  autorizaVideos: boolean;
  autorizaOtros: boolean;
  firma: string;
}

export const generarPDFAutorizacionImagenMenor = async (datos: DatosAutorizacionImagenMenor): Promise<string | null> => {
  try {
    const html = construirHTMLAutorizacionImagenMenor(datos);
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    const nombreRep = (datos.nombreRepresentante || 'representante').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `AUTORIZACION-IMAGEN-MENOR-${nombreRep}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;
    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch {
      return uri;
    }
  } catch (error) {
    console.error('[PDF Autorización Imagen Menor] Error:', error);
    return null;
  }
};

function construirHTMLAutorizacionImagenMenor(datos: DatosAutorizacionImagenMenor): string {
  const nombre = escapeHtml(datos.nombreRepresentante) || '—';
  const cedula = escapeHtml(datos.cedulaRepresentante) || '—';
  const expedidaEn = escapeHtml(datos.expedidaEn) || '—';
  const documentoMenor = escapeHtml(datos.documentoMenor) || '—';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Autorización Uso de Imagen — Menor de Edad</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    ${OF_ESTILOS_COMUNES}
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'autorizacion_imagen_menor')}

  <p class="of-p"><strong>Proyecto:</strong> “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”.</p>

  <div class="of-h1">Autorización para el uso de imagen, voz y datos personales de menor de edad con fines institucionales y de divulgación del proyecto:</div>
  <p class="of-p"><span class="of-blank">${nombre}</span>, identificado(a) con cédula de ciudadanía No. <span class="of-blank">${cedula}</span> expedida en <span class="of-blank">${expedidaEn}</span>, actuando en calidad de padre, madre o representante legal del menor de edad identificado(a) con el documento de identidad No. <span class="of-blank">${documentoMenor}</span>, obrando de manera libre, voluntaria, previa, expresa e informada, de conformidad con lo dispuesto en la Ley 1581 de 2012, el Decreto 1074 de 2015 y las demás normas que regulan la protección de datos personales, mediante el presente escrito, autorizo a <strong>AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S.</strong>, como contratista ejecutor del proyecto, así como a <strong>E-DESARROLLO</strong>, y a las demás entidades que participen en su ejecución, para recolectar y divulgar los siguientes registros del menor:</p>

  <div class="of-check-row">
    <span class="of-check-item">${ofCheck(datos.autorizaFotos)}Fotos</span>
    <span class="of-check-item">${ofCheck(datos.autorizaAudios)}Audios</span>
    <span class="of-check-item">${ofCheck(datos.autorizaVideos)}Videos</span>
    <span class="of-check-item">${ofCheck(datos.autorizaOtros)}Otros datos personales</span>
  </div>

  <div class="of-h1">La presente autorización comprende y tiene como finalidad:</div>
  <ol class="of-lista">
    <li>Autorizar la captura, registro, almacenamiento, edición, reproducción, conservación y utilización de fotografías, imágenes, audios, videos, testimonios y demás registros audiovisuales obtenidos durante el desarrollo de las actividades del proyecto en las que participe el menor de edad.</li>
    <li>Autorizar la utilización, reproducción, publicación, comunicación, difusión y divulgación del material anteriormente descrito a través de medios físicos, impresos, audiovisuales, electrónicos, digitales o virtuales, incluyendo, entre otros, informes técnicos, administrativos y de supervisión, páginas web institucionales, redes sociales, boletines, cartillas, material pedagógico, piezas gráficas, presentaciones institucionales, publicaciones impresas o digitales, pendones, vallas informativas, campañas institucionales, eventos de socialización, rendición de cuentas y demás estrategias de divulgación desarrolladas en el marco del proyecto.</li>
    <li>Autorizar que el material sea utilizado exclusivamente con fines institucionales, técnicos, educativos, informativos, académicos, de seguimiento, supervisión, interventoría, promoción y divulgación de las actividades, avances, resultados e impactos del proyecto, garantizando en todo momento el respeto por la dignidad, la intimidad, la honra, la imagen y los derechos fundamentales del menor de edad, así como la observancia de su interés superior.</li>
  </ol>

  <div class="of-h1">Declaraciones:</div>
  <p class="of-p">Declaro que esta autorización se otorga de manera libre, voluntaria y sin generar contraprestación económica alguna por el uso autorizado de mi imagen, voz o registros audiovisuales. Así mismo, manifiesto que conozco mis derechos como titular de los datos personales, especialmente los de conocer, actualizar, rectificar, solicitar la supresión de mis datos y revocar la presente autorización cuando sea legalmente procedente, a través de los canales dispuestos por el responsable del tratamiento de la información.</p>

  <p class="of-p">Atentamente,</p>

  <table class="of-firma">
    <tr><td>${datos.firma ? `<img class="of-firma-img" src="${datos.firma}" />` : ''}Nombre: ${nombre}</td></tr>
    <tr><td>Calidad: ${datos.calidad === 'padre' ? 'Padre' : datos.calidad === 'madre' ? 'Madre' : 'Representante legal'}</td></tr>
    <tr><td>C.C. No. ${cedula}</td></tr>
    <tr><td>Teléfono: ${escapeHtml(datos.telefono) || '—'}</td></tr>
  </table>

  ${membreteCierreHtml()}
</body>
</html>`;
}

// ============================================================
// Consentimiento Informado y Tratamiento de Datos (PA. 2 FO. 32)
// ============================================================

export interface DatosConsentimientoDatos {
  nombre: string;
  cedula: string;
  expedidaEn: string;
  autorizaIdentificacion: boolean;
  autorizaPredio: boolean;
  autorizaTecnica: boolean;
  autorizaAsistencia: boolean;
  fecha: string;
  firma: string;
}

export const AC_FINALIDADES_TRATAMIENTO = [
  'Realizar la identificación, caracterización, vinculación y seguimiento de los beneficiarios del proyecto.',
  'Adelantar las actividades de diagnóstico, georreferenciación, asistencia técnica, seguimiento productivo y verificación de las unidades productoras de cacao.',
  'Elaborar, consolidar y conservar las bases de datos, registros, informes, actas, matrices y demás documentos requeridos para la ejecución y seguimiento del proyecto.',
  'Acreditar ante las entidades competentes, la supervisión y la interventoría el cumplimiento de las actividades, metas, productos e indicadores establecidos para el proyecto.',
  'Realizar actividades de monitoreo, seguimiento, evaluación, supervisión, interventoría, control y cierre del proyecto.',
  'Contactarme para efectos relacionados con la programación de visitas, asistencia técnica, capacitaciones, jornadas de campo, entrega de insumos y demás actividades propias del proyecto.',
  'Atender requerimientos de información formulados por las entidades que tengan competencia sobre la ejecución, supervisión, interventoría, financiación o control del proyecto.',
  'Conservar la información y los soportes documentales que acrediten mi participación como beneficiario(a), durante los términos que resulten aplicables.',
  'Elaborar informes, piezas institucionales y material de divulgación, socialización y visibilización de los avances, resultados e impactos del proyecto, cuando para ello se cuente con la autorización correspondiente.',
];

export const generarPDFConsentimientoDatos = async (datos: DatosConsentimientoDatos): Promise<string | null> => {
  try {
    const html = construirHTMLConsentimientoDatos(datos);
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    const nombreBenef = (datos.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date(datos.fecha || Date.now()).toISOString().split('T')[0];
    const pdfName = `CONSENTIMIENTO-DATOS-${nombreBenef}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;
    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch {
      return uri;
    }
  } catch (error) {
    console.error('[PDF Consentimiento Datos] Error:', error);
    return null;
  }
};

function construirHTMLConsentimientoDatos(datos: DatosConsentimientoDatos): string {
  const nombre = escapeHtml(datos.nombre) || '—';
  const cedula = escapeHtml(datos.cedula) || '—';
  const expedidaEn = escapeHtml(datos.expedidaEn) || '—';

  const fecha = datos.fecha ? new Date(datos.fecha) : new Date();
  const dia = fecha.getDate();
  const mes = AC_MESES[fecha.getMonth()];
  const anio = fecha.getFullYear();

  const filaTipo = (marcado: boolean, texto: string) => `
    <tr><td>${escapeHtml(texto)}</td><td style="text-align:center">${ofCheck(marcado)}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Consentimiento Informado y Tratamiento de Datos</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    ${OF_ESTILOS_COMUNES}
    table.of-tipos { width: 100%; border-collapse: collapse; margin: 0.2cm 0 0.3cm; }
    table.of-tipos th, table.of-tipos td { border: 1pt solid #000; padding: 0.15cm 0.25cm; font-size: 9pt; text-align: left; }
    table.of-tipos th { text-align: center; font-weight: bold; }
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'consentimiento_datos')}

  <p class="of-p"><strong>Proyecto:</strong> “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”.</p>

  <div class="of-h1">1. Consentimiento Informado para la Participación en el Proyecto</div>
  <p class="of-p"><span class="of-blank">${nombre}</span>, identificado(a) con cédula de ciudadanía No. <span class="of-blank">${cedula}</span>, expedida en <span class="of-blank">${expedidaEn}</span>, actuando de manera libre, voluntaria, consciente y previamente informada, manifiesto que he recibido información clara, suficiente y comprensible sobre el proyecto “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”, así como sobre sus objetivos, actividades, condiciones generales de participación y compromisos asociados a mi vinculación como beneficiario(a).</p>
  <p class="of-p">El proyecto tiene como propósito el establecimiento y fortalecimiento de unidades productoras de cacao mediante sistemas de arreglo agroforestal, integrando clones mejorados de cacao de alto rendimiento, asociados con plátano como sombrío temporal y especies forestales como sombrío permanente, bajo criterios de sostenibilidad productiva y ambiental.</p>
  <p class="of-p">Así mismo, se me ha informado que, en desarrollo del proyecto, podrán realizarse actividades tales como diagnóstico técnico y social del predio, georreferenciación, análisis y toma de muestras de suelo, establecimiento y fortalecimiento de biofactorías, fertilización órgano-mineral, manejo fitosanitario, suministro de herramientas, materiales e insumos, asistencia técnica, capacitación y Escuelas de Campo para Agricultores – ECA, entre otras actividades previstas para la implementación y manejo de la unidad productora.</p>
  <p class="of-p">En consecuencia, manifiesto que comprendo la naturaleza y finalidad de las actividades que serán desarrolladas en mi predio y acepto participar voluntariamente en el proyecto, comprometiéndome a facilitar el acceso al predio, proporcionar la información requerida y participar en las actividades técnicas, productivas, ambientales y de acompañamiento que correspondan.</p>

  <div class="of-h1">2. Autorización para el Tratamiento de Datos Personales</div>
  <p class="of-p">En mi calidad de titular de los datos personales y beneficiario(a) del proyecto, autorizo de manera previa, expresa, libre, voluntaria e informada a AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S., en su calidad de entidad ejecutora del proyecto, así como, cuando resulte procedente dentro del marco de sus competencias, a E-DESARROLLO y a las demás entidades que intervengan en su ejecución, supervisión o interventoría, para realizar el tratamiento de los datos personales que sean suministrados con ocasión de mi participación en el proyecto.</p>
  <p class="of-p">La autorización comprende la recolección, almacenamiento, organización, conservación, consulta, actualización, uso, circulación y demás operaciones necesarias sobre mis datos personales, de conformidad con las finalidades propias de la ejecución, seguimiento, supervisión, interventoría, evaluación, control y cierre del proyecto. Los datos que podrán ser tratados comprenden, entre otros:</p>

  <table class="of-tipos">
    <tr><th>Tipo de información</th><th>Autorizo</th></tr>
    ${filaTipo(datos.autorizaIdentificacion, 'Datos de identificación y contacto')}
    ${filaTipo(datos.autorizaPredio, 'Información relacionada con el predio objeto de intervención')}
    ${filaTipo(datos.autorizaTecnica, 'Información técnica y productiva relacionada con la unidad productora')}
    ${filaTipo(datos.autorizaAsistencia, 'Registros de asistencia y participación en actividades del proyecto')}
  </table>

  <div class="of-h1">3. Finalidades del Tratamiento de los Datos</div>
  <p class="of-p">La información suministrada podrá ser utilizada para las siguientes finalidades:</p>
  <ol class="of-lista">
    ${AC_FINALIDADES_TRATAMIENTO.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
  </ol>
  <p class="of-p">La autorización para el tratamiento de los datos personales permanecerá vigente durante el tiempo que resulte necesario para cumplir las finalidades relacionadas con la ejecución, seguimiento, supervisión, interventoría, evaluación, control, cierre y conservación documental del proyecto, de acuerdo con las obligaciones legales y contractuales aplicables.</p>

  <p class="of-p">En constancia de lo anterior, manifiesto que he leído, comprendido y aceptado el contenido del presente Consentimiento Informado y Autorización para el Tratamiento de Datos Personales, y que otorgo mi consentimiento de manera libre, voluntaria, previa, expresa e informada, en el municipio de Puerto Rico, departamento del Caquetá, a los <span class="of-blank">${dia}</span> días del mes de <span class="of-blank">${mes}</span> de <span class="of-blank">${anio}</span>, dejando constancia de mi aceptación de las condiciones y autorizaciones aquí establecidas.</p>

  <table class="of-firma">
    <tr><td>${datos.firma ? `<img class="of-firma-img" src="${datos.firma}" />` : ''}Firma del Beneficiario</td></tr>
    <tr><td>C.C. No. ${cedula}</td></tr>
  </table>

  ${membreteCierreHtml()}
</body>
</html>`;
}

// ============================================================
// Evaluación de Escuela de Campo para Agricultores — ECA 1 (PA. 2 FO. 33)
// Encuesta sin firma: se aplica antes/después de cada jornada.
// ============================================================

export type EcaOpcionABC = 'A' | 'B' | 'C';
export type EcaLikert = 'muy_buena' | 'buena' | 'regular' | 'mala';

export interface DatosEvaluacionEca {
  nombre: string;
  identificacion: string;
  vereda: string;
  predio: string;
  respuestasTecnicas: Record<string, EcaOpcionABC | null>;
  respuestasJornada: Record<string, EcaLikert | null>;
  temaMasUtil: string;
  temaMasUtilOtro: string;
  puedeAplicar: 'si' | 'parcial' | 'no' | null;
  temaReforzar: string;
  volveriaParticipar: 'si' | 'no' | 'tal_vez' | null;
  temaProximaEca: string;
  sugerencias: string;
}

export const ECA_PREGUNTAS_TECNICAS: { key: string; titulo: string; pregunta: string; opciones: string[] }[] = [
  {
    key: 'muestreo_suelos',
    titulo: '1.1. Muestreo de suelos',
    pregunta: '¿Cuál es la forma adecuada para realizar el recorrido y tomar las submuestras de suelo?',
    opciones: [
      'En línea recta por el camino de la finca.',
      'En zigzag o en “X”, tomando muestras de diferentes puntos homogéneos del lote.',
      'Únicamente en los lugares donde se acumula agua.',
    ],
  },
  {
    key: 'distancia_siembra',
    titulo: '1.2. Distancia de siembra',
    pregunta: '¿Cuál es la distancia establecida para la siembra del cacao en el arreglo agroforestal?',
    opciones: ['2,0 m × 2,0 m.', '3,5 m × 3,5 m.', '5,0 m × 5,0 m.'],
  },
  {
    key: 'preparacion_terreno',
    titulo: '1.3. Preparación del terreno',
    pregunta: '¿Cuáles son las dimensiones recomendadas para el hoyo de siembra del cacao?',
    opciones: ['20 cm × 20 cm × 20 cm.', '40 cm × 40 cm × 40 cm.', '60 cm × 60 cm × 60 cm.'],
  },
  {
    key: 'manejo_insumos',
    titulo: '1.4. Manejo de insumos',
    pregunta: '¿Qué indica el color de la franja de seguridad en los envases de agroquímicos?',
    opciones: [
      'La marca comercial del producto.',
      'El nivel de peligrosidad y las precauciones para su manejo.',
      'La fecha de vencimiento del producto.',
    ],
  },
  {
    key: 'siembra_platano',
    titulo: '1.5. Siembra del plátano',
    pregunta: 'Antes de sembrar el colino de plátano como sombrío temporal se debe:',
    opciones: [
      'Sembrar directamente sin ningún tratamiento.',
      'Realizar el manejo y desinfección correspondiente del material de siembra.',
      'Lavarlo únicamente con agua.',
    ],
  },
];

export const ECA_PREGUNTAS_JORNADA: { key: string; texto: string }[] = [
  { key: 'objetivos', texto: '¿Se cumplieron los objetivos de la jornada?' },
  { key: 'temas_claros', texto: '¿Los temas fueron claros y fáciles de entender?' },
  { key: 'practica_util', texto: '¿La práctica de campo fue útil?' },
  { key: 'aplicable_finca', texto: '¿Los conocimientos aprendidos son aplicables en su finca?' },
  { key: 'explicacion_tecnico', texto: '¿La explicación del técnico fue clara?' },
  { key: 'tiempo_adecuado', texto: '¿El tiempo destinado a la jornada fue adecuado?' },
  { key: 'calificacion_general', texto: '¿Cómo califica en general la ECA?' },
];

export const ECA_TEMAS_UTILES = [
  'Buenas Prácticas Agrícolas – BPA',
  'Preparación del terreno',
  'Muestreo de suelos',
  'Siembra del cacao',
  'Manejo del sombrío',
  'Manejo de insumos',
];

const ECA_LIKERT_LABELS: Record<EcaLikert, string> = {
  muy_buena: 'Muy buena', buena: 'Buena', regular: 'Regular', mala: 'Mala',
};

export const generarPDFEvaluacionEca = async (datos: DatosEvaluacionEca): Promise<string | null> => {
  try {
    const html = construirHTMLEvaluacionEca(datos);
    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    const nombreBenef = (datos.nombre || 'beneficiario').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_');
    const fechaStr = new Date().toISOString().split('T')[0];
    const pdfName = `EVALUACION-ECA1-${nombreBenef}-${fechaStr}.pdf`;
    const pdfDir = uri.substring(0, uri.lastIndexOf('/'));
    const pdfPath = `${pdfDir}/${pdfName}`;
    try {
      await FileSystem.moveAsync({ from: uri, to: pdfPath });
      return pdfPath;
    } catch {
      return uri;
    }
  } catch (error) {
    console.error('[PDF Evaluación ECA] Error:', error);
    return null;
  }
};

function construirHTMLEvaluacionEca(datos: DatosEvaluacionEca): string {
  const nombre = escapeHtml(datos.nombre) || '—';

  const preguntasTecnicasHtml = ECA_PREGUNTAS_TECNICAS.map((p) => {
    const marcada = datos.respuestasTecnicas[p.key];
    const letras: EcaOpcionABC[] = ['A', 'B', 'C'];
    return `
    <div class="eca-pregunta">
      <div class="eca-pregunta-titulo">${p.titulo}</div>
      <div class="eca-pregunta-texto">${escapeHtml(p.pregunta)}</div>
      ${p.opciones.map((op, i) => `
        <div class="eca-opcion">${ofCheck(marcada === letras[i])} ${letras[i]}. ${escapeHtml(op)}</div>
      `).join('')}
    </div>`;
  }).join('');

  const jornadaFilasHtml = ECA_PREGUNTAS_JORNADA.map((p) => {
    const marcada = datos.respuestasJornada[p.key];
    return `
    <tr>
      <td>${escapeHtml(p.texto)}</td>
      <td style="text-align:center">${ofCheck(marcada === 'muy_buena')}</td>
      <td style="text-align:center">${ofCheck(marcada === 'buena')}</td>
      <td style="text-align:center">${ofCheck(marcada === 'regular')}</td>
      <td style="text-align:center">${ofCheck(marcada === 'mala')}</td>
    </tr>`;
  }).join('');

  const temasUtilesHtml = ECA_TEMAS_UTILES.map((t) => `
    <div class="eca-opcion">${ofCheck(datos.temaMasUtil === t)} ${escapeHtml(t)}</div>
  `).join('') + `
    <div class="eca-opcion">${ofCheck(datos.temaMasUtil === 'otro')} Otro: <span class="of-blank">${escapeHtml(datos.temaMasUtilOtro) || (datos.temaMasUtil === 'otro' ? '' : '—')}</span></div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Evaluación ECA 1</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    ${OF_ESTILOS_COMUNES}
    table.eca-info { width: 100%; border-collapse: collapse; border: 1pt solid #000; margin-bottom: 0.3cm; }
    table.eca-info td { border: 1pt solid #000; padding: 0.15cm 0.25cm; font-size: 9pt; }
    .eca-info-label { font-weight: bold; width: 5cm; }
    .eca-pregunta { margin-bottom: 0.3cm; break-inside: avoid; }
    .eca-pregunta-titulo { font-weight: bold; font-size: 9.5pt; }
    .eca-pregunta-texto { margin: 0.1cm 0; }
    .eca-opcion { margin-left: 0.3cm; margin-bottom: 0.08cm; }
    table.eca-jornada { width: 100%; border-collapse: collapse; margin: 0.2cm 0 0.3cm; }
    table.eca-jornada th, table.eca-jornada td { border: 1pt solid #000; padding: 0.12cm 0.2cm; font-size: 8.5pt; }
    table.eca-jornada th { text-align: center; font-weight: bold; }
    .eca-texto-libre { border-bottom: 1pt solid #000; min-height: 0.5cm; margin-bottom: 0.15cm; }
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'evaluacion_eca')}

  <p class="of-p"><strong>Proyecto:</strong> “Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá”.</p>

  <div class="of-h1">Objetivo de la evaluación</div>
  <p class="of-p">Conocer y valorar el nivel de comprensión y apropiación de los conocimientos impartidos durante la Escuela de Campo para Agricultores – ECA, verificando qué tanto de la información técnica suministrada fue comprendida y asimilada por los participantes, así como su percepción sobre la utilidad y pertinencia de los temas y actividades desarrolladas y su capacidad para aplicar los conocimientos adquiridos en sus unidades productoras de cacao.</p>

  <table class="eca-info">
    <tr><td class="eca-info-label">Nombre del beneficiario</td><td>${nombre}</td></tr>
    <tr><td class="eca-info-label">Identificación</td><td>${escapeHtml(datos.identificacion) || '—'}</td></tr>
    <tr><td class="eca-info-label">Vereda</td><td>${escapeHtml(datos.vereda) || '—'}</td></tr>
    <tr><td class="eca-info-label">Predio</td><td>${escapeHtml(datos.predio) || '—'}</td></tr>
  </table>

  <div class="of-h1">1. Evaluación de Conocimientos Técnicos</div>
  <p class="of-p">Marque con una X la respuesta que considere correcta.</p>
  ${preguntasTecnicasHtml}

  <div class="of-h1">2. Evaluación de la Jornada</div>
  <p class="of-p">Marque con una X la opción que mejor represente su opinión.</p>
  <table class="eca-jornada">
    <tr><th>Aspecto evaluado</th><th>Muy buena</th><th>Buena</th><th>Regular</th><th>Mala</th></tr>
    ${jornadaFilasHtml}
  </table>

  <div class="of-h1">3. Aprendizaje y Aplicación</div>
  <p class="of-p">¿Qué tema considera que fue más útil para su finca?</p>
  ${temasUtilesHtml}

  <p class="of-p" style="margin-top:0.25cm">¿Considera que puede aplicar lo aprendido en su finca?</p>
  <div class="eca-opcion">${ofCheck(datos.puedeAplicar === 'si')} Sí</div>
  <div class="eca-opcion">${ofCheck(datos.puedeAplicar === 'parcial')} Parcialmente</div>
  <div class="eca-opcion">${ofCheck(datos.puedeAplicar === 'no')} No</div>

  <p class="of-p" style="margin-top:0.25cm">¿Qué tema le gustaría reforzar en próximas jornadas?</p>
  <div class="eca-texto-libre">${escapeHtml(datos.temaReforzar)}</div>

  <div class="of-h1">4. Participación y Continuidad</div>
  <p class="of-p">¿Volvería a participar en otra Escuela de Campo?</p>
  <div class="eca-opcion">${ofCheck(datos.volveriaParticipar === 'si')} Sí &nbsp;&nbsp; ${ofCheck(datos.volveriaParticipar === 'no')} No &nbsp;&nbsp; ${ofCheck(datos.volveriaParticipar === 'tal_vez')} Tal vez</div>

  <p class="of-p" style="margin-top:0.25cm">¿Qué tema le gustaría que se abordara en la próxima ECA?</p>
  <div class="eca-texto-libre">${escapeHtml(datos.temaProximaEca)}</div>

  <p class="of-p">Sugerencias para mejorar las próximas jornadas:</p>
  <div class="eca-texto-libre">${escapeHtml(datos.sugerencias)}</div>

  ${membreteCierreHtml()}
</body>
</html>`;
}

/**
 * Convertir array de fotos a bloques HTML con imágenes embebidas en base64
 * Las fotos se redimensionan a 800px para que el PDF no se sature
 */
export async function convertirFotosAHTML(fotos: FotoGeotag[]): Promise<string> {
  if (!fotos || fotos.length === 0) {
    return '<p class="no-data">No se capturaron fotografías</p>';
  }

  const bloques: string[] = [];

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    // Saltar videos (solo procesar imágenes fijas para el PDF)
    const ext = foto.uri?.toLowerCase();
    if (ext?.endsWith('.mp4') || ext?.endsWith('.mov') || ext?.endsWith('.avi') || ext?.endsWith('.mkv') || foto.tipo === 'video') {
      bloques.push(`
        <div class="foto-item">
          <p class="evidencia-label">🎥 Video ${i + 1}</p>
          <p class="no-data">Video capturado — no disponible en PDF. Consulte la aplicación para reproducirlo.</p>
        </div>
      `);
      continue;
    }
    // Si la evidencia es de OTRO dispositivo, resolverEvidenciasRemotas ya la
    // dejó como URL del servidor (http/https) en vez de file://. Esa URL
    // exige el token de autenticación, que expo-image-manipulator no puede
    // adjuntar por su cuenta — hay que descargarla primero. Se hace fuera
    // del try principal para que el fallback de abajo también pueda usar la
    // copia ya descargada en vez de reintentar contra la URL remota.
    //
    // En web no existe FileSystem.cacheDirectory/downloadAsync (son del
    // dispositivo) — y expo-image-manipulator ahí carga la imagen con un
    // <img> plano (ver loadImageAsync en expo-image-manipulator/web), que
    // tampoco puede mandar la cabecera Authorization. Por eso se descarga
    // con `fetch` (sí acepta cabeceras) y se pasa como blob: URL — esa sí
    // la puede leer un <img> sin problema de autenticación ni de CORS.
    let uriParaProcesar = foto.uri;
    let blobRemotoWeb: Blob | null = null;
    let blobUrlTemporal: string | null = null;
    if (foto.uri.startsWith('http')) {
      try {
        const headers = await cabecerasDeArchivo();
        if (Platform.OS === 'web') {
          const respuesta = await fetch(foto.uri, { headers });
          if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
          blobRemotoWeb = await respuesta.blob();
          blobUrlTemporal = URL.createObjectURL(blobRemotoWeb);
          uriParaProcesar = blobUrlTemporal;
        } else {
          const destino = `${FileSystem.cacheDirectory}pdf_evidencia_${foto.id}.jpg`;
          const descarga = await FileSystem.downloadAsync(foto.uri, destino, { headers });
          uriParaProcesar = descarga.uri;
        }
      } catch (descargaErr) {
        console.warn('[PDF Local] No se pudo descargar evidencia remota', foto.id, descargaErr);
      }
    }

    try {
      try {
        // Leer la foto a máxima calidad — el espacio no es problema
        // Se redimensiona solo a 1200px para evitar PDFs monstruosos,
        // pero con calidad 0.9 para mantener nitidez
        const resultado = await manipulateAsync(
          uriParaProcesar,
          [{ resize: { width: 1200 } }],
          { compress: 0.9, format: SaveFormat.JPEG, base64: true }
        );

        if (!resultado.base64) {
          throw new Error('No se obtuvo base64 de la imagen redimensionada');
        }

        const dataUri = `data:image/jpeg;base64,${resultado.base64}`;

        const coords = formatCoordenadas(foto.coordenadas.latitud, foto.coordenadas.longitud, 4);
        const fecha = formatFecha(foto.timestamp);

        bloques.push(`
          <div class="foto-item">
            <p class="evidencia-label">📸 Foto ${i + 1} — ${fecha}</p>
            <img src="${dataUri}" alt="Foto ${i + 1}" class="foto-img" />
            <p class="foto-coords">📍 ${coords}</p>
            ${foto.coordenadas.heading !== undefined ? `<p class="foto-heading">🧭 Rumbo: ${Math.round(foto.coordenadas.heading)}°</p>` : ''}
          </div>
        `);
      } catch (e) {
        console.warn('[PDF Local] Error al procesar foto', foto.id, e);
        // Fallback: usar la foto sin redimensionar (reutiliza el blob ya
        // descargado en web, o la copia ya descargada en nativo)
        try {
          const dataUri =
            Platform.OS === 'web' && blobRemotoWeb
              ? await new Promise<string>((resolve, reject) => {
                  const lector = new FileReader();
                  lector.onload = () => resolve(lector.result as string);
                  lector.onerror = () => reject(lector.error);
                  lector.readAsDataURL(blobRemotoWeb!);
                })
              : `data:image/jpeg;base64,${await FileSystem.readAsStringAsync(uriParaProcesar, {
                  encoding: FileSystem.EncodingType.Base64,
                })}`;
          const coords = formatCoordenadas(foto.coordenadas.latitud, foto.coordenadas.longitud, 4);
          const fecha = formatFecha(foto.timestamp);
          bloques.push(`
            <div class="foto-item">
              <p class="evidencia-label">📸 Foto ${i + 1} — ${fecha}</p>
              <img src="${dataUri}" alt="Foto ${i + 1}" class="foto-img" />
              <p class="foto-coords">📍 ${coords}</p>
            </div>
          `);
        } catch (e2) {
          console.warn('[PDF Local] Fallback también falló para foto', foto.id, e2);
          bloques.push(`
            <div class="foto-item">
              <p class="evidencia-label">📸 Foto ${i + 1}</p>
              <p class="no-data">No se pudo incrustar la imagen</p>
            </div>
          `);
        }
      }
    } finally {
      if (blobUrlTemporal) URL.revokeObjectURL(blobUrlTemporal);
    }
  }

  return bloques.join('\n');
}

/**
 * Generar el sello de verificación biométrica.
 * Crea un bloque visual profesional con gráfico de huella (SVG inline),
 * nombre del beneficiario, fecha y sello VERIFICADO.
 */
export function generarSelloBiometrico(nombreBeneficiario: string): string {
  // SVG de huella dactilar como data URI usando encodeURIComponent
  const svgHuella = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<circle cx="50" cy="38" r="18" fill="none" stroke="#1B5E20" stroke-width="2.5"/>',
    '<path d="M32 58 Q28 72 50 80 Q72 72 68 58" fill="none" stroke="#1B5E20" stroke-width="2.5"/>',
    '<path d="M28 38 Q18 24 30 14" fill="none" stroke="#1B5E20" stroke-width="2"/>',
    '<path d="M72 38 Q82 24 70 14" fill="none" stroke="#1B5E20" stroke-width="2"/>',
    '<path d="M50 12 L50 4" fill="none" stroke="#1B5E20" stroke-width="2"/>',
    '<path d="M38 20 Q25 20 22 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/>',
    '<path d="M62 20 Q75 20 78 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/>',
    '<path d="M50 56 L50 74" fill="none" stroke="#1B5E20" stroke-width="2"/>',
    '<path d="M38 50 Q30 58 35 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/>',
    '<path d="M62 50 Q70 58 65 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/>',
    '</svg>',
  ].join('\n');

  const huellaDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgHuella)}`;
  const fechaHoy = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `
    <div class="huella-sello">
      <div class="huella-sello-inner">
        <div class="huella-sello-header">
          <img src="${huellaDataUri}" alt="Huella" class="huella-sello-img" />
          <div class="huella-sello-titles">
            <div class="huella-sello-verificado">✅ VERIFICADO</div>
            <div class="huella-sello-label">Certificación biométrica del técnico</div>
          </div>
        </div>
        <div class="huella-sello-body">
          <table class="huella-sello-table">
            <tr><td class="huella-sello-label-cell">Visita a:</td><td class="huella-sello-value-cell"><strong>${escapeHtml(nombreBeneficiario)}</strong></td></tr>
            <tr><td class="huella-sello-label-cell">Método:</td><td class="huella-sello-value-cell">Huella dactilar del técnico en el dispositivo</td></tr>
            <tr><td class="huella-sello-label-cell">Fecha:</td><td class="huella-sello-value-cell">${fechaHoy}</td></tr>
            <tr><td class="huella-sello-label-cell">Estado:</td><td class="huella-sello-value-cell"><span class="huella-sello-exitoso">Exitoso</span></td></tr>
          </table>
        </div>
        <div class="huella-sello-footer">
          <span class="huella-sello-stamp">🖐️ VERIFICADO BIOMÉTRICAMENTE</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Construir el HTML completo del PDF
 */
// ============================================================
// Helper: renderiza una fila label:valor para las cards
// ============================================================
function r(label: string, value: string | number | null | undefined, fallback = '—'): string {
  const v = value != null && value !== '' ? String(value) : fallback;
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(v)}</span></div>`;
}

// ============================================================
// Helper: renderiza un par de secciones en grid 2 columnas
// ============================================================
function card(iconTitle: string, contenido: string): string {
  return `
    <div class="card">
      <h3 class="card-title">${iconTitle}</h3>
      ${contenido}
    </div>`;
}

function grid2(izq: string, der: string): string {
  return `<div class="grid-2">${izq}${der}</div>`;
}

// ============================================================
// construirHTMLRevision — Formulario propio del revisor
// (coordinador o interventor): concepto, observaciones y
// recomendaciones sobre la visita del técnico.
// ============================================================
function construirHTMLRevisionChecklist(
  form: Formulario,
  datos: DatosRevisionChecklist,
  variante: MembreteVariante
): string {
  const esInterventor = datos.rol === 'interventor';
  const rolLabel = esInterventor ? 'Interventoría' : 'Coordinación';
  const tituloDoc = TITULO_CHECKLIST[datos.tipoChecklist];
  const intro = INTRO_CHECKLIST[datos.tipoChecklist];

  const itemsHtml = datos.items.map((item, idx) => `
    <div class="checklist-item">
      <div class="checklist-item-texto">${idx + 1}. ${escapeHtml(item.texto)}</div>
      ${item.respuesta?.trim()
        ? `<div class="desc-detallada">${escapeHtml(item.respuesta).replace(/\n/g, '<br/>')}</div>`
        : '<p class="no-data">Sin observación registrada</p>'}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${tituloDoc} — ${escapeHtml(form.beneficiario?.nombre || '')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    body {
      font-family: 'Arial Narrow', Arial, sans-serif;
      margin: 0;
      color: #2d3436;
      line-height: 1.4;
    }
    .doc-titulo { text-align: center; border-bottom: 2px solid #1B5E20; padding-bottom: 6px; margin-bottom: 12px; }
    .doc-titulo h1 { color: #1B5E20; font-size: 13pt; letter-spacing: 0.3px; margin-bottom: 3px; }
    .doc-titulo p { color: #444; font-size: 8.5pt; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .card { background: #f8f9fa; border-radius: 8px; padding: 14px 16px; border-left: 4px solid #1B5E20; break-inside: avoid; }
    .card-title { color: #1B5E20; font-size: 13px; font-weight: bold; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; margin-bottom: 8px; }
    .row { display: flex; font-size: 11.5px; margin: 2px 0; }
    .label { font-weight: bold; color: #555; min-width: 110px; flex-shrink: 0; }
    .value { flex: 1; color: #2d3436; }
    .section { margin: 16px 0; padding: 14px 16px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; break-inside: avoid; }
    .section h2 { color: #1B5E20; font-size: 14px; margin-bottom: 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; }
    .section-intro { font-size: 11.5px; color: #444; margin-bottom: 10px; font-style: italic; }
    .desc-detallada { font-size: 12px; color: #2d3436; background: #fff; padding: 8px 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 4px; line-height: 1.5; }
    .no-data { font-size: 11px; color: #b2bec3; font-style: italic; padding: 6px 0; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 10px; color: #b2bec3; }
    .firma-revisor { margin-top: 40px; text-align: center; break-inside: avoid; }
    .firma-revisor .linea { border-top: 1px solid #333; width: 260px; margin: 0 auto 6px; }
    .firma-revisor .nombre { font-size: 12px; font-weight: bold; color: #2d3436; }
    .firma-revisor .rol { font-size: 11px; color: #636e72; }
    .checklist-item { margin-bottom: 12px; break-inside: avoid; }
    .checklist-item-texto { font-size: 12px; font-weight: bold; color: #2d3436; margin-bottom: 4px; }
  </style>
</head>
<body>
  ${membreteAperturaHtml(variante, esInterventor ? 'interventoria' : 'supervision')}

  <div class="doc-titulo">
    <h1>${tituloDoc}</h1>
    <p>Revisión de la visita técnica registrada en GEODAILY</p>
  </div>

  <div class="section">
    <h2>📋 Referencia de la Visita</h2>
    <div class="grid-2">
      ${card('👤 Técnico', [
        r('Nombre', form.tecnico?.nombre),
        r('Cédula', form.tecnico?.cedula),
      ].join(''))}
      ${card('👥 Beneficiario', [
        r('Nombre', form.beneficiario?.nombre),
        r('Cédula', form.beneficiario?.cedula),
        r('Vereda', form.beneficiario?.vereda),
        r('Municipio', form.beneficiario?.municipio),
      ].join(''))}
    </div>
    ${r('Fecha de la visita', formatFecha(form.created_at))}
  </div>

  <div class="section">
    <h2>✅ ${tituloDoc}</h2>
    <p class="section-intro">${escapeHtml(intro)}</p>
    ${itemsHtml}
  </div>

  <div class="firma-revisor">
    <div class="linea"></div>
    <div class="nombre">${escapeHtml(datos.revisorNombre || '—')}</div>
    <div class="rol">${rolLabel}</div>
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital de revisión, complementario al formulario original del técnico.</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

/** Convierte un Blob a data URI (web, donde no existe FileSystem). */
function blobADataUri(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result as string);
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });
}

/**
 * Resuelve una evidencia de seguimiento a una URI que `expo-image-manipulator`
 * pueda leer, usando la red solo cuando de verdad haga falta.
 *
 * Por qué no basta con «uri local si no empieza por http»: el `uri` que guarda
 * el seguimiento es la ruta local del dispositivo que capturó la visita
 * (file:///.../documents/evidencias/xxx.jpg) y viaja tal cual al servidor. Al
 * abrir el seguimiento en OTRO teléfono —o en el navegador— ese archivo no
 * existe, pero la heurística anterior lo daba por válido: `manipulateAsync`
 * fallaba y el PDF salía con «No se pudo cargar esta evidencia». Es el mismo
 * criterio que ya usa `fuenteDe` en SeguimientoDetailScreen: el `archivo_id`
 * remoto manda; la ruta local solo se usa si está de verdad en este equipo.
 *
 * En web no existe FileSystem (ni cacheDirectory ni downloadAsync): la
 * descarga remota se hace con `fetch` y se entrega como blob: URL — el mismo
 * patrón que `convertirFotosAHTML`.
 */
async function resolverEvidenciaSeguimiento(
  foto: { archivo_id?: string; uri?: string }
): Promise<{ uri: string; blobWeb: Blob | null }> {
  const uri = foto.uri;

  // 1. Ya es legible sin red: base64 en memoria o blob de esta sesión.
  if (uri && (uri.startsWith('data:') || uri.startsWith('blob:'))) {
    return { uri, blobWeb: null };
  }

  // 2. Ruta local de ESTE dispositivo — permite generar el PDF sin conexión.
  if (uri && !uri.startsWith('http') && Platform.OS !== 'web') {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) return { uri, blobWeb: null };
    } catch {
      // la ruta no es accesible: se intenta por archivo_id
    }
  }

  // 3. Ya sincronizada (o URL suelta): se descarga del servidor.
  const remota = foto.archivo_id
    ? `${API_CONFIG.BASE_URL}/api/archivos/${foto.archivo_id}/contenido`
    : uri && uri.startsWith('http')
      ? uri
      : null;

  if (remota) {
    const headers = await cabecerasDeArchivo();
    if (Platform.OS === 'web') {
      const respuesta = await fetch(remota, { headers });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const blob = await respuesta.blob();
      return { uri: URL.createObjectURL(blob), blobWeb: blob };
    }
    const sufijo = foto.archivo_id || String(Date.now());
    const destino = `${FileSystem.cacheDirectory}pdf_seguimiento_${sufijo}.jpg`;
    const descarga = await FileSystem.downloadAsync(remota, destino, { headers });
    return { uri: descarga.uri, blobWeb: null };
  }

  throw new Error('La evidencia no está disponible en este dispositivo');
}

/**
 * Embebe como data URI TODAS las evidencias fotográficas del seguimiento — sin
 * límite de cantidad. Si una falla, esa casilla muestra el aviso pero las demás
 * se siguen incluyendo, así que un problema puntual nunca vacía el cuadro.
 */
async function construirFotosSeguimientoHTML(
  fotos: { archivo_id?: string; uri?: string }[],
  fecha?: string
): Promise<string> {
  if (!fotos || fotos.length === 0) {
    return '<p class="no-data">No se registraron evidencias fotográficas</p>';
  }
  // Fecha del seguimiento (created_at, ajustable). Sustituye la marca de agua
  // que antes venía quemada en la foto: ahora la evidencia va limpia y la
  // fecha se imprime aquí, en el PDF.
  const fechaTexto = fecha ? escapeHtml(formatFechaHora(fecha)) : '';
  const etiqueta = (n: number) => `📸 Evidencia ${n}${fechaTexto ? ` · ${fechaTexto}` : ''}`;
  const bloques: string[] = [];
  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    try {
      const { uri, blobWeb } = await resolverEvidenciaSeguimiento(foto);

      let dataUri: string | null = null;
      try {
        // Se redimensiona a 1200px (calidad 0.9) para que el PDF no pese
        // cientos de MB cuando hay muchas fotos, sin perder nitidez visible.
        const resultado = await manipulateAsync(
          uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.9, format: SaveFormat.JPEG, base64: true }
        );
        if (resultado.base64) dataUri = `data:image/jpeg;base64,${resultado.base64}`;
      } catch (manipularErr) {
        console.warn('[PDF Seguimiento] No se pudo redimensionar, se usa la original:', manipularErr);
      }

      // Respaldo sin redimensionar: base64 directo (nativo) o el blob ya
      // descargado (web). Antes, un fallo de resize dejaba la evidencia fuera.
      if (!dataUri) {
        if (uri.startsWith('data:')) {
          dataUri = uri;
        } else if (Platform.OS === 'web') {
          const blob = blobWeb ?? (await (await fetch(uri)).blob());
          dataUri = await blobADataUri(blob);
        } else {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          dataUri = `data:image/jpeg;base64,${base64}`;
        }
      }
      if (!dataUri) throw new Error('Sin datos de imagen');

      bloques.push(`
        <div class="foto-item">
          <p class="evidencia-label">${etiqueta(i + 1)}</p>
          <img src="${dataUri}" alt="Evidencia ${i + 1}" class="foto-img" />
        </div>
      `);
    } catch (err) {
      console.warn('[PDF Seguimiento] No se pudo incluir evidencia', foto.archivo_id || foto.uri, err);
      bloques.push(`
        <div class="foto-item">
          <p class="evidencia-label">${etiqueta(i + 1)}</p>
          <p class="no-data">No se pudo cargar esta evidencia</p>
        </div>
      `);
    }
  }
  return `<div class="fotos-grid">${bloques.join('')}</div>`;
}

/**
 * Resuelve una firma de seguimiento a data URI para embeberla en el PDF.
 * `valor` es 'data:...' (base64 local, aún no subida — offline) o el
 * archivo_id de MinIO (ya sincronizada, hay que descargarla).
 */
async function resolverFirmaSeguimientoDataUri(valor?: string): Promise<string | null> {
  if (!valor) return null;
  if (valor.startsWith('data:')) return valor;
  try {
    const headers = await cabecerasDeArchivo();
    const url = `${API_CONFIG.BASE_URL}/api/archivos/${valor}/contenido`;
    // En web no existe FileSystem: la firma remota se descarga con fetch y se
    // lee como blob — mismo patrón que `resolverFirmaComoDataUri`. Sin esto,
    // las firmas ya sincronizadas nunca aparecían en el PDF web.
    if (Platform.OS === 'web') {
      const respuesta = await fetch(url, { headers });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      return await blobADataUri(await respuesta.blob());
    }
    const destino = `${FileSystem.cacheDirectory}pdf_firma_seguimiento_${valor}.png`;
    const descarga = await FileSystem.downloadAsync(url, destino, { headers });
    const base64 = await FileSystem.readAsStringAsync(descarga.uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.warn('[PDF Seguimiento] No se pudo cargar la firma', valor, err);
    return null;
  }
}

function bloqueFirmaSeguimiento(titulo: string, dataUri: string | null): string {
  return `
    <div class="firma-item">
      <p class="evidencia-label">✍️ ${titulo}</p>
      ${dataUri
        ? `<img src="${dataUri}" alt="${titulo}" class="firma-img" />`
        : '<p class="no-data">Sin firma registrada</p>'}
    </div>
  `;
}

async function construirHTMLSeguimiento(datos: DatosPDFSeguimiento, variante: MembreteVariante): Promise<string> {
  const rolLabel = datos.autorRol === 'interventor' ? 'Interventoría' : 'Coordinación';
  const tipoFormato = datos.autorRol === 'interventor' ? 'interventoria' : 'supervision';
  const fotosHtml = await construirFotosSeguimientoHTML(datos.fotos, datos.fecha);
  const [firmaBeneficiarioUri, firmaAutorUri, mapaUbicacionHtml] = await Promise.all([
    resolverFirmaSeguimientoDataUri(datos.firmaBeneficiario),
    resolverFirmaSeguimientoDataUri(datos.firmaAutor),
    // Mapa pequeño (mosaico 2×2 de teselas satelitales + pin) debajo de las
    // coordenadas — mismo helper que el PDF del técnico usa en las preguntas
    // 20 y 32. El nombre del beneficiario va como etiqueta porque el mapa
    // satelital no trae nombres de lugar. Si no hay señal en el momento de
    // generar el PDF, devuelve '' y la sección se ve igual que antes.
    construirMapaEstaticoHtml(datos.geoLatitud, datos.geoLongitud, datos.beneficiarioNombre || undefined),
  ]);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Seguimiento de ${rolLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    body { font-family: 'Arial Narrow', Arial, sans-serif; margin: 0; color: #2d3436; line-height: 1.4; }
    .doc-titulo { text-align: center; border-bottom: 2px solid #1B5E20; padding-bottom: 6px; margin-bottom: 12px; }
    .doc-titulo h1 { color: #1B5E20; font-size: 13pt; letter-spacing: 0.3px; margin-bottom: 3px; }
    .doc-titulo p { color: #444; font-size: 8.5pt; }
    .section { margin: 16px 0; padding: 14px 16px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; break-inside: avoid; }
    .section h2 { color: #1B5E20; font-size: 14px; margin-bottom: 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; }
    .row { display: flex; font-size: 11.5px; margin: 2px 0; }
    .label { font-weight: bold; color: #555; min-width: 140px; flex-shrink: 0; }
    .value { flex: 1; color: #2d3436; }
    .desc-detallada { font-size: 12px; color: #2d3436; background: #fff; padding: 8px 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 4px; line-height: 1.5; white-space: pre-wrap; }
    .no-data { font-size: 11px; color: #b2bec3; font-style: italic; padding: 6px 0; }
    .fotos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .foto-item { break-inside: avoid; }
    .foto-img { width: 100%; border-radius: 6px; border: 1px solid #e0e0e0; }
    .evidencia-label { font-size: 10.5px; color: #636e72; margin-bottom: 4px; }
    .firmas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
    .firma-item { text-align: center; break-inside: avoid; }
    .firma-img { width: 100%; max-height: 100px; object-fit: contain; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 10px; color: #b2bec3; }
  </style>
</head>
<body>
  ${membreteAperturaHtml(variante, tipoFormato)}

  <div class="doc-titulo">
    <h1>SEGUIMIENTO DE ${rolLabel.toUpperCase()}</h1>
    <p>Registro de acompañamiento en campo — GEODAILY</p>
  </div>

  <div class="section">
    <h2>📋 Datos de la Visita</h2>
    <div class="row"><span class="label">Fecha</span><span class="value">${escapeHtml(formatFecha(datos.fecha))}</span></div>
    <div class="row"><span class="label">${rolLabel}</span><span class="value">${escapeHtml(datos.autorNombre)}</span></div>
    ${datos.beneficiarioNombre ? `<div class="row"><span class="label">Beneficiario</span><span class="value">${escapeHtml(datos.beneficiarioNombre)}</span></div>` : ''}
    <div class="row"><span class="label">Actividad</span><span class="value">${escapeHtml(datos.actividad)}</span></div>
  </div>

  <div class="section">
    <h2>🎯 Objetivo de la Visita</h2>
    ${datos.objetivoVisita?.trim()
      ? `<div class="desc-detallada">${escapeHtml(datos.objetivoVisita)}</div>`
      : '<p class="no-data">Sin objetivo registrado</p>'}
  </div>

  <div class="section">
    <h2>📝 Descripción de la Actividad</h2>
    ${datos.descripcionActividad?.trim()
      ? `<div class="desc-detallada">${escapeHtml(datos.descripcionActividad)}</div>`
      : '<p class="no-data">Sin descripción registrada</p>'}
  </div>

  <div class="section">
    <h2>💬 Observaciones</h2>
    ${datos.observaciones?.trim()
      ? `<div class="desc-detallada">${escapeHtml(datos.observaciones)}</div>`
      : '<p class="no-data">Sin observaciones</p>'}
  </div>

  <div class="section">
    <h2>📷 Cuadro de Evidencias</h2>
    ${fotosHtml}
    ${datos.tieneVideo ? '<p class="no-data" style="margin-top:8px;">🎥 Se grabó video de la visita — no disponible en el PDF, consulte la aplicación para reproducirlo.</p>' : ''}
    <div class="firmas-grid">
      ${bloqueFirmaSeguimiento('Firma del Beneficiario', firmaBeneficiarioUri)}
      ${bloqueFirmaSeguimiento(`Firma de ${rolLabel}`, firmaAutorUri)}
    </div>
  </div>

  <div class="section">
    <h2>📍 Ubicación Capturada</h2>
    ${datos.geoLatitud != null && datos.geoLongitud != null
      ? `<div class="row"><span class="label">Coordenadas</span><span class="value">Lat: ${datos.geoLatitud.toFixed(6)}  Lon: ${datos.geoLongitud.toFixed(6)}${datos.geoAltitud != null ? `  Alt: ${datos.geoAltitud} m` : ''}${datos.geoPrecision != null ? `  (±${datos.geoPrecision} m)` : ''}</span></div>${mapaUbicacionHtml}`
      : '<p class="no-data">Sin ubicación registrada</p>'}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

// ============================================================
// construirHTML — Formulario de Visita Técnica (2 columnas)
// ============================================================
function construirHTML(
  form: Formulario,
  fotosHtml: string,
  firmaBenefHtml: string,
  firmaTecHtml: string,
  huellaHtml: string
): string {
  const sd = form.sociodemografico;
  // El backend guarda georeferencia_json como '{}' (no NULL) cuando el
  // formulario no trae esos datos — que es siempre, hoy: nada en la app
  // llena 'georeferencia' todavía. En memoria, recién completado, el campo
  // es 'undefined' (falsy, sección se omite bien); tras sincronizar y
  // volver a cargar desde el servidor, se convierte en '{}' — un objeto
  // VERDADERO en JS — así que la sección se intentaba renderizar sin tener
  // 'coordenadas' adentro, y `gr.coordenadas.latitud` reventaba el PDF
  // entero, cayendo al generador de respaldo sin membrete. Se exige que
  // 'coordenadas' exista de verdad, no solo que el objeto no sea null.
  const gr = form.georeferencia?.coordenadas ? form.georeferencia : undefined;
  const clima = form.clima?.actual;

  // --- Sociodemográfico (si existe) ---
  const socioHtml = sd ? card('👨‍👩‍👧‍👦 Datos Sociodemográficos', [
    r('Género', sd.genero),
    r('Escolaridad', sd.escolaridad),
    sd.etnia ? r('Etnia', sd.etnia) : '',
    r('Personas a cargo', sd.personas_cargo),
    r('Hectáreas', sd.hectareas),
    r('Vive en la finca', sd.vive_en_finca ? 'Sí' : 'No'),
    r('Asociado', sd.asociado ? 'Sí' : 'No'),
    sd.asociacion_nombre ? r('Asociación', sd.asociacion_nombre) : '',
    sd.telefono_emergencia ? r('Tel. emergencia', sd.telefono_emergencia) : '',
  ].join('')) : '';

  // --- Georeferencia (si existe) ---
  const geoHtml = gr ? card('🌐 Georeferencia', [
    r('Latitud', gr.coordenadas.latitud.toFixed(6)),
    r('Longitud', gr.coordenadas.longitud.toFixed(6)),
    gr.coordenadas.altitud ? r('Altitud', `${gr.coordenadas.altitud.toFixed(1)} m`) : '',
    r('Huso UTM', gr.huso_utm),
    r('Banda UTM', gr.banda_utm),
    r('Código MGRS', gr.codigo_mgrs),
    r('Zona horaria', gr.zona_horaria),
    r('País', gr.pais),
  ].join('')) : '';

  // --- Clima ---
  const climaHtml = clima ? card('🌤 Condiciones Ambientales', [
    clima.ubicacion?.nombre ? r('Lugar', clima.ubicacion.nombre) : '',
    clima.temperatura?.actual != null ? r('Temperatura', `${Math.round(clima.temperatura.actual)}°C`) : '',
    clima.temperatura?.sensacion_termica != null ? r('Sensación térmica', `${Math.round(clima.temperatura.sensacion_termica)}°C`) : '',
    clima.humedad != null ? r('Humedad', `${clima.humedad}%`) : '',
    clima.viento?.velocidad != null ? r('Viento', `${Math.round(clima.viento.velocidad)} m/s`) : '',
    clima.nubosidad != null ? r('Nubosidad', `${clima.nubosidad}%`) : '',
    clima.presion != null ? r('Presión', `${clima.presion} hPa`) : '',
    clima.visibilidad != null ? r('Visibilidad', `${clima.visibilidad} km`) : '',
    clima.clima ? r('Condición', clima.clima) : '',
  ].join('')) : '';

  // --- Videos como anexo ---
  const videos = (form.fotos || []).filter((f) => f.tipo === 'video');
  const anexoVideosHtml = videos.length > 0 ? `
    <div class="section annex-videos">
      <h2>📎 ANEXO — VIDEOS DE LA VISITA (${videos.length})</h2>
      <p class="annex-note">Los videos no pueden incrustarse en el PDF. Quedan almacenados en el servidor (MinIO, carpeta videos/) como evidencia complementaria.</p>
      ${videos.map((v, i) => `
        <div class="video-ref">
          <span class="video-num">Video ${i + 1}</span>
          <span class="video-info">${formatFecha(v.timestamp)} · 📍 ${v.coordenadas ? `${v.coordenadas.latitud?.toFixed(6)}, ${v.coordenadas.longitud?.toFixed(6)}` : '—'}</span>
        </div>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Visita Técnica — ${escapeHtml(form.beneficiario.nombre)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    /* Título del documento, subordinado al membrete institucional */
    .doc-titulo {
      text-align: center;
      border-bottom: 2px solid #1B5E20;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .doc-titulo h1 {
      color: #1B5E20; font-size: 13pt; letter-spacing: 0.3px; margin-bottom: 3px;
    }
    .doc-titulo p { color: #444; font-size: 8.5pt; }
    body {
      font-family: 'Arial Narrow', Arial, sans-serif;
      /* Márgenes reales los fija @page, para no invadir encabezado ni pie */
      margin: 0;
      color: #2d3436;
      line-height: 1.4;
    }
    /* --- GRID 2 COLUMNAS --- */
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    /* --- CARDS --- */
    .card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 14px 16px;
      border-left: 4px solid #1B5E20;
      break-inside: avoid;
    }
    .card-title {
      color: #1B5E20;
      font-size: 13px;
      font-weight: bold;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .row {
      display: flex;
      font-size: 11.5px;
      margin: 2px 0;
    }
    .label {
      font-weight: bold;
      color: #555;
      min-width: 110px;
      flex-shrink: 0;
    }
    .value {
      flex: 1;
      color: #2d3436;
    }
    /* --- SECCIÓN FULL WIDTH (cuando algo necesita ancho completo) --- */
    .section {
      margin: 16px 0;
      padding: 14px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #1B5E20;
    }
    .section h2 {
      color: #1B5E20;
      font-size: 14px;
      margin-bottom: 10px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 5px;
    }
    .desc-detallada {
      font-size: 12px;
      color: #2d3436;
      background: #fff;
      padding: 8px 10px;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
      margin-top: 4px;
      line-height: 1.5;
    }
    /* --- FOTOS EN GRILLA 2 COLUMNAS --- */
    .photo-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .foto-item {
      padding: 10px;
      background: #fff;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      break-inside: avoid;
    }
    .evidencia-label {
      font-size: 11px;
      color: #0984e3;
      font-weight: bold;
      margin-bottom: 6px;
    }
    .foto-img {
      /* object-fit:cover recortaba la foto y en una evidencia de campo se
         perdía parte de lo fotografiado; contain la muestra completa. */
      width: 100%;
      height: 5.2cm;
      object-fit: contain;
      background: #f4f4f4;
      border-radius: 4px;
      display: block;
    }
    .foto-coords, .foto-heading {
      font-size: 10px;
      color: #636e72;
      font-family: monospace;
      margin-top: 3px;
    }
    /* --- FIRMAS LADO A LADO --- */
    .firmas-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 8px;
    }
    .firma-item {
      padding: 12px;
      background: #fff;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      break-inside: avoid;
    }
    .firma-item .evidencia-label { font-size: 11px; color: #6c5ce7; }
    .firma-img {
      /* Alto fijo con contain: las firmas llegan en proporciones muy
         distintas y a 80 px quedaban diminutas o deformadas. */
      width: 100%;
      height: 2.6cm;
      object-fit: contain;
      background: #fff;
      border: 1px dashed #b2bec3;
      border-radius: 4px;
      padding: 6px;
      background: #fff;
      display: block;
      margin: 0 auto;
    }
    /* --- HUELLA --- */
    .huella-wrap {
      display: flex;
      justify-content: center;
      margin-top: 8px;
    }
    .huella-sello {
      max-width: 480px;
      break-inside: avoid;
    }
    .huella-sello-inner {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #1B5E20;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(27, 94, 32, 0.15);
    }
    .huella-sello-header {
      display: flex;
      align-items: center;
      gap: 14px;
      border-bottom: 1px solid #bbf7d0;
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .huella-sello-img { width: 52px; height: 52px; flex-shrink: 0; }
    .huella-sello-titles { flex: 1; }
    .huella-sello-verificado { font-size: 18px; font-weight: bold; color: #15803d; }
    .huella-sello-label { font-size: 12px; color: #16a34a; }
    .huella-sello-body { margin-bottom: 10px; }
    .huella-sello-table { width: 100%; border-collapse: collapse; }
    .huella-sello-table td { padding: 3px 6px; font-size: 12px; }
    .huella-sello-label-cell { color: #555; font-weight: bold; width: 110px; }
    .huella-sello-value-cell { color: #2d3436; }
    .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 11px; font-weight: bold; padding: 2px 10px; border-radius: 10px; }
    .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 8px; }
    .huella-sello-stamp { display: inline-block; font-size: 12px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 3px 14px; transform: rotate(-2deg); }
    /* --- ANEXO VIDEOS --- */
    .annex-videos { border-left-color: #0984e3 !important; }
    .annex-note { font-size: 11px; color: #636e72; margin-bottom: 8px; }
    .video-ref {
      display: flex; gap: 12px; font-size: 11px;
      padding: 4px 0; border-bottom: 1px dotted #e0e0e0;
    }
    .video-num { font-weight: bold; color: #0984e3; min-width: 60px; }
    .video-info { color: #636e72; }
    /* --- NO DATA & FOOTER --- */
    .no-data { font-size: 11px; color: #b2bec3; font-style: italic; padding: 6px 0; }
    .footer {
      margin-top: 32px; padding-top: 12px;
      border-top: 1px solid #e0e0e0;
      text-align: center; font-size: 10px; color: #b2bec3;
    }
    @media print {
      /* La rejilla puede partirse entre páginas; las tarjetas y las fotos no,
         para que ningún bloque quede cortado por la mitad. */
      .grid-2 { break-inside: auto; }
      .card { break-inside: avoid; }
      .photo-grid { break-inside: auto; }
    }
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'tecnica')}

  <div class="doc-titulo">
    <h1>FORMULARIO DE VISITA TÉCNICA</h1>
    <p><strong>Beneficiario:</strong> ${escapeHtml(form.beneficiario?.nombre || '—')}
       &nbsp;·&nbsp; <strong>C.C.:</strong> ${escapeHtml(form.beneficiario?.cedula || '—')}
       &nbsp;·&nbsp; <strong>Vereda:</strong> ${escapeHtml(form.beneficiario?.vereda || '—')}
       &nbsp;·&nbsp; <strong>Fecha:</strong> ${formatFecha(form.created_at)}</p>
  </div>

  <!-- FILA 1: Técnico + Beneficiario -->
  ${grid2(
    card('👤 Técnico', [
      r('Nombre', form.tecnico.nombre),
      r('Cédula', form.tecnico.cedula),
      r('Teléfono', form.tecnico.telefono),
      r('Email', form.tecnico.email),
    ].join('')),
    card('👥 Beneficiario', [
      r('Nombre', form.beneficiario.nombre),
      r('Cédula', form.beneficiario.cedula),
      r('Teléfono', form.beneficiario.telefono),
      r('Departamento', form.beneficiario.departamento),
      r('Municipio', form.beneficiario.municipio),
      r('Vereda', form.beneficiario.vereda),
      r('Finca', form.beneficiario.finca),
    ].join(''))
  )}

  <!-- FILA 2: Actividad + Ubicación GPS -->
  ${grid2(
    card('📋 Actividad Realizada', [
      r('Tipo', form.actividad.descripcion),
    ].join('')),
    card('📍 Ubicación', [
      r('Lugar', form.coordenadas?.lugar || form.clima?.actual?.ubicacion?.nombre),
      r('Latitud', form.coordenadas?.latitud?.toFixed(6)),
      r('Longitud', form.coordenadas?.longitud?.toFixed(6)),
      form.coordenadas?.altitud ? r('Altitud', `${form.coordenadas.altitud.toFixed(1)} m`) : '',
      form.coordenadas?.precision_gps ? r('Precisión', `±${form.coordenadas.precision_gps} m`) : '',
    ].join(''))
  )}

  <!-- Descripción detallada (full width si existe) -->
  ${form.actividad.descripcion_detallada ? `
  <div class="section">
    <h2>📝 Descripción Detallada</h2>
    <div class="desc-detallada">${escapeHtml(form.actividad.descripcion_detallada)}</div>
  </div>` : ''}

  <!-- FILA 3: Observaciones + Recomendaciones -->
  ${(form.actividad.observaciones || form.actividad.recomendaciones) ? grid2(
    form.actividad.observaciones ? card('🔍 Observaciones', `<div class="desc-detallada">${escapeHtml(form.actividad.observaciones)}</div>`) : '',
    form.actividad.recomendaciones ? card('💡 Recomendaciones', `<div class="desc-detallada">${escapeHtml(form.actividad.recomendaciones)}</div>`) : ''
  ) : ''}

  <!-- FILA 4: Clima + Sociodemográfico -->
  ${(climaHtml || socioHtml) ? grid2(climaHtml, socioHtml) : ''}

  <!-- FILA 5: Georeferencia (si existe) -->
  ${geoHtml ? `<div class="section" style="border-left-color:#6c5ce7;"><h2>🌐 Georeferencia del Terreno</h2><div class="grid-2">${geoHtml}</div></div>` : ''}

  <!-- EVIDENCIAS DE CAMPO -->
  <div class="section">
    <h2>📸 Evidencias de Campo</h2>

    <!-- FOTOS en grilla 2 columnas -->
    <p style="font-size:12px;font-weight:bold;color:#0984e3;margin:8px 0 4px;">Fotografías</p>
    <div class="photo-grid">${fotosHtml}</div>

    <!-- FIRMAS lado a lado -->
    <p style="font-size:12px;font-weight:bold;color:#6c5ce7;margin:14px 0 4px;">Firmas</p>
    <div class="firmas-grid">
      ${firmaBenefHtml}
      ${firmaTecHtml}
    </div>

    <!-- HUELLA BIOMÉTRICA -->
    <p style="font-size:12px;font-weight:bold;color:#15803d;margin:14px 0 4px;">Registro Biométrico</p>
    <div class="huella-wrap">${huellaHtml}</div>
  </div>

  <!-- ANEXO: Videos -->
  ${anexoVideosHtml}

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

/**
 * Construir HTML del PDF para el formulario de Caracterización Sociodemográfica (Nuevo)
 */
async function construirHTMLCaracterizacion(
  form: Formulario,
  fotosHtml: string,
  firmaBenefHtml: string,
  firmaTecHtml: string,
  huellaHtml: string
): Promise<string> {
  const c = (form as any).caracterizacion_nueva || {};

  // Las 52 preguntas oficiales vienen del esquema canónico compartido
  // (src/utils/encuestaSchema.ts), el mismo que usa la pantalla de
  // "Detalle del Formulario". Así el PDF y la app nunca divergen.
  const seccionesEncuesta = construirSeccionesEncuesta(c, form);

  // Mapa pequeño (teselas + pin) para las preguntas de coordenadas 20 y 32.
  // Si no hay señal para descargar las teselas, quedan como '' y esas
  // preguntas se ven igual que antes (solo el texto de lat/lon).
  const ubicacionTexto = [c.municipio, c.vereda || c.corregimiento].filter(Boolean).join(' · ');
  const [mapaFincaHtml, mapaSueloHtml] = await Promise.all([
    construirMapaEstaticoHtml(
      Number(c.caracterizacion_finca?.latitud),
      Number(c.caracterizacion_finca?.longitud),
      ubicacionTexto
    ),
    construirMapaEstaticoHtml(
      Number(c.analisis_suelo?.intervencion_latitud),
      Number(c.analisis_suelo?.intervencion_longitud),
      ubicacionTexto
    ),
  ]);

  // Bloque pregunta+respuesta (siempre se imprime — la encuesta completa)
  const q = (num: string, texto: string, respuesta?: string | null) => `
    <div class="q">
      <div class="q-t">${num}. ${escapeHtml(texto)}</div>
      <div class="q-a">${respuesta ? escapeHtml(respuesta) : '—'}</div>
    </div>`;

  /** Renderiza una sección resuelta del esquema compartido */
  const renderSeccion = (sec: SeccionResuelta, mapaPorNumero?: Record<string, string>): string => {
    if (sec.textoLargo) {
      return `
    <div class="section">
      <h2>${escapeHtml(sec.titulo)}</h2>
      ${sec.preguntas.map((pr) => `
      <div class="q-full"><div class="q-t">${pr.numero}. ${escapeHtml(pr.texto)}</div>
      <div class="desc-detallada">${escapeHtml(pr.valor || '—')}</div></div>`).join('')}
    </div>`;
    }
    const filas = sec.preguntas
      .map((pr) => `
    <div class="q">
      <div class="q-t">${pr.numero}. ${escapeHtml(pr.texto)}</div>
      <div class="q-a">${pr.valor ? escapeHtml(pr.valor) : '—'}${
        pr.observacion ? `<br/><em>Obs: ${escapeHtml(pr.observacion)}</em>` : ''
      }</div>
      ${mapaPorNumero?.[pr.numero] || ''}
    </div>`)
      .join('');
    return `
    <div class="section">
      <h2>${escapeHtml(sec.titulo)}</h2>
      <div class="cols">${filas}</div>
    </div>`;
  };

  /** HTML de todas las secciones de la encuesta, en orden oficial */
  const encuestaHtml = seccionesEncuesta.map((sec) => {
    if (sec.titulo === 'CARACTERIZACIÓN DE LA FINCA') return renderSeccion(sec, { '20': mapaFincaHtml });
    if (sec.titulo === 'SECCIÓN DE SUELO') return renderSeccion(sec, { '32': mapaSueloHtml });
    return renderSeccion(sec);
  }).join('');

  // ---- Ubicación GPS del formulario + Clima en el momento de la visita ----
  const clima = (form.clima as any)?.actual;
  const ubicacionClimaHtml = `
    <div class="section">
      <h2>📍 UBICACIÓN Y CONDICIONES AMBIENTALES DE LA VISITA</h2>
      <div class="cols">
        ${q('•', 'Lugar', form.coordenadas?.lugar || clima?.ubicacion?.nombre)}
        ${q('•', 'Latitud', form.coordenadas?.latitud ? form.coordenadas.latitud.toFixed(6) : '')}
        ${q('•', 'Longitud', form.coordenadas?.longitud ? form.coordenadas.longitud.toFixed(6) : '')}
        ${q('•', 'Altitud', form.coordenadas?.altitud ? `${form.coordenadas.altitud.toFixed(1)} m` : '')}
        ${q('•', 'Precisión GPS', form.coordenadas?.precision_gps ? `±${form.coordenadas.precision_gps} m` : '')}
        ${clima ? q('•', 'Temperatura', clima.temperatura?.actual != null ? `${clima.temperatura.actual}°C (sensación ${clima.temperatura.sensacion_termica ?? '—'}°C)` : '') : ''}
        ${clima ? q('•', 'Humedad', clima.humedad != null ? `${clima.humedad}%` : '') : ''}
        ${clima ? q('•', 'Presión', clima.presion != null ? `${clima.presion} hPa` : '') : ''}
        ${clima?.viento ? q('•', 'Viento', `${clima.viento.velocidad ?? '—'} m/s`) : ''}
        ${clima?.nubosidad != null ? q('•', 'Nubosidad', `${clima.nubosidad}%`) : ''}
        ${clima?.clima ? q('•', 'Condición', clima.clima) : ''}
      </div>
    </div>`;

  // ---- ANEXO: Videos (no se pueden embeber en el PDF — se listan como referencia) ----
  const videos = (form.fotos || []).filter((f) => f.tipo === 'video');
  const anexoVideosHtml = videos.length > 0 ? `
    <div class="section" style="border-left-color:#0984e3;">
      <h2>📎 ANEXO — VIDEOS DE LA VISITA (${videos.length})</h2>
      <p style="font-size:12px;color:#636e72;margin-bottom:8px;">Los videos no pueden incrustarse en el PDF. Quedan almacenados en el servidor del proyecto (MinIO, carpeta videos/) como parte de la evidencia de esta visita.</p>
      ${videos.map((v, i) => `
        <div class="q-full" style="margin-bottom:6px;">
          <div class="q-t">Video ${i + 1}</div>
          <div class="q-a">Fecha: ${formatFecha(v.timestamp)} · Coordenadas: ${v.coordenadas ? `${v.coordenadas.latitud?.toFixed(6)}, ${v.coordenadas.longitud?.toFixed(6)}` : '—'} · ID: ${escapeHtml(v.id)}</div>
        </div>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Caracterización Sociodemográfica — ${escapeHtml(c.productor_nombre || form.id)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    /* Título del documento, subordinado al membrete institucional */
    .doc-titulo {
      text-align: center;
      border-bottom: 2px solid #1B5E20;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .doc-titulo h1 {
      color: #1B5E20; font-size: 13pt; letter-spacing: 0.3px; margin-bottom: 3px;
    }
    .doc-titulo p { color: #444; font-size: 8.5pt; }
    body {
      font-family: 'Arial Narrow', Arial, sans-serif;
      margin: 0;
      color: #2d3436;
      line-height: 1.45;
    }
    .section {
      margin: 20px 0;
      padding: 16px 20px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #1B5E20;
    }
    .section h2 {
      color: #1B5E20;
      font-size: 16px;
      margin-bottom: 12px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 6px;
    }
    .row { display: flex; margin: 2px 0; font-size: 11.5px; }
    .label { font-weight: bold; color: #555; min-width: 110px; flex-shrink: 0; }
    .value { flex: 1; color: #2d3436; }
    /* Encuesta en 2 columnas — compacta pero legible */
    .cols { column-count: 2; column-gap: 20px; }
    .q {
      break-inside: avoid;
      -webkit-column-break-inside: avoid;
      margin-bottom: 7px;
      padding-bottom: 5px;
      border-bottom: 1px dotted #e0e0e0;
    }
    .q-t { font-size: 10.5px; font-weight: bold; color: #555; line-height: 1.35; }
    .q-a { font-size: 11.5px; color: #1B5E20; font-weight: 600; margin-top: 1px; line-height: 1.35; }
    .q-a em { color: #636e72; font-weight: normal; font-size: 10.5px; }
    .q-full { margin-bottom: 8px; }
    .q-full .q-t { font-size: 11px; }
    .desc-detallada {
      font-size: 13px;
      color: #2d3436;
      background: #fff;
      padding: 10px;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
      margin-top: 6px;
      line-height: 1.5;
    }
    .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .foto-item { padding: 10px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; break-inside: avoid; }
    /* contain en vez de cover: no recorta la evidencia fotográfica */
    .foto-img { width: 100%; height: 5.2cm; object-fit: contain; background: #f4f4f4; border-radius: 4px; display: block; }
    .foto-coords { font-size: 10px; color: #636e72; font-family: monospace; margin-top: 3px; }
    .foto-heading { font-size: 10px; color: #0984e3; font-family: monospace; }
    .evidencia-item { margin: 12px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
    .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
    .firmas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
    .firma-item { padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; break-inside: avoid; }
    .firma-item .evidencia-label { font-size: 11px; color: #6c5ce7; }
    .firma-img { width: 100%; height: 2.6cm; object-fit: contain; border: 1px dashed #b2bec3; border-radius: 4px; padding: 4px; background: #fff; display: block; margin: 0 auto; }
    .huella-sello { margin: 16px 0; page-break-inside: avoid; }
    .huella-sello-inner {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #1B5E20; border-radius: 12px; padding: 20px;
      box-shadow: 0 2px 8px rgba(27, 94, 32, 0.15);
    }
    .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
    .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
    .huella-sello-titles { flex: 1; }
    .huella-sello-verificado { font-size: 20px; font-weight: bold; color: #15803d; }
    .huella-sello-label { font-size: 13px; color: #16a34a; }
    .huella-sello-body { margin-bottom: 14px; }
    .huella-sello-table { width: 100%; border-collapse: collapse; }
    .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
    .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
    .huella-sello-value-cell { color: #2d3436; }
    .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
    .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 12px; }
    .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
    .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
    @media print {
      .foto-img { max-width: 100%; }
      /* Las secciones SÍ pueden partirse: con break-inside:avoid una sección
         que no cabía saltaba entera y dejaba media página vacía. Lo que no se
         parte es cada pregunta (.q) ni cada evidencia (.foto-item). */
      .section { break-inside: auto; }
      .section h2 { break-after: avoid; }
    }
  </style>
</head>
<body>
  ${membreteAperturaHtml('ejecucion', 'caracterizacion')}

  <div class="doc-titulo">
    <h1>ENCUESTA SOCIAL AGROAMBIENTAL</h1>
    <p><strong>Productor:</strong> ${escapeHtml(c.productor_nombre || '—')}
       &nbsp;·&nbsp; <strong>C.C.:</strong> ${escapeHtml(c.documento || '—')}
       &nbsp;·&nbsp; <strong>Vereda:</strong> ${escapeHtml(c.vereda || '—')}
       &nbsp;·&nbsp; <strong>Fecha:</strong> ${escapeHtml(c.fecha || formatFecha(form.created_at))}</p>
  </div>

  <!-- Encuesta completa (52 preguntas) desde el esquema canónico -->
  ${encuestaHtml}

  <!-- SOCIODEMOGRÁFICO (si existe) -->
  ${form.sociodemografico ? `
  <div class="section" style="border-left-color:#e17055;">
    <h2>👨‍👩‍👧‍👦 DATOS SOCIODEMOGRÁFICOS</h2>
    <div class="cols">
      ${q('•', 'Género', form.sociodemografico.genero)}
      ${q('•', 'Escolaridad', form.sociodemografico.escolaridad)}
      ${q('•', 'Etnia', form.sociodemografico.etnia)}
      ${q('•', 'Personas a cargo', String(form.sociodemografico.personas_cargo))}
      ${q('•', 'Hectáreas', String(form.sociodemografico.hectareas))}
      ${q('•', 'Vive en la finca', form.sociodemografico.vive_en_finca ? 'Sí' : 'No')}
      ${q('•', 'Asociado', form.sociodemografico.asociado ? 'Sí' : 'No')}
      ${form.sociodemografico.asociacion_nombre ? q('•', 'Asociación', form.sociodemografico.asociacion_nombre) : ''}
      ${form.sociodemografico.telefono_emergencia ? q('•', 'Tel. emergencia', form.sociodemografico.telefono_emergencia) : ''}
    </div>
  </div>` : ''}

  <!-- GEOREFERENCIA (si existe). El servidor guarda '{}' en vez de NULL
       cuando no hay datos — hace falta exigir 'coordenadas' de verdad, no
       solo que el objeto exista, o esto revienta el PDF entero al leer
       formulario.georeferencia.coordenadas.latitud sobre un objeto vacío. -->
  ${form.georeferencia?.coordenadas ? `
  <div class="section" style="border-left-color:#6c5ce7;">
    <h2>🌐 GEOREFERENCIA DEL TERRENO</h2>
    <div class="cols">
      ${q('•', 'Latitud', form.georeferencia.coordenadas.latitud.toFixed(6))}
      ${q('•', 'Longitud', form.georeferencia.coordenadas.longitud.toFixed(6))}
      ${form.georeferencia.coordenadas.altitud ? q('•', 'Altitud', `${form.georeferencia.coordenadas.altitud.toFixed(1)} m`) : ''}
      ${q('•', 'Huso UTM', String(form.georeferencia.huso_utm))}
      ${q('•', 'Banda UTM', form.georeferencia.banda_utm)}
      ${q('•', 'Código MGRS', form.georeferencia.codigo_mgrs)}
      ${q('•', 'Zona horaria', form.georeferencia.zona_horaria)}
      ${q('•', 'País', form.georeferencia.pais)}
    </div>
  </div>` : ''}

  ${ubicacionClimaHtml}

  <!-- EVIDENCIAS -->
  <div class="section">
    <h2>📸 EVIDENCIAS DE CAMPO</h2>

    <p style="font-size:12px;font-weight:bold;color:#0984e3;margin:8px 0 4px;">Fotografías</p>
    <div class="photo-grid">${fotosHtml}</div>

    <p style="font-size:12px;font-weight:bold;color:#6c5ce7;margin:14px 0 4px;">Firmas</p>
    <div class="firmas-grid">
      ${firmaBenefHtml}
      ${firmaTecHtml}
    </div>

    <p style="font-size:12px;font-weight:bold;color:#15803d;margin:14px 0 4px;">Registro Biométrico</p>
    <div style="display:flex;justify-content:center;">${huellaHtml}</div>
  </div>

  ${anexoVideosHtml}

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent injection
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
