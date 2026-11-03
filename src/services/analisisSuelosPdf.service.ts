// ============================================================
// GEODAILY — Informe PDF del Análisis de Suelos (con IA)
// ============================================================
// Dos variantes: por técnico (resultado de cada beneficiario) y comparativo
// de todos los técnicos. El texto de la IA llega del backend; si no está
// disponible el PDF se genera igual, solo sin esa parte.
// ============================================================

import { Platform } from 'react-native';
import { avisar } from '../utils/dialogos';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss, MembreteVariante } from '../utils/membrete';
import { escapeHtml } from './pdfLocal.service';
import { abrirPdf } from './informeTecnicoPdf.service';
import { descargarHtmlComoPdfWeb } from '../utils/printWeb';
import {
  InformeSuelosTecnico,
  InformeSuelosTecnicos,
  pedirInformeSuelos,
} from './analisisSuelos.service';

const VERDE = '#2E7D32';
const ROJO = '#C62828';
const PALETA = ['#1B5E20', '#1565C0', '#EF6C00', '#6A1B9A', '#00838F', '#AD1457', '#827717', '#4E342E', '#37474F', '#C62828'];

/** Torta en SVG: [{ etiqueta, valor, color }] */
function tortaSvg(datos: { valor: number; color: string }[], tamano = 120): string {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  const r = tamano / 2;
  if (total <= 0) return `<svg width="${tamano}" height="${tamano}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="#e0e0e0"/></svg>`;
  const con = datos.filter((d) => d.valor > 0);
  if (con.length === 1) return `<svg width="${tamano}" height="${tamano}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="${con[0].color}"/></svg>`;
  let ang = -Math.PI / 2;
  const trozos = con.map((d) => {
    const fin = ang + (d.valor / total) * Math.PI * 2;
    const p = (a: number) => `${(r + (r - 2) * Math.cos(a)).toFixed(2)},${(r + (r - 2) * Math.sin(a)).toFixed(2)}`;
    const path = `M${r},${r} L${p(ang)} A${r - 2},${r - 2} 0 ${fin - ang > Math.PI ? 1 : 0} 1 ${p(fin)} Z`;
    ang = fin;
    return `<path d="${path}" fill="${d.color}"/>`;
  });
  return `<svg width="${tamano}" height="${tamano}" viewBox="0 0 ${tamano} ${tamano}">${trozos.join('')}</svg>`;
}

const leyenda = (items: { etiqueta: string; valor: number; color: string }[]) =>
  items
    .map(
      (i) => `<div class="ley"><span class="pto" style="background:${i.color}"></span>${escapeHtml(i.etiqueta)}: <b>${i.valor}</b></div>`
    )
    .join('');

const parrafos = (texto: string) =>
  texto
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('');

