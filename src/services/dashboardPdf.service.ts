// ============================================================
// GEODAILY — Reporte PDF del Dashboard (supervisión/interventoría/gerencia)
// ============================================================
// Genera un PDF de una sola vez con el resumen completo del Dashboard:
// tarjetas de métricas, gráfica + tabla de visitas por técnico, gráfica +
// tabla de visitas por corregimiento y la tabla de actividades recientes.
// Lleva el membrete institucional oficial (igual que los PDF de
// formularios) — ejecución (ACPR) para supervisor/gerente, interventoría
// (ASEMP) para interventor — y la fecha/hora exacta de generación.
//
// Las gráficas se reconstruyen como SVG inline dentro del HTML (mismo
// patrón que el sello biométrico de pdfLocal.service.ts) en vez de
// capturar los componentes react-native-chart-kit de la pantalla: eso
// evitaba añadir una dependencia nueva de captura de vistas
// (react-native-view-shot), que al ser un módulo nativo habría exigido un
// build de EAS nuevo en vez de poder llegar por actualización OTA.

import { Platform, Alert } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { Formulario } from '../types';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss, MembreteVariante } from '../utils/membrete';
import { escapeHtml } from './pdfLocal.service';
import {
  CORREGIMIENTOS,
  COLOR_CORREGIMIENTO,
  NOMBRE_VISIBLE_CORREGIMIENTO,
  resolverCorregimiento,
  normalizarVereda,
} from '../utils/corregimientos';

export interface DatosReporteDashboard {
  formularios: Formulario[];
  /** Rol de quien genera el reporte — decide el membrete y el título. */
  rolUsuario: 'supervisor' | 'interventor' | 'gerente' | string;
  nombreUsuario: string;
}

const ETIQUETA_ROL: Record<string, string> = {
  supervisor: 'Supervisión',
  interventor: 'Interventoría',
  gerente: 'Gerencia',
};

const COLOR_SIN_CORREGIMIENTO = '#9E9E9E';

// --- Gráficas reconstruidas como SVG inline ---

function construirBarrasSVG(datos: { nombre: string; total: number }[]): string {
  if (datos.length === 0) return '<p class="no-data">Aún no hay visitas registradas por técnico.</p>';

  const anchoEtiqueta = 150;
  const anchoBarraMax = 320;
  const anchoTotal = anchoEtiqueta + anchoBarraMax + 50;
  const altoFila = 24;
  const alto = datos.length * altoFila + 8;
  const max = Math.max(...datos.map((d) => d.total), 1);

  const filas = datos
    .map((d, i) => {
      const y = i * altoFila + altoFila / 2;
      const anchoBarra = Math.max(2, (d.total / max) * anchoBarraMax);
      return `
      <text x="0" y="${y + 4}" font-size="10.5" fill="#2d3436">${escapeHtml(d.nombre)}</text>
      <rect x="${anchoEtiqueta}" y="${y - 8}" width="${anchoBarra.toFixed(1)}" height="16" rx="3" fill="#1565C0" />
      <text x="${anchoEtiqueta + anchoBarra + 8}" y="${y + 4}" font-size="10.5" font-weight="bold" fill="#2d3436">${d.total}</text>`;
    })
    .join('');

  return `<svg width="${anchoTotal}" height="${alto}" viewBox="0 0 ${anchoTotal} ${alto}" xmlns="http://www.w3.org/2000/svg">${filas}</svg>`;
}

