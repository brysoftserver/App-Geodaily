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
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Huella Biométrica</p><p class="no-data">No registrada</p></div>`;

    // 4. Construir HTML completo según el tipo de formulario
    let html: string;
    if (formulario.tipo === 'caracterizacion' && (formulario as any).caracterizacion_nueva) {
      html = construirHTMLCaracterizacion(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
    } else {
      html = construirHTML(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);
    }

    // 5. Generar PDF con expo-print
    const { uri } = await Print.printToFileAsync({
      html,
      width: 595.28, // A4 width in points
      height: 841.89, // A4 height
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
            <div class="huella-sello-label">Registro Biométrico</div>
          </div>
        </div>
        <div class="huella-sello-body">
          <table class="huella-sello-table">
            <tr><td class="huella-sello-label-cell">Beneficiario:</td><td class="huella-sello-value-cell"><strong>${escapeHtml(nombreBeneficiario)}</strong></td></tr>
            <tr><td class="huella-sello-label-cell">Método:</td><td class="huella-sello-value-cell">Autenticación biométrica (huella dactilar)</td></tr>
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
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      margin: 32px;
      color: #2d3436;
      line-height: 1.5;
    }
    /* --- HEADER --- */
    .header {
      text-align: center;
      border-bottom: 3px solid #1B5E20;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .header h1 { color: #1B5E20; font-size: 22px; margin-bottom: 2px; }
    .header p { color: #636e72; font-size: 12px; }
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
      width: 100%;
      height: auto;
      max-height: 200px;
      object-fit: cover;
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
      max-width: 100%;
      max-height: 80px;
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
      .grid-2 { break-inside: avoid; }
      .card { break-inside: avoid; }
      .photo-grid { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Formulario de Visita Técnica</h1>
    <p><strong>ID:</strong> ${escapeHtml(form.id)} · <strong>Fecha:</strong> ${formatFecha(form.created_at)}</p>
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

  // Sub-componentes de la Encuesta Social AgroAmbiental (texto oficial)
  const cs = c.componente_social || {};
  const cf = c.caracterizacion_finca || {};
  const cp = c.componente_productivo || {};
  const asuelo = c.analisis_suelo || {};
  const ca = c.componente_agroambiental || {};
  const rec = c.recomendaciones || {};
  const aco = c.acompaniamiento || {};

  // Bloque pregunta+respuesta (siempre se imprime — la encuesta completa)
  const q = (num: string, texto: string, respuesta?: string | null) => `
    <div class="q">
      <div class="q-t">${num}. ${escapeHtml(texto)}</div>
      <div class="q-a">${respuesta ? escapeHtml(respuesta) : '—'}</div>
    </div>`;

  // Respuesta + "Especifique" opcional en la misma celda
  const conOtro = (val?: string, otro?: string) =>
    val ? (otro ? `${val} — ${otro}` : val) : '';

  const seccion = (titulo: string, contenido: string) => `
    <div class="section">
      <h2>${titulo}</h2>
      <div class="cols">${contenido}</div>
    </div>`;

  // ---- Encabezado oficial ----
  const datosGenerales = `
    ${q('•', 'Fecha', c.fecha || formatFecha(form.created_at))}
    ${q('•', 'Municipio', c.municipio)}
    ${q('•', 'Vereda', c.vereda)}
    ${q('•', 'Nombre del productor', c.productor_nombre)}
    ${q('•', 'Edad (años)', c.edad)}
    ${q('•', 'Sexo', conOtro(c.sexo, c.sexo_otro))}
    ${q('•', 'Documento (C.C.)', c.documento)}
    ${q('•', 'Teléfono', c.telefono)}
    ${q('•', 'Técnico responsable', c.tecnico_responsable || form.tecnico?.nombre)}
    ${q('•', 'Ubicación del predio', c.ubicacion_predio)}
  `;

  // ---- COMPONENTE SOCIAL (1-17) ----
  const componenteSocial = seccion('COMPONENTE SOCIAL', [
    q('1', 'Se reconoce como:', conOtro(cs.reconocimiento, cs.reconocimiento_otro)),
    q('2', 'Nivel educativo del productor', cs.nivel_educativo),
    q('3', '¿Ha participado antes en Escuelas de Campo (ECA)?', cs.participo_eca),
    q('4', '¿Cuántas personas, incluyéndose usted, hacen parte de su núcleo familiar?', cs.personas_nucleo ? `${cs.personas_nucleo} personas` : ''),
    q('5', 'Principal fuente de ingresos', conOtro(cs.fuente_ingresos, cs.fuente_ingresos_otra)),
    q('6', '¿Cual es su ocupación secundaria?', conOtro(cs.ocupacion_secundaria, cs.ocupacion_secundaria_otro)),
    q('7', 'Participa en alguna organización o asociación', conOtro(cs.participa_organizacion, cs.organizacion_cual)),
    q('8', '¿A qué asociaciones u organizaciones se encuentra afiliado?', conOtro(cs.tipo_asociacion, cs.tipo_asociacion_otro)),
    q('9', '¿Cuál es el rol en la organización que está afiliado(a)?', cs.rol_asociacion),
    q('10', 'En donde está ubicada la vivienda principal de su núcleo familiar', conOtro(cs.vivienda_ubicacion, cs.vivienda_ubicacion_otra)),
    q('11', '¿Su vivienda cuenta con energía?', cs.energia_electrica),
    q('12', '¿Su vivienda cuenta con energía?', conOtro(cs.tipo_energia, cs.tipo_energia_otro)),
    q('13', '¿De dónde obtiene principalmente el agua para el consumo humano?', conOtro(cs.agua_consumo, cs.agua_consumo_otro)),
    q('14', '¿Cuenta con algunos de estos elementos? (respuesta multiple)', cs.elementos_tecnologicos),
    q('15', '¿Cuenta con señal de celular en su vivienda?', cs.senal_celular),
    q('16', '¿Quiénes trabajan en su finca?', conOtro(cs.quienes_trabajan, cs.quienes_trabajan_otro)),
    q('17', '¿Qué medio de transporte utiliza?', conOtro(cs.medio_transporte, cs.medio_transporte_otro)),
  ].join(''));

  // ---- CARACTERIZACION DE LA FINCA (18-26) ----
  const coordFinca = cf.latitud && cf.longitud
    ? `Lat: ${cf.latitud}  Lon: ${cf.longitud}${cf.altitud ? `  Alt: ${cf.altitud} m` : ''}`
    : '';
  const divisiones = [
    cf.division_bosque ? `Bosque: ${cf.division_bosque} ha` : '',
    cf.division_agricola ? `Agrícola: ${cf.division_agricola} ha` : '',
    cf.division_pecuaria ? `Pecuaria: ${cf.division_pecuaria} ha` : '',
    cf.division_instalaciones ? `Instalaciones: ${cf.division_instalaciones} ha` : '',
  ].filter(Boolean).join(' · ');
  const actividadesFinca = [
    conOtro(cf.actividades_finca, cf.actividades_finca_otro),
    cf.actividades_agricolas ? `Agrícolas: ${conOtro(cf.actividades_agricolas, cf.actividades_agricolas_otro)}` : '',
    cf.actividades_pecuarias ? `Pecuarias: ${conOtro(cf.actividades_pecuarias, cf.actividades_pecuarias_otro)}` : '',
  ].filter(Boolean).join(' | ');
  const caracterizacionFinca = seccion('CARACTERIZACION DE LA FINCA', [
    q('18', 'Nombre de la finca', cf.nombre_finca),
    q('19', 'Coordenada de la finca', coordFinca),
    q('20', '¿Cuál es el área total de la finca en hectáreas?', cf.area_total ? `${cf.area_total} ha` : ''),
    q('21', '¿Cómo está dividida en hectáreas?', divisiones),
    q('22', 'Medio de salida de productos al centro poblado más cercano', cf.medio_salida),
    q('23', 'Distancia aproximada del predio al centro poblado', cf.distancia_km ? `${cf.distancia_km} km` : ''),
    q('24', 'Observaciones de la descripción llegada al predio (desde cabecera municipal)', cf.distancia_observaciones),
    q('25', '¿Realiza aprovechamiento productivo de manera directa?', conOtro(cf.aprovechamiento_directo, cf.aprovechamiento_porque ? `Porque: ${cf.aprovechamiento_porque}` : '')),
    q('26', '¿Cuáles son las actividades que realiza en su finca?', actividadesFinca),
  ].join(''));

  // ---- COMPONENTE PRODUCTIVO (27-30) ----
  const componenteProductivo = seccion('COMPONENTE PRODUCTIVO', [
    q('27', '¿Cual es la actividad principal productiva de la finca?', conOtro(cp.actividad_principal, cp.actividad_principal_cual)),
    q('28', '¿El predio cuenta con acceso permanente al agua?', cp.acceso_agua),
    q('29', '¿Dispone de sistemas de riego?', cp.sistemas_riego),
    q('30', '¿Ha recibido asistencia técnica en los últimos dos años?', cp.asistencia_tecnica),
  ].join(''));

  // ---- SECCIÓN DE SUELO (31-41) ----
  const coordIntervencion = asuelo.intervencion_latitud && asuelo.intervencion_longitud
    ? `Lat: ${asuelo.intervencion_latitud}  Lon: ${asuelo.intervencion_longitud}${asuelo.intervencion_altitud ? `  Alt: ${asuelo.intervencion_altitud} m` : ''}`
    : '';
  const seccionSuelo = seccion('SECCIÓN DE SUELO', [
    q('31', 'Ubicación del área de intervención del proyecto', coordIntervencion),
    q('32', '¿Ha realizado alguna vez análisis de suelo en su predio?', asuelo.analisis_realizado),
    q('33', '¿Cuál es la textura predominante en el suelo? Selección multiple', asuelo.textura),
    q('34', '¿Qué coloración predomina en el suelo?', asuelo.color),
    q('35', '¿Qué tipo de drenaje hay en el suelo?', asuelo.drenaje),
    q('36', '¿Cuál es la profundidad efectiva del suelo?', asuelo.profundidad),
    q('37', '¿Existe alguna presencia de piedras o fragmentos rocosos?', asuelo.piedras),
    q('38', '¿Cuál es el estado de la compactación del suelo?', asuelo.compactacion),
    q('39', '¿Qué presencia de cobertura presenta el suelo?', asuelo.cobertura),
    q('40', '¿Se evidencia algún tipo de erosión en el suelo?', asuelo.erosion),
    q('41', '¿Cual es el grado de Pendiente del terreno?', asuelo.pendiente ? `${asuelo.pendiente} °` : ''),
  ].join(''));

  // ---- COMPONENTE AGROAMBIENTAL (42-49) ----
  const componenteAgro = seccion('COMPONENTE AGROAMBIENTAL', [
    q('42', '¿El predio presenta procesos de erosión?', ca.procesos_erosion),
    q('43', '¿Existen fuentes hídricas dentro o cerca del predio?', ca.fuentes_hidricas),
    q('44', '¿El predio cuenta con áreas de conservación o protección?', ca.areas_conservacion),
    q('45', '¿Realiza prácticas de conservación del suelo?', ca.practicas_conservacion),
    q('46', '¿Utiliza algún tipo agroquímico?', ca.uso_agroquimicos),
    q('47', '¿Qué tipo de agroquímicos utiliza?', conOtro(ca.tipo_agroquimicos, ca.tipo_agroquimicos_otro)),
    q('48', 'Mencione qué tipo de herbicidas utiliza', ca.herbicidas_cuales),
    q('49', '¿Realiza manejo de residuos de agroquímicos?', ca.manejo_residuos),
  ].join(''));

  // ---- RECOMENDACIONES DEL TÉCNICO (50-52) — ancho completo por ser texto largo ----
  const recomendacionesHtml = `
    <div class="section">
      <h2>RECOMENDACIONES DEL TÉCNICO</h2>
      <div class="q-full"><div class="q-t">50. Recomendaciones técnicas para el sistema productivo:</div>
      <div class="desc-detallada">${escapeHtml(rec.recomendaciones_tecnicas || '—')}</div></div>
      <div class="q-full"><div class="q-t">51. Compromisos adquiridos sobre el desarrollo del estado actual del terreno:</div>
      <div class="desc-detallada">${escapeHtml(rec.compromisos_productor || '—')}</div></div>
      <div class="q-full"><div class="q-t">52. Recomendaciones ambientales y de conservación:</div>
      <div class="desc-detallada">${escapeHtml(rec.recomendaciones_ambientales || '—')}</div></div>
    </div>`;

  // ---- DESARROLLO ACOMPAÑAMIENTO TECNICO (7 ítems oficiales) ----
  const itemAco = (num: string, texto: string, si?: boolean, no?: boolean, obs?: string, extra?: string) => `
    <div class="q">
      <div class="q-t">${num}. ${escapeHtml(texto)}</div>
      <div class="q-a">${si ? 'Sí' : no ? 'No' : '—'}${extra ? ` · ${escapeHtml(extra)}` : ''}${obs ? `<br/><em>Obs: ${escapeHtml(obs)}</em>` : ''}</div>
    </div>`;
  const geoAco = aco.georef_latitud && aco.georef_longitud
    ? `Lat: ${aco.georef_latitud}  Lon: ${aco.georef_longitud}${aco.georef_altitud ? `  Alt: ${aco.georef_altitud} m` : ''}`
    : '';
  const acompanamientoHtml = seccion('DESARROLLO ACOMPAÑAMIENTO TECNICO', [
    itemAco('1', 'Socialización de actividades del proyecto al productor, mediante presentación digital.', aco.actividades_realizadas_si, aco.actividades_realizadas_no, aco.actividades_realizadas_obs),
    itemAco('2', 'Realización de selección y delimitación técnica del terreno para la implementación del cultivo de cacao en arreglo agroforestal con plátano y maderable.', aco.manejo_plagas_si, aco.manejo_plagas_no, aco.manejo_plagas_obs),
    itemAco('3', 'Realización de muestreo de suelo, teniendo en cuenta: criterios de homogeneidad, uso actual del terreno, topografía y condiciones agroecológicas.', aco.manejo_suelo_si, aco.manejo_suelo_no, aco.manejo_suelo_obs),
    itemAco('4', 'Punto de georeferenciación del terreno donde se realizará la implementación del cultivo de cacao en arreglo agroforestal con plátano y maderable.', aco.manejo_agua_si, aco.manejo_agua_no, aco.manejo_agua_obs, geoAco),
    itemAco('5', 'Orientación al productor sobre procesos de producción y beneficios de la producción de cacao.', aco.capacitacion_si, aco.capacitacion_no, aco.capacitacion_obs),
    itemAco('6', 'Orientación del manejo de preparación del terreno: realización de limpias si es rastrojo de porte bajo (herbáceas), recomendando no utilización de herbicidas a base de componentes de medio a altamente tóxicos.', aco.seguimiento_si, aco.seguimiento_no, aco.seguimiento_obs),
    itemAco('7', 'Orientación del manejo de preparación del terreno: realización de entresacado en rastrojo biche de regeneración baja (arbóreas o arbustos), recomendando entresacado', aco.entresacado_si, aco.entresacado_no, aco.entresacado_obs),
    aco.observaciones_generales ? q('•', 'Observaciones generales', aco.observaciones_generales) : '',
  ].join(''));

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
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      margin: 40px;
      color: #2d3436;
      line-height: 1.6;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1B5E20;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 { color: #1B5E20; font-size: 22px; margin-bottom: 4px; }
    .header p { color: #636e72; font-size: 13px; }
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
    .foto-img { width: 100%; height: auto; max-height: 200px; object-fit: cover; border-radius: 4px; display: block; }
    .foto-coords { font-size: 10px; color: #636e72; font-family: monospace; margin-top: 3px; }
    .foto-heading { font-size: 10px; color: #0984e3; font-family: monospace; }
    .evidencia-item { margin: 12px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
    .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
    .firmas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
    .firma-item { padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; break-inside: avoid; }
    .firma-item .evidencia-label { font-size: 11px; color: #6c5ce7; }
    .firma-img { max-width: 100%; max-height: 80px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 6px; background: #fff; display: block; margin: 0 auto; }
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
    @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Encuesta Social AgroAmbiental</h1>
    <p><strong>ID:</strong> ${escapeHtml(form.id)} | <strong>Productor:</strong> ${escapeHtml(c.productor_nombre || '—')} | <strong>Fecha:</strong> ${escapeHtml(c.fecha || formatFecha(form.created_at))}</p>
  </div>

  <!-- Encabezado oficial de la encuesta -->
  <div class="section">
    <h2>DATOS GENERALES</h2>
    <div class="cols">${datosGenerales}</div>
  </div>

  ${componenteSocial}
  ${caracterizacionFinca}
  ${componenteProductivo}
  ${seccionSuelo}
  ${componenteAgro}
  ${recomendacionesHtml}
  ${acompanamientoHtml}

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
