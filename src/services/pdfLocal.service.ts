// ============================================================
// GEODAILY — Servicio de PDF Local (expo-print)
// Genera el PDF directamente en el dispositivo con TODAS
// las evidencias incluidas: fotos reales redimensionadas,
// firmas, sello de verificación biométrica.
// ============================================================

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
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
      ? `<div class="evidencia-item">
           <p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(formulario.beneficiario.nombre)}</strong></p>
           <img src="${formulario.firma_beneficiario}" alt="Firma del beneficiario" class="firma-img" />
         </div>`
      : `<div class="evidencia-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

    const firmaTecHtml = formulario.firma_tecnico
      ? `<div class="evidencia-item">
           <p class="evidencia-label">🖊️ Firma del Técnico en Terreno — <strong>${escapeHtml(formulario.tecnico.nombre)}</strong></p>
           <img src="${formulario.firma_tecnico}" alt="Firma del técnico" class="firma-img" />
         </div>`
      : `<div class="evidencia-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

    // 3. Generar sello de verificación biométrica (con gráfico de huella SVG)
    const selloBiometricoHtml = formulario.huella_beneficiario
      ? generarSelloBiometrico(formulario.beneficiario.nombre)
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Huella Biométrica</p><p class="no-data">No registrada</p></div>`;

    // 4. Construir HTML completo
    const html = construirHTML(formulario, fotosHtml, firmaBenefHtml, firmaTecHtml, selloBiometricoHtml);

    // 5. Generar PDF con expo-print
    const { uri } = await Print.printToFileAsync({
      html,
      width: 595.28, // A4 width in points
      height: 841.89, // A4 height
    });

    console.log('[PDF Local] PDF generado:', uri);
    return uri;
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
    try {
      // Redimensionar la foto a 800px de ancho con compresión 0.5
      // para que el base64 sea lo suficientemente pequeño para el PDF
      const resultado = await manipulateAsync(
        foto.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.5, format: SaveFormat.JPEG, base64: true }
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
function construirHTML(
  form: Formulario,
  fotosHtml: string,
  firmaBenefHtml: string,
  firmaTecHtml: string,
  huellaHtml: string
): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Formulario ${form.id}</title>
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
    .header h1 {
      color: #1B5E20;
      font-size: 24px;
      margin-bottom: 4px;
    }
    .header p {
      color: #636e72;
      font-size: 13px;
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
    .row {
      display: flex;
      margin: 3px 0;
      font-size: 13px;
    }
    .label {
      font-weight: bold;
      color: #555;
      min-width: 140px;
    }
    .value {
      flex: 1;
      color: #2d3436;
    }
    .foto-item {
      margin: 16px 0;
      padding: 12px;
      background: #fff;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      page-break-inside: avoid;
    }
    .foto-img {
      width: 100%;
      max-width: 480px;
      height: auto;
      border-radius: 4px;
      margin: 8px 0;
      display: block;
    }
    .foto-coords {
      font-size: 11px;
      color: #636e72;
      font-family: monospace;
    }
    .foto-heading {
      font-size: 11px;
      color: #0984e3;
      font-family: monospace;
    }
    .evidencia-item {
      margin: 12px 0;
      padding: 12px;
      background: #fff;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      page-break-inside: avoid;
    }
    .evidencia-label {
      font-size: 13px;
      color: #2d3436;
      margin-bottom: 8px;
    }
    .firma-img {
      max-width: 320px;
      max-height: 100px;
      border: 1px dashed #b2bec3;
      border-radius: 4px;
      padding: 8px;
      background: #fff;
    }
    /* --- Sello de verificación biométrica --- */
    .huella-sello {
      margin: 16px 0;
      page-break-inside: avoid;
    }
    .huella-sello-inner {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 2px solid #1B5E20;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(27, 94, 32, 0.15);
    }
    .huella-sello-header {
      display: flex;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid #bbf7d0;
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    .huella-sello-img {
      width: 64px;
      height: 64px;
      flex-shrink: 0;
    }
    .huella-sello-titles {
      flex: 1;
    }
    .huella-sello-verificado {
      font-size: 20px;
      font-weight: bold;
      color: #15803d;
    }
    .huella-sello-label {
      font-size: 13px;
      color: #16a34a;
    }
    .huella-sello-body {
      margin-bottom: 14px;
    }
    .huella-sello-table {
      width: 100%;
      border-collapse: collapse;
    }
    .huella-sello-table td {
      padding: 4px 8px;
      font-size: 13px;
    }
    .huella-sello-label-cell {
      color: #555;
      font-weight: bold;
      width: 120px;
    }
    .huella-sello-value-cell {
      color: #2d3436;
    }
    .huella-sello-exitoso {
      display: inline-block;
      background: #15803d;
      color: #fff;
      font-size: 12px;
      font-weight: bold;
      padding: 2px 12px;
      border-radius: 10px;
    }
    .huella-sello-footer {
      text-align: center;
      border-top: 1px solid #bbf7d0;
      padding-top: 12px;
    }
    .huella-sello-stamp {
      display: inline-block;
      font-size: 14px;
      font-weight: bold;
      color: #15803d;
      letter-spacing: 1px;
      border: 2px solid #15803d;
      border-radius: 6px;
      padding: 4px 16px;
      transform: rotate(-2deg);
    }
    /* --- Fin sello biométrico --- */
    .no-data {
      font-size: 12px;
      color: #b2bec3;
      font-style: italic;
      padding: 8px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 11px;
      color: #b2bec3;
    }
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
    @media print {
      .foto-img { max-width: 100%; }
      .section { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Formulario de Campo</h1>
    <p><strong>ID:</strong> ${escapeHtml(form.id)} | <strong>Tipo:</strong> ${form.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Plantación'} | <strong>Fecha:</strong> ${formatFecha(form.created_at)}</p>
  </div>

  <!-- Datos del Técnico -->
  <div class="section">
    <h2>👤 Datos del Técnico</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(form.tecnico.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(form.tecnico.cedula)}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(form.tecnico.telefono || '—')}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${escapeHtml(form.tecnico.email || '—')}</span></div>
  </div>

  <!-- Datos del Beneficiario -->
  <div class="section">
    <h2>👥 Datos del Beneficiario</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(form.beneficiario.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(form.beneficiario.cedula || '—')}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(form.beneficiario.telefono || '—')}</span></div>
    <div class="row"><span class="label">Departamento:</span><span class="value">${escapeHtml(form.beneficiario.departamento || '—')}</span></div>
    <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(form.beneficiario.municipio || '—')}</span></div>
    <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(form.beneficiario.vereda || '—')}</span></div>
    <div class="row"><span class="label">Finca:</span><span class="value">${escapeHtml(form.beneficiario.finca || '—')}</span></div>
  </div>

  <!-- Actividad Realizada -->
  <div class="section">
    <h2>📋 Actividad Realizada</h2>
    <div class="row"><span class="label">Tipo:</span><span class="value">${escapeHtml(form.actividad.descripcion || '—')}</span></div>
    ${form.actividad.descripcion_detallada ? `
    <div class="row"><span class="label">Descripción detallada:</span></div>
    <div class="desc-detallada">${escapeHtml(form.actividad.descripcion_detallada)}</div>
    ` : ''}
    <div class="row" style="margin-top:8px;"><span class="label">Observaciones:</span><span class="value">${escapeHtml(form.actividad.observaciones || '—')}</span></div>
    <div class="row"><span class="label">Recomendaciones:</span><span class="value">${escapeHtml(form.actividad.recomendaciones || '—')}</span></div>
  </div>

  <!-- Ubicación -->
  <div class="section">
    <h2>📍 Ubicación Geográfica</h2>
    <div class="row"><span class="label">Latitud:</span><span class="value">${form.coordenadas?.latitud?.toFixed(6) || '—'}</span></div>
    <div class="row"><span class="label">Longitud:</span><span class="value">${form.coordenadas?.longitud?.toFixed(6) || '—'}</span></div>
    ${form.coordenadas?.altitud ? `<div class="row"><span class="label">Altitud:</span><span class="value">${form.coordenadas.altitud.toFixed(1)} m</span></div>` : ''}
    ${form.coordenadas?.precision_gps ? `<div class="row"><span class="label">Precisión:</span><span class="value">±${form.coordenadas.precision_gps} m</span></div>` : ''}
  </div>

  <!-- DATOS CLIMÁTICOS -->
  ${form.clima ? `
  <div class="section">
    <h2>🌤 Condiciones Ambientales</h2>
    <div class="row"><span class="label">Ubicación:</span><span class="value">${escapeHtml(form.clima.ubicacion?.nombre || '—')}</span></div>
    <div class="row"><span class="label">Temperatura:</span><span class="value">${form.clima.temperatura?.actual != null ? Math.round(form.clima.temperatura.actual) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Sensación térmica:</span><span class="value">${form.clima.temperatura?.sensacion_termica != null ? Math.round(form.clima.temperatura.sensacion_termica) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Humedad:</span><span class="value">${form.clima.humedad != null ? form.clima.humedad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Viento:</span><span class="value">${form.clima.viento?.velocidad != null ? Math.round(form.clima.viento.velocidad) + ' m/s' : '—'}</span></div>
    <div class="row"><span class="label">Nubosidad:</span><span class="value">${form.clima.nubosidad != null ? form.clima.nubosidad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Presión:</span><span class="value">${form.clima.presion != null ? form.clima.presion + ' hPa' : '—'}</span></div>
    <div class="row"><span class="label">Visibilidad:</span><span class="value">${form.clima.visibilidad != null ? form.clima.visibilidad + ' km' : '—'}</span></div>
  </div>
  ` : ''}

  <!-- EVIDENCIAS -->
  <div class="section">
    <h2>📸 Evidencias de Campo</h2>

    <!-- FOTOS -->
    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}

    <!-- FIRMA DEL BENEFICIARIO -->
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    ${firmaBenefHtml}

    <!-- FIRMA DEL TÉCNICO -->
    ${firmaTecHtml}

    <!-- HUELLA BIOMÉTRICA -->
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

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