function construirTortaSVG(datos: { nombre: string; total: number; color: string }[]): string {
  const total = datos.reduce((acc, d) => acc + d.total, 0);
  if (total === 0) return '<p class="no-data">Aún no hay visitas registradas por corregimiento.</p>';

  const cx = 90;
  const cy = 90;
  const r = 82;
  const conDatos = datos.filter((d) => d.total > 0);

  const polar = (angulo: number) => {
    const rad = ((angulo - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  let acumulado = 0;
  const porciones = conDatos
    .map((d) => {
      if (conDatos.length === 1) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${d.color}" />`;
      }
      const inicio = acumulado;
      const fin = acumulado + (d.total / total) * 360;
      acumulado = fin;
      const p1 = polar(inicio);
      const p2 = polar(fin);
      const largeArc = fin - inicio > 180 ? 1 : 0;
      return `<path d="M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z" fill="${d.color}" stroke="#ffffff" stroke-width="1.5" />`;
    })
    .join('');

  return `<svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">${porciones}</svg>`;
}

// --- Tablas ---

function tablaTecnicos(datos: { nombre: string; total: number }[]): string {
  if (datos.length === 0) return '';
  const filas = datos
    .map((d) => `<tr><td>${escapeHtml(d.nombre)}</td><td style="text-align:right">${d.total}</td></tr>`)
    .join('');
  return `<table class="tabla-reporte"><thead><tr><th>Técnico</th><th style="text-align:right">Visitas</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function tablaCorregimientos(datos: { nombre: string; total: number; color: string }[]): string {
  const total = datos.reduce((acc, d) => acc + d.total, 0);
  const filas = datos
    .map(
      (d) => `<tr>
      <td><span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${d.color};margin-right:6px;"></span>${escapeHtml(d.nombre)}</td>
      <td style="text-align:right">${d.total}</td>
      <td style="text-align:right">${total > 0 ? ((d.total / total) * 100).toFixed(0) : 0}%</td>
    </tr>`
    )
    .join('');
  return `<table class="tabla-reporte"><thead><tr><th>Corregimiento</th><th style="text-align:right">Visitas</th><th style="text-align:right">%</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function tablaActividades(formularios: Formulario[]): string {
  if (formularios.length === 0) {
    return '<p class="no-data">No hay actividades registradas todavía.</p>';
  }
  const filas = formularios
    .slice(0, 30)
    .map((f) => {
      const fecha = f.created_at ? new Date(f.created_at).toLocaleDateString('es-CO') : '—';
      const tipo = f.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Encuesta Socioambiental';
      const corregimiento = resolverCorregimiento(f);
      return `<tr>
        <td>${fecha}</td>
        <td>${tipo}</td>
        <td>${escapeHtml(f.tecnico?.nombre || '—')}</td>
        <td>${escapeHtml(f.beneficiario?.nombre || '—')}</td>
        <td>${escapeHtml(f.beneficiario?.vereda || '—')}</td>
        <td>${corregimiento ? escapeHtml(NOMBRE_VISIBLE_CORREGIMIENTO[corregimiento]) : 'Sin determinar'}</td>
      </tr>`;
    })
    .join('');
  return `<table class="tabla-reporte">
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Técnico</th><th>Beneficiario</th><th>Vereda</th><th>Corregimiento</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

// --- Construcción del HTML completo ---

function construirHtmlReporte(datos: DatosReporteDashboard): string {
  const { formularios, rolUsuario, nombreUsuario } = datos;
  const variante: MembreteVariante = rolUsuario === 'interventor' ? 'interventoria' : 'ejecucion';
  const tituloRol = ETIQUETA_ROL[rolUsuario] || 'Dashboard';

  const encuestaSocioambiental = formularios.filter((f) => f.tipo === 'caracterizacion').length;
  const visitasTecnicas = formularios.filter((f) => f.tipo === 'visita_tecnica').length;
  const veredasUnicas = new Set(
    formularios.map((f) => normalizarVereda(f.beneficiario?.vereda)).filter((v): v is string => !!v)
  ).size;

  const conteoTecnico = new Map<string, number>();
  formularios.forEach((f) => {
    const nombre = f.tecnico?.nombre?.trim();
    if (!nombre) return;
    conteoTecnico.set(nombre, (conteoTecnico.get(nombre) || 0) + 1);
  });
  const porTecnico = Array.from(conteoTecnico.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);

  const conteoCorregimiento = new Map<string, number>();
  CORREGIMIENTOS.forEach((c) => conteoCorregimiento.set(c, 0));
  let sinCorregimiento = 0;
  formularios.forEach((f) => {
    const c = resolverCorregimiento(f);
    if (c) conteoCorregimiento.set(c, (conteoCorregimiento.get(c) || 0) + 1);
    else sinCorregimiento++;
  });
  const porCorregimiento = CORREGIMIENTOS.map((c) => ({
    nombre: NOMBRE_VISIBLE_CORREGIMIENTO[c],
    total: conteoCorregimiento.get(c) || 0,
    color: COLOR_CORREGIMIENTO[c],
  }));
  if (sinCorregimiento > 0) {
    porCorregimiento.push({ nombre: 'Sin corregimiento', total: sinCorregimiento, color: COLOR_SIN_CORREGIMIENTO });
  }

  const actividades = [...formularios].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const fechaHoraGeneracion = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte Dashboard — ${tituloRol}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${membreteCss()}
    body { font-family: 'Arial Narrow', Arial, sans-serif; color: #2d3436; }
    .doc-titulo { text-align: center; border-bottom: 2px solid #1B5E20; padding-bottom: 6px; margin-bottom: 4px; }
    .doc-titulo h1 { color: #1B5E20; font-size: 15pt; }
    .doc-subtitulo { text-align: center; color: #555; font-size: 9pt; margin-bottom: 18px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
    .metric-card { background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; padding: 10px 12px; break-inside: avoid; }
    .metric-titulo { font-size: 8.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.3px; }
    .metric-valor { font-size: 20pt; font-weight: bold; color: #1B5E20; margin-top: 2px; }
    .seccion { margin-top: 22px; break-inside: avoid; }
    .seccion h2 { color: #1B5E20; font-size: 12.5pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; margin-bottom: 10px; }
    table.tabla-reporte { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 9pt; }
    table.tabla-reporte th { background: #1B5E20; color: #fff; text-align: left; padding: 5px 8px; }
    table.tabla-reporte td { padding: 4px 8px; border-bottom: 1px solid #e5e5e5; }
    table.tabla-reporte tr:nth-child(even) td { background: #f8f9fa; }
    .no-data { font-size: 10pt; color: #b2bec3; font-style: italic; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 9pt; color: #b2bec3; }
  </style>
</head>
<body>
  ${membreteAperturaHtml(variante)}

  <div class="doc-titulo"><h1>Reporte de Dashboard — ${tituloRol}</h1></div>
  <div class="doc-subtitulo">Generado por ${escapeHtml(nombreUsuario)} (${tituloRol}) · ${fechaHoraGeneracion}</div>

  <div class="grid-3">
    <div class="metric-card">
      <div class="metric-titulo">Encuesta Socioambiental</div>
      <div class="metric-valor">${encuestaSocioambiental}</div>
    </div>
    <div class="metric-card">
      <div class="metric-titulo">Visitas Técnicas</div>
      <div class="metric-valor">${visitasTecnicas}</div>
    </div>
    <div class="metric-card">
      <div class="metric-titulo">Veredas Visitadas</div>
      <div class="metric-valor">${veredasUnicas}</div>
    </div>
  </div>

  <div class="seccion">
    <h2>Visitas por técnico</h2>
    ${construirBarrasSVG(porTecnico)}
    ${tablaTecnicos(porTecnico)}
  </div>

  <div class="seccion">
    <h2>Visitas por corregimiento</h2>
    ${construirTortaSVG(porCorregimiento)}
    ${tablaCorregimientos(porCorregimiento)}
  </div>

  <div class="seccion">
    <h2>Actividades recientes</h2>
    ${tablaActividades(actividades)}
  </div>

  <div class="footer">
    <p>Reporte generado automáticamente por GEODAILY el ${fechaHoraGeneracion}</p>
  </div>
  ${membreteCierreHtml()}
</body>
</html>`;
}

/** Abre un PDF ya generado con el visor del sistema; si no hay visor, ofrece compartirlo. Mismo patrón que FormularioDetailScreen.tsx. */
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
      console.warn('[PDF Dashboard] Sin visor de PDF instalado, se ofrece compartir:', e);
    }
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } else {
    Alert.alert('No se pudo abrir el PDF', 'No hay un lector de PDF instalado en este dispositivo.');
  }
}

/** Genera el reporte PDF del Dashboard y lo abre/comparte de inmediato. */
export async function generarYAbrirReporteDashboard(datos: DatosReporteDashboard): Promise<void> {
  const html = construirHtmlReporte(datos);
  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

  const tituloRol = ETIQUETA_ROL[datos.rolUsuario] || 'Dashboard';
  const fechaArchivo = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `Reporte_Dashboard_${tituloRol.replace(/\s+/g, '_')}_${fechaArchivo}.pdf`;
  const dir = uri.substring(0, uri.lastIndexOf('/'));
  const destino = `${dir}/${nombreArchivo}`;

  let uriFinal = uri;
  try {
    await FileSystem.moveAsync({ from: uri, to: destino });
    uriFinal = destino;
  } catch (e) {
    console.warn('[PDF Dashboard] No se pudo renombrar el archivo, se usa el nombre original:', e);
  }

  await abrirPdf(uriFinal);
}
