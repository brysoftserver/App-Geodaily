// ============================================================
// GEODAILY — Servicio de PDF Local (expo-print)
// Genera el PDF directamente en el dispositivo con TODAS
// las evidencias incluidas: fotos reales redimensionadas,
// firmas, sello de verificación biométrica.
// ============================================================

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Formulario, FotoGeotag } from '../types';
import { formatFecha, formatCoordenadas } from '../utils/formatters';
import {
  construirSeccionesEncuesta,
  SeccionResuelta,
} from '../utils/encuestaSchema';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss } from '../utils/membrete';

/**
 * Generar PDF local con fotos, firmas y huella embebidas
 */
export const generarPDFLocal = async (
  formulario: Formulario
): Promise<string | null> => {
  try {
    // 1. Convertir fotos (file:// URIs) a base64 para embedir en HTML
    const fotosHtml = await convertirFotosAHTML(formulario.fotos || []);

    // 2. Preparar firmas (ya son base64 data URIs)
    const firmaBenefHtml = formulario.firma_beneficiario
      ? `<div class="firma-item">
           <p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(formulario.beneficiario.nombre)}</strong> (C.C. ${escapeHtml(formulario.beneficiario.cedula || '—')})</p>
           <img src="${formulario.firma_beneficiario}" alt="Firma del beneficiario" class="firma-img" />
         </div>`
      : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

    const firmaTecHtml = formulario.firma_tecnico
      ? `<div class="firma-item">
           <p class="evidencia-label">🖊️ Firma del Técnico en Terreno — <strong>${escapeHtml(formulario.tecnico.nombre)}</strong> (C.C. ${escapeHtml(formulario.tecnico.cedula || '—')})</p>
           <img src="${formulario.firma_tecnico}" alt="Firma del técnico" class="firma-img" />
         </div>`
      : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

    // 3. Generar sello de verificación biométrica (con gráfico de huella SVG)
    const selloBiometricoHtml = formulario.huella_beneficiario
      ? generarSelloBiometrico(formulario.beneficiario.nombre)
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Certificación biométrica del técnico</p><p class="no-data">No registrada</p></div>`;

    // 4. Construir HTML completo según el tipo de formulario
    let html: string;
    if (formulario.tipo === 'caracterizacion' && (formulario as any).caracterizacion_nueva) {
      html = construirHTMLCaracterizacion(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
    } else {
      html = construirHTML(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
    }

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
    try {
      // Leer la foto a máxima calidad — el espacio no es problema
      // Se redimensiona solo a 1200px para evitar PDFs monstruosos,
      // pero con calidad 0.9 para mantener nitidez
      const resultado = await manipulateAsync(
        foto.uri,
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
      // Fallback: intentar leer la foto sin redimensionar
      try {
        const base64 = await FileSystem.readAsStringAsync(foto.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const dataUri = `data:image/jpeg;base64,${base64}`;
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
  const gr = form.georeferencia;
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
  ${membreteAperturaHtml()}

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
function construirHTMLCaracterizacion(
  form: Formulario,
  fotosHtml: string,
  firmaBenefHtml: string,
  firmaTecHtml: string,
  huellaHtml: string
): string {
  const c = (form as any).caracterizacion_nueva || {};

  // Las 52 preguntas oficiales vienen del esquema canónico compartido
  // (src/utils/encuestaSchema.ts), el mismo que usa la pantalla de
  // "Detalle del Formulario". Así el PDF y la app nunca divergen.
  const seccionesEncuesta = construirSeccionesEncuesta(c, form);

  // Bloque pregunta+respuesta (siempre se imprime — la encuesta completa)
  const q = (num: string, texto: string, respuesta?: string | null) => `
    <div class="q">
      <div class="q-t">${num}. ${escapeHtml(texto)}</div>
      <div class="q-a">${respuesta ? escapeHtml(respuesta) : '—'}</div>
    </div>`;

  /** Renderiza una sección resuelta del esquema compartido */
  const renderSeccion = (sec: SeccionResuelta): string => {
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
    </div>`)
      .join('');
    return `
    <div class="section">
      <h2>${escapeHtml(sec.titulo)}</h2>
      <div class="cols">${filas}</div>
    </div>`;
  };

  /** HTML de todas las secciones de la encuesta, en orden oficial */
  const encuestaHtml = seccionesEncuesta.map(renderSeccion).join('');

  // ---- Ubicación GPS del formulario + Clima en el momento de la visita ----
  const clima = (form.clima as any)?.actual;
  const ubicacionClimaHtml = `
    <div class="section">
      <h2>📍 UBICACIÓN Y CONDICIONES AMBIENTALES DE LA VISITA</h2>
      <div class="cols">
        ${q('•', 'Latitud', form.coordenadas?.latitud ? form.coordenadas.latitud.toFixed(6) : '')}
        ${q('•', 'Longitud', form.coordenadas?.longitud ? form.coordenadas.longitud.toFixed(6) : '')}
        ${q('•', 'Altitud', form.coordenadas?.altitud ? `${form.coordenadas.altitud.toFixed(1)} m` : '')}
        ${q('•', 'Precisión GPS', form.coordenadas?.precision_gps ? `±${form.coordenadas.precision_gps} m` : '')}
        ${clima ? q('•', 'Lugar', clima.ubicacion?.nombre) : ''}
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
  ${membreteAperturaHtml()}

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

  <!-- GEOREFERENCIA (si existe) -->
  ${form.georeferencia ? `
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
