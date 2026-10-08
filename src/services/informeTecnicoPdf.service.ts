// ============================================================
// GEODAILY — Informe PDF de visitas por técnico (con IA + mapa real)
// ============================================================
// Reporte de progreso de UNA o VARIAS "rondas" de visita (Visita 1..12)
// sobre TODOS los beneficiarios asignados actualmente a un técnico: cuántos
// ya fueron visitados en esa ronda, fechas, tipo de visita, sus coordenadas
// con un mapa real impreso (mosaico de teselas — ver utils/staticMap.ts) y
// las conclusiones que redacta la IA (DeepSeek, vía backend) al momento de
// generar el PDF.
//
// Mismo criterio de resiliencia que dashboardPdf.service.ts: sin internet,
// o si el mapa/la IA fallan, el PDF se genera igual, solo sin esa parte —
// nunca se interrumpe ni se le muestra un error al usuario por esto.
// ============================================================

import { Platform, Alert } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import NetInfo from '@react-native-community/netinfo';
import { Formulario } from '../types';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss, MembreteVariante } from '../utils/membrete';
import { escapeHtml } from './pdfLocal.service';
import { construirMosaicoMapa, dibujarPuntosEnMosaico, MosaicoMapa } from '../utils/staticMap';
import { LIMITES_PUERTO_RICO_MUNICIPIO } from './offlineMap.service';
import { analizarTecnico, RondaVisitaIA } from './ia.service';
import { COLORS } from '../theme';

export const NUMEROS_VISITA_INFORME_TECNICO = Array.from({ length: 12 }, (_, i) => i + 1);

export interface BeneficiarioInformeTecnico {
  nombre: string;
  cedula: string;
  vereda: string;
  municipio: string;
  /** Visitas de este beneficiario con este técnico, ordenadas por fecha ascendente (índice 0 = Visita 1). */
  visitas: Formulario[];
}

export interface DatosInformeTecnico {
  tecnicoNombre: string;
  tecnicoCedula?: string;
  /** Todos los beneficiarios ASIGNADOS actualmente al técnico (tengan o no visitas aún) — mismo criterio que la tarjeta X/Total. */
  beneficiarios: BeneficiarioInformeTecnico[];
  rolUsuario: 'coordinador' | 'interventor' | 'gerente' | string;
  nombreUsuario: string;
  /** Qué números de visita incluir — [3] para "Visita 3" sola, o los 12 para "Todas". */
  numerosVisita: number[];
}

const ETIQUETA_TIPO_VISITA: Record<string, string> = {
  caracterizacion: 'Caracterización',
  visita_tecnica: 'Visita Técnica',
  plantacion: 'Plantación',
};

const ETIQUETA_ROL: Record<string, string> = {
  coordinador: 'Coordinación',
  interventor: 'Interventoría',
  gerente: 'Gerencia',
};

function colorPorTipo(tipo: string): string {
  return tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.secondary;
}

interface FilaRonda {
  beneficiario: string;
  vereda: string;
  municipio: string;
  visita: Formulario | null; // null = aún no visitado en esta ronda
}

interface RondaCalculada {
  numero: number;
  completados: number;
  total: number;
  filas: FilaRonda[];
}

function calcularRondas(datos: DatosInformeTecnico): RondaCalculada[] {
  return datos.numerosVisita.map((numero) => {
    const filas: FilaRonda[] = datos.beneficiarios.map((b) => ({
      beneficiario: b.nombre,
      vereda: b.vereda,
      municipio: b.municipio,
      visita: b.visitas.length >= numero ? b.visitas[numero - 1] : null,
    }));
    const completados = filas.filter((f) => f.visita !== null).length;
    return { numero, completados, total: datos.beneficiarios.length, filas };
  });
}

// --- Mapa (mosaico único del municipio, reutilizado con distintos pines por ronda) ---

async function hayInternet(): Promise<boolean> {
  try {
    const estado = await NetInfo.fetch();
    return estado.isConnected === true && estado.isInternetReachable !== false;
  } catch {
    return false;
  }
}

async function obtenerMosaicoBase(): Promise<MosaicoMapa | null> {
  if (!(await hayInternet())) return null;
  const [[este, norte], [oeste, sur]] = LIMITES_PUERTO_RICO_MUNICIPIO;
  try {
    return await construirMosaicoMapa({ norte, sur, este, oeste });
  } catch (e) {
    console.warn('[Informe Técnico PDF] No se pudo descargar el mosaico del mapa:', e);
    return null;
  }
}

// El municipio de Puerto Rico (Caquetá) es angosto y largo (relación de
// aspecto ~1:2) — limitar solo el ancho producía un mapa demasiado alto
// para una página impresa (se recortaba y hasta empujaba toda la sección a
// la página siguiente, dejando la anterior en blanco). Con un límite de
// alto también, `dibujarPuntosEnMosaico` ajusta por el lado más
// restrictivo y el mosaico completo (con todos los puntos) siempre cabe.
const MAPA_MAX_ANCHO_PX = 520;
const MAPA_MAX_ALTO_PX = 280;