const bloqueIA = (analisis: string | null) =>
  analisis
    ? `<div class="analisis-ia"><div class="analisis-titulo">Análisis con IA</div>${parrafos(analisis)}</div>`
    : '<p class="no-data">No se pudo generar el análisis con IA (sin conexión con el servicio). Los datos del informe sí están completos.</p>';

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  ${membreteCss()}
  body { font-family: 'Arial Narrow', Arial, sans-serif; color: #2d3436; }
  .doc-titulo { text-align: center; border-bottom: 2px solid #1B5E20; padding-bottom: 6px; margin-bottom: 4px; }
  .doc-titulo h1 { color: #1B5E20; font-size: 15pt; }
  .doc-subtitulo { text-align: center; color: #555; font-size: 9pt; margin-bottom: 16px; }
  h2 { color: #1B5E20; font-size: 12pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin: 16px 0 8px; break-after: avoid; }
  .tortas { display: flex; gap: 24px; justify-content: space-around; margin-bottom: 8px; }
  .torta { text-align: center; font-size: 8.5pt; }
  .torta .t { font-weight: bold; color: #1B5E20; margin-bottom: 4px; }
  .ley { font-size: 8pt; text-align: left; margin-top: 2px; }
  .pto { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #1B5E20; color: #fff; text-align: left; padding: 4px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f9fa; }
  tr { break-inside: avoid; }
  .ok { color: ${VERDE}; font-weight: bold; } .falta { color: ${ROJO}; font-weight: bold; }
  .no-data { font-size: 9pt; color: #999; font-style: italic; margin-top: 8px; }
  .analisis-ia { margin-top: 10px; padding: 6px 10px; background: #f4f8f4; border-left: 3px solid #1B5E20; border-radius: 4px; }
  .analisis-titulo { font-weight: bold; font-size: 9pt; color: #1B5E20; margin-bottom: 3px; }
  .analisis-ia p { font-size: 8.5pt; color: #3d4a3d; line-height: 1.45; }
  .analisis-ia p + p { margin-top: 6px; }
  .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 9pt; color: #999; }
`;

function envolver(titulo: string, subtitulo: string, cuerpo: string, variante: MembreteVariante): string {
  const fecha = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(titulo)}</title><style>${CSS}</style></head>
<body>
  ${membreteAperturaHtml(variante)}
  <div class="doc-titulo"><h1>${escapeHtml(titulo)}</h1></div>
  <div class="doc-subtitulo">${escapeHtml(subtitulo)} · ${fecha}</div>
  ${cuerpo}
  <div class="footer">Informe generado automáticamente por GEODAILY el ${fecha}</div>
  ${membreteCierreHtml()}
</body></html>`;
}

function htmlTecnico(d: InformeSuelosTecnico, variante: MembreteVariante, generadoPor: string): string {
  const faltan = Math.max(d.asignados - d.subidos, 0);
  const cuerpo = `
    <div class="tortas"><div class="torta"><div class="t">Análisis subidos de sus beneficiarios</div>
      ${tortaSvg([{ valor: d.subidos, color: VERDE }, { valor: faltan, color: ROJO }])}
      ${leyenda([{ etiqueta: 'Subidos', valor: d.subidos, color: VERDE }, { etiqueta: 'Faltan', valor: faltan, color: ROJO }])}
    </div></div>
    <h2>Análisis</h2>${bloqueIA(d.analisis)}
    ${d.sinLeer ? `<p class="no-data">${d.sinLeer} PDF aún no se han leído con la IA (se leen por tandas): genera el informe de nuevo para completarlos.</p>` : ''}
    <h2>Resultado por beneficiario (${d.subidos}/${d.asignados})</h2>
    <table><thead><tr><th>Beneficiario</th><th>Cédula</th><th>Vereda</th><th>Estado</th><th>Resultado del laboratorio</th></tr></thead><tbody>
      ${d.beneficiarios
        .map(
          (b) => `<tr><td>${escapeHtml(b.nombre)}</td><td>${escapeHtml(b.cedula)}</td><td>${escapeHtml(b.vereda)}</td>
          <td class="${b.tieneArchivo ? 'ok' : 'falta'}">${b.tieneArchivo ? 'Subido' : 'Pendiente'}</td>
          <td>${b.tieneArchivo ? escapeHtml(b.resultado || '—') : '—'}</td></tr>`
        )
        .join('')}
    </tbody></table>`;
  return envolver(
    `Análisis de Suelos — ${d.tecnico.nombre}`,
    `Generado por ${generadoPor}`,
    cuerpo,
    variante
  );
}

function htmlTecnicos(d: InformeSuelosTecnicos, variante: MembreteVariante, generadoPor: string): string {
  const porTecnico = d.tecnicos.map((t, i) => ({ etiqueta: t.nombre, valor: t.subidos, color: PALETA[i % PALETA.length] }));
  const faltan = Math.max(d.meta - d.total, 0);
  const cuerpo = `
    <div class="tortas">
      <div class="torta"><div class="t">Análisis por técnico (máx. ${d.meta})</div>${tortaSvg(porTecnico)}${leyenda(porTecnico)}</div>
      <div class="torta"><div class="t">Realizados vs. faltantes (meta ${d.meta})</div>
        ${tortaSvg([{ valor: d.total, color: VERDE }, { valor: faltan, color: ROJO }])}
        ${leyenda([{ etiqueta: 'Realizados', valor: d.total, color: VERDE }, { etiqueta: 'Faltan', valor: faltan, color: ROJO }])}
      </div>
    </div>
    <h2>Análisis</h2>${bloqueIA(d.analisis)}
    <h2>Avance por técnico</h2>
    <table><thead><tr><th>Técnico</th><th>Beneficiarios asignados</th><th>Análisis subidos</th><th>Pendientes</th></tr></thead><tbody>
      ${d.tecnicos
        .map((t) => `<tr><td>${escapeHtml(t.nombre)}</td><td>${t.asignados}</td><td class="ok">${t.subidos}</td><td class="falta">${Math.max(t.asignados - t.subidos, 0)}</td></tr>`)
        .join('')}
    </tbody></table>`;
  return envolver('Análisis de Suelos — Avance por técnico', `Generado por ${generadoPor}`, cuerpo, variante);
}

/**
 * Pide los datos y el análisis al backend, arma el PDF y lo abre.
 * `tecnico` = usuario del técnico; sin él, informe comparativo de todos.
 */
export async function generarYAbrirInformeSuelos(opts: {
  tecnico?: string;
  rolUsuario: string;
  nombreUsuario: string;
}): Promise<void> {
  try {
    const datos = await pedirInformeSuelos(opts.tecnico);
    const variante: MembreteVariante = opts.rolUsuario === 'interventor' ? 'interventoria' : 'ejecucion';
    const html =
      datos.alcance === 'tecnico'
        ? htmlTecnico(datos, variante, opts.nombreUsuario)
        : htmlTecnicos(datos, variante, opts.nombreUsuario);

    const fecha = new Date().toISOString().slice(0, 10);
    const base = datos.alcance === 'tecnico' ? `Analisis_Suelos_${datos.tecnico.nombre.replace(/\s+/g, '_')}` : 'Analisis_Suelos_Tecnicos';
    // En web expo-print solo hace window.print() sobre la pantalla abierta:
    // ahí el PDF se genera y se descarga directamente.
    if (Platform.OS === 'web') {
      await descargarHtmlComoPdfWeb(html, `${base}_${fecha}.pdf`);
      return;
    }

    const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
    const destino = `${uri.substring(0, uri.lastIndexOf('/'))}/${base}_${fecha}.pdf`;
    let final = uri;
    try {
      await FileSystem.moveAsync({ from: uri, to: destino });
      final = destino;
    } catch {
      // se usa el nombre original
    }
    await abrirPdf(final);
  } catch (error: any) {
    console.warn('[Suelos PDF] Error:', error?.message || error);
    avisar('No se pudo generar el informe', 'Verifica tu conexión a internet e inténtalo de nuevo.');
  }
}