function mapaHtmlDeRonda(mosaico: MosaicoMapa | null, ronda: RondaCalculada): string {
  if (!mosaico) {
    return '<p class="no-data">Sin conexión al generar el PDF — no se pudo cargar el mapa.</p>';
  }
  const puntos = ronda.filas
    .filter((f): f is FilaRonda & { visita: Formulario } => !!f.visita && typeof f.visita.coordenadas?.latitud === 'number')
    .map((f) => ({
      latitud: f.visita.coordenadas.latitud,
      longitud: f.visita.coordenadas.longitud,
      color: colorPorTipo(f.visita.tipo),
    }));
  if (puntos.length === 0) {
    return '<p class="no-data">Ninguna visita de esta ronda tiene coordenadas GPS todavía.</p>';
  }
  return dibujarPuntosEnMosaico(mosaico, puntos, MAPA_MAX_ANCHO_PX, MAPA_MAX_ALTO_PX);
}

// --- IA: conclusiones por ronda (en lote, igual que dashboardPdf.service.ts) ---

const TAMANO_LOTE_IA = 3;

async function recolectarConclusiones(
  tecnicoNombre: string,
  rondas: RondaCalculada[]
): Promise<Map<number, string>> {
  const resultado = new Map<number, string>();
  if (!(await hayInternet())) return resultado;

  const rondasIA: RondaVisitaIA[] = rondas.map((r) => ({
    numero: r.numero,
    completados: r.completados,
    total: r.total,
    visitas: r.filas
      .filter((f): f is FilaRonda & { visita: Formulario } => !!f.visita)
      .map((f) => ({
        beneficiario: f.beneficiario,
        vereda: f.vereda,
        fecha: new Date(f.visita.created_at).toLocaleDateString('es-CO'),
        tipo: ETIQUETA_TIPO_VISITA[f.visita.tipo] || f.visita.tipo,
      })),
  }));

  // Una llamada por ronda (cada una necesita su propio texto de conclusiones), en lotes.
  for (let i = 0; i < rondasIA.length; i += TAMANO_LOTE_IA) {
    const lote = rondasIA.slice(i, i + TAMANO_LOTE_IA);
    const respuestas = await Promise.all(
      lote.map(async (ronda) => ({
        numero: ronda.numero,
        texto: await analizarTecnico({ tecnico: tecnicoNombre, rondas: [ronda] }),
      }))
    );
    respuestas.forEach(({ numero, texto }) => {
      if (texto) resultado.set(numero, texto);
    });
  }

  return resultado;
}

// --- HTML ---

function bloqueAnalisisIA(texto: string | undefined): string {
  if (!texto) return '';
  const parrafos = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parrafos.length === 0) return '';
  return `<div class="analisis-ia">${parrafos.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`;
}

function tablaRonda(ronda: RondaCalculada): string {
  const filas = ronda.filas
    .map((f) => {
      const fecha = f.visita ? new Date(f.visita.created_at).toLocaleDateString('es-CO') : '—';
      const tipo = f.visita ? ETIQUETA_TIPO_VISITA[f.visita.tipo] || f.visita.tipo : '—';
      const coords = f.visita && typeof f.visita.coordenadas?.latitud === 'number'
        ? `${f.visita.coordenadas.latitud.toFixed(6)}, ${f.visita.coordenadas.longitud.toFixed(6)}`
        : '—';
      const estado = f.visita ? '✅ Visitado' : '⏳ Pendiente';
      return `<tr>
        <td>${escapeHtml(f.beneficiario)}</td>
        <td>${escapeHtml(f.vereda || '—')}</td>
        <td>${estado}</td>
        <td>${fecha}</td>
        <td>${tipo}</td>
        <td>${coords}</td>
      </tr>`;
    })
    .join('');
  return `<table class="tabla-reporte">
    <thead><tr><th>Beneficiario</th><th>Vereda</th><th>Estado</th><th>Fecha</th><th>Tipo</th><th>Coordenadas</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

function bloqueRonda(ronda: RondaCalculada, mosaico: MosaicoMapa | null, conclusiones: string | undefined): string {
  return `<div class="seccion">
    <h2>Visita ${ronda.numero} — ${ronda.completados}/${ronda.total} beneficiarios visitados</h2>
    <div class="ronda-mapa">${mapaHtmlDeRonda(mosaico, ronda)}</div>
    <div class="ronda-tabla">${tablaRonda(ronda)}</div>
    ${bloqueAnalisisIA(conclusiones)}
  </div>`;
}

function construirHtmlInforme(
  datos: DatosInformeTecnico,
  rondas: RondaCalculada[],
  mosaico: MosaicoMapa | null,
  conclusionesPorRonda: Map<number, string>
): string {
  const variante: MembreteVariante = datos.rolUsuario === 'interventor' ? 'interventoria' : 'ejecucion';
  const tituloRol = ETIQUETA_ROL[datos.rolUsuario] || 'Dashboard';
  const fechaHoraGeneracion = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Informe de Visitas — ${escapeHtml(datos.tecnicoNombre)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    body { font-family: 'Arial Narrow', Arial, sans-serif; color: #2d3436; }
    .doc-titulo { text-align: center; border-bottom: 2px solid #1B5E20; padding-bottom: 6px; margin-bottom: 4px; }
    .doc-titulo h1 { color: #1B5E20; font-size: 15pt; }
    .doc-subtitulo { text-align: center; color: #555; font-size: 9pt; margin-bottom: 18px; }
    /* Sin break-inside:avoid: con hasta 32 filas + mapa, la sección casi
       siempre supera el alto de una página — forzar "no partir" empujaba
       el bloque entero a la página siguiente y dejaba la anterior en
       blanco. Mejor dejar que fluya: la tabla pagina sola (el <thead> se
       repite) y el mapa ya cabe siempre en una sola página (ver límites de
       tamaño en informeTecnicoPdf.service.ts). */
    .seccion { margin-top: 22px; }
    .seccion h2 { color: #1B5E20; font-size: 12.5pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; margin-bottom: 10px; break-after: avoid; }
    .ronda-mapa { margin-bottom: 12px; break-inside: avoid; }
    .ronda-tabla { width: 100%; }
    table.tabla-reporte { width: 100%; border-collapse: collapse; font-size: 8pt; }
    table.tabla-reporte th { background: #1B5E20; color: #fff; text-align: left; padding: 4px 6px; }
    table.tabla-reporte td { padding: 3px 6px; border-bottom: 1px solid #e5e5e5; }
    table.tabla-reporte tr:nth-child(even) td { background: #f8f9fa; }
    .no-data { font-size: 9.5pt; color: #b2bec3; font-style: italic; }
    .analisis-ia { margin-top: 10px; padding: 6px 10px; background: #f4f8f4; border-left: 3px solid #1B5E20; border-radius: 4px; }
    .analisis-ia p { font-size: 8.5pt; color: #3d4a3d; line-height: 1.45; }
    .analisis-ia p + p { margin-top: 6px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 9pt; color: #b2bec3; }
  </style>
</head>
<body>
  ${membreteAperturaHtml(variante)}

  <div class="doc-titulo"><h1>Informe de Visitas — ${escapeHtml(datos.tecnicoNombre)}</h1></div>
  <div class="doc-subtitulo">
    ${datos.tecnicoCedula ? `C.C. ${escapeHtml(datos.tecnicoCedula)} · ` : ''}Generado por ${escapeHtml(datos.nombreUsuario)} (${tituloRol}) · ${fechaHoraGeneracion}
  </div>

  ${rondas.map((r) => bloqueRonda(r, mosaico, conclusionesPorRonda.get(r.numero))).join('')}

  <div class="footer">
    <p>Informe generado automáticamente por GEODAILY el ${fechaHoraGeneracion}</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

/** Abre un PDF ya generado con el visor del sistema; si no hay visor, ofrece compartirlo. Mismo patrón que dashboardPdf.service.ts. */
async function abrirPdf(uri: string): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/pdf',
      });
      return;
    } catch (e) {
      console.warn('[Informe Técnico PDF] Sin visor de PDF instalado, se ofrece compartir:', e);
    }
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } else {
    Alert.alert('No se pudo abrir el PDF', 'No hay un lector de PDF instalado en este dispositivo.');
  }
}

/**
 * Genera el informe PDF de visitas de un técnico (una o varias rondas) y lo
 * abre/comparte de inmediato. Si hay internet, antes de armar el PDF
 * descarga el mapa real y pide a la IA las conclusiones de cada ronda
 * incluida; si algo de eso falla, esa parte simplemente se omite — nunca se
 * interrumpe la generación del PDF.
 */
export async function generarYAbrirInformeTecnico(datos: DatosInformeTecnico): Promise<void> {
  const rondas = calcularRondas(datos);
  const [mosaico, conclusionesPorRonda] = await Promise.all([
    obtenerMosaicoBase(),
    recolectarConclusiones(datos.tecnicoNombre, rondas),
  ]);
  const html = construirHtmlInforme(datos, rondas, mosaico, conclusionesPorRonda);
  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `Informe_Visitas_${datos.tecnicoNombre.replace(/\s+/g, '_')}_${fechaArchivo}.pdf`;
  const dir = uri.substring(0, uri.lastIndexOf('/'));
  const destino = `${dir}/${nombreArchivo}`;

  let uriFinal = uri;
  try {
    await FileSystem.moveAsync({ from: uri, to: destino });
    uriFinal = destino;
  } catch (e) {
    console.warn('[Informe Técnico PDF] No se pudo renombrar el archivo, se usa el nombre original:', e);
  }

  await abrirPdf(uriFinal);
}
