// ============================================================
// PDF Routes — Generación y subida de PDFs a MinIO
// ============================================================

const express = require('express');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

// ─── Funciones helper ───────────────────────────────────────

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function row(label, value) {
  return `<div class="row"><span class="label">${escapeHtml(label)}:</span><span class="value">${escapeHtml(value || '—')}</span></div>`;
}

function section(title, icon, rows) {
  return rows
    ? `<div class="section"><h2>${icon} ${title}</h2>${rows}</div>`
    : '';
}

function getTipoLabel(tipo) {
  if (tipo === 'visita_tecnica') return 'Visita Técnica';
  if (tipo === 'caracterizacion') return 'Caracterización Sociodemográfica';
  return 'Formulario de Campo';
}

// ─── Plantilla HTML para visita técnica ─────────────────────

function htmlVisitaTecnica(form) {
  const b = form.beneficiario || {};
  const t = form.tecnico || {};
  const a = form.actividad || {};
  const c = form.coordenadas || {};
  const cl = form.clima || {};

  // Fotos
  let fotosHtml = '<p class="no-data">No se capturaron fotografías</p>';
  if (form.fotos && form.fotos.length > 0) {
    fotosHtml = form.fotos.map((f, i) => {
      if (f.uri && /\.(mp4|mov|avi|mkv)$/i.test(f.uri) || f.tipo === 'video') {
        return `<div class="foto-item"><p class="evidencia-label">🎥 Video ${i + 1}</p><p class="no-data">Video capturado — no disponible en PDF impreso.</p></div>`;
      }
      const imgTag = f.uri
        ? `<img src="${escapeHtml(f.uri)}" alt="Foto ${i + 1}" class="foto-img" />`
        : '';
      const coords = f.coordenadas
        ? `📍 ${Number(f.coordenadas.latitud).toFixed(4)}, ${Number(f.coordenadas.longitud).toFixed(4)}`
        : '';
      return `<div class="foto-item"><p class="evidencia-label">📸 Foto ${i + 1}</p>${imgTag}<p class="foto-coords">${coords}</p></div>`;
    }).join('\n');
  }

  // Firmas
  const benefName = `${b.nombre || '—'} (CC: ${b.cedula || '—'})`;
  const firmaBenef = form.firma_beneficiario
    ? `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(benefName)}</strong></p><img src="${escapeHtml(form.firma_beneficiario)}" alt="Firma" class="firma-img" /></div>`
    : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;
  const tecName = `${t.nombre || '—'} (CC: ${t.cedula || '—'})`;
  const firmaTec = form.firma_tecnico
    ? `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico — <strong>${escapeHtml(tecName)}</strong></p><img src="${escapeHtml(form.firma_tecnico)}" alt="Firma" class="firma-img" /></div>`
    : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

  // Huella
  const huellaHtml = form.huella_beneficiario
    ? `<div class="huella-sello"><div class="huella-sello-inner"><div class="huella-sello-header"><img src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="38" r="18" fill="none" stroke="#1B5E20" stroke-width="2.5"/><path d="M32 58 Q28 72 50 80 Q72 72 68 58" fill="none" stroke="#1B5E20" stroke-width="2.5"/><path d="M28 38 Q18 24 30 14" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M72 38 Q82 24 70 14" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M50 12 L50 4" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M38 20 Q25 20 22 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M62 20 Q75 20 78 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M50 56 L50 74" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M38 50 Q30 58 35 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M62 50 Q70 58 65 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/></svg>')}" alt="Huella" class="huella-sello-img" /></div><div class="huella-sello-body"><table class="huella-sello-table"><tr><td class="huella-sello-label-cell">Beneficiario:</td><td class="huella-sello-value-cell"><strong>${escapeHtml(b.nombre || '—')}</strong></td></tr><tr><td class="huella-sello-label-cell">Método:</td><td class="huella-sello-value-cell">Autenticación biométrica</td></tr><tr><td class="huella-sello-label-cell">Estado:</td><td class="huella-sello-value-cell"><span class="huella-sello-exitoso">Exitoso</span></td></tr></table></div><div class="huella-sello-footer"><span class="huella-sello-stamp">🖐️ VERIFICADO BIOMÉTRICAMENTE</span></div></div></div>`
    : '<p class="no-data">No registrada</p>';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Formulario ${escapeHtml(form.id)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2d3436; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #1B5E20; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #1B5E20; font-size: 24px; margin-bottom: 4px; }
  .header p { color: #636e72; font-size: 13px; }
  .section { margin: 20px 0; padding: 16px 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; }
  .section h2 { color: #1B5E20; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .row { display: flex; margin: 3px 0; font-size: 13px; }
  .label { font-weight: bold; color: #555; min-width: 140px; }
  .value { flex: 1; color: #2d3436; }
  .foto-item { margin: 16px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .foto-img { width: 100%; max-width: 350px; max-height: 240px; height: auto; border-radius: 4px; margin: 8px auto; display: block; object-fit: cover; }
  .foto-coords { font-size: 11px; color: #636e72; font-family: monospace; }
  .firma-item { display: inline-block; vertical-align: top; margin: 8px; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; width: calc(50% - 16px); min-width: 200px; }
  .firmas-contiguo { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
  .firma-img { max-width: 100%; max-height: 100px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 8px; background: #fff; }
  .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  .huella-sello { margin: 16px 0; page-break-inside: avoid; }
  .huella-sello-inner { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #1B5E20; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(27,94,32,0.15); }
  .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
  .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
  .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
  .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
  .huella-sello-value-cell { color: #2d3436; }
  .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
  .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 12px; }
  .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
  @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
</style></head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Formulario de Campo</h1>
    <p><strong>ID:</strong> ${escapeHtml(form.id)} | <strong>Tipo:</strong> Visita Técnica | <strong>Fecha:</strong> ${formatFecha(form.created_at)}</p>
  </div>

  <div class="section"><h2>👤 Datos del Técnico</h2>
    ${row('Nombre', t.nombre)}
    ${row('Cédula', t.cedula)}
    ${row('Teléfono', t.telefono)}
    ${row('Email', t.email)}
  </div>

  <div class="section"><h2>👥 Datos del Beneficiario</h2>
    ${row('Nombre', b.nombre)}
    ${row('Cédula', b.cedula)}
    ${row('Teléfono', b.telefono)}
    ${row('Departamento', b.departamento)}
    ${row('Municipio', b.municipio)}
    ${row('Vereda', b.vereda)}
    ${row('Finca', b.finca)}
  </div>

  <div class="section"><h2>📋 Actividad Realizada</h2>
    ${row('Descripción', a.descripcion)}
    ${a.descripcion_detallada ? `<div class="row" style="margin-top:4px;"><span class="label">Detalle:</span></div><div class="desc-detallada">${escapeHtml(a.descripcion_detallada)}</div>` : ''}
    ${row('Observaciones', a.observaciones)}
    ${row('Recomendaciones', a.recomendaciones)}
  </div>

  <div class="section"><h2>📍 Ubicación Geográfica</h2>
    ${row('Latitud', c.latitud != null ? Number(c.latitud).toFixed(6) : null)}
    ${row('Longitud', c.longitud != null ? Number(c.longitud).toFixed(6) : null)}
    ${c.altitud != null ? row('Altitud', `${Number(c.altitud).toFixed(1)} m`) : ''}
    ${c.precision_gps != null ? row('Precisión', `±${Number(c.precision_gps)} m`) : ''}
  </div>

  ${cl.actual ? `
  <div class="section"><h2>🌤 Condiciones Ambientales</h2>
    ${row('Temperatura', cl.actual.temperatura?.actual != null ? Math.round(cl.actual.temperatura.actual) + '°C' : null)}
    ${row('Humedad', cl.actual.humedad != null ? cl.actual.humedad + '%' : null)}
    ${row('Viento', cl.actual.viento?.velocidad != null ? Math.round(cl.actual.viento.velocidad) + ' m/s' : null)}
    ${row('Nubosidad', cl.actual.nubosidad != null ? cl.actual.nubosidad + '%' : null)}
  </div>` : ''}

  <div class="section"><h2>📸 Evidencias de Campo</h2>
    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    <div class="firmas-contiguo">${firmaBenef}${firmaTec}</div>
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
</body></html>`;
}

// ─── Plantilla HTML para caracterización ────────────────────

function htmlCaracterizacion(form) {
  const b = form.beneficiario || {};
  const t = form.tecnico || {};
  const c = form.coordenadas || {};
  const cn = form.caracterizacion_nueva || {};

  // Reutilizar helpers del genérico
  let fotosHtml = '<p class="no-data">No se capturaron fotografías</p>';
  if (form.fotos && form.fotos.length > 0) {
    fotosHtml = form.fotos.map((f, i) => {
      if (f.tipo === 'video' || /\.(mp4|mov|avi|mkv)$/i.test(f.uri || '')) {
        return `<div class="foto-item"><p class="evidencia-label">🎥 Video ${i + 1}</p><p class="no-data">Video capturado — no disponible en PDF impreso.</p></div>`;
      }
      const imgTag = f.uri
        ? `<img src="${escapeHtml(f.uri)}" alt="Foto ${i + 1}" class="foto-img" />`
        : '';
      const coords = f.coordenadas
        ? `📍 ${Number(f.coordenadas.latitud).toFixed(4)}, ${Number(f.coordenadas.longitud).toFixed(4)}`
        : '';
      return `<div class="foto-item"><p class="evidencia-label">📸 Foto ${i + 1}</p>${imgTag}<p class="foto-coords">${coords}</p></div>`;
    }).join('\n');
  }

  const firmaBenef = form.firma_beneficiario
    ? `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><img src="${escapeHtml(form.firma_beneficiario)}" alt="Firma" class="firma-img" /></div>`
    : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;
  const firmaTec = form.firma_tecnico
    ? `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><img src="${escapeHtml(form.firma_tecnico)}" alt="Firma" class="firma-img" /></div>`
    : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

  const huellaHtml = form.huella_beneficiario
    ? `<div class="huella-sello"><div class="huella-sello-inner"><div class="huella-sello-header"><img src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="38" r="18" fill="none" stroke="#1B5E20" stroke-width="2.5"/><path d="M32 58 Q28 72 50 80 Q72 72 68 58" fill="none" stroke="#1B5E20" stroke-width="2.5"/><path d="M28 38 Q18 24 30 14" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M72 38 Q82 24 70 14" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M50 12 L50 4" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M38 20 Q25 20 22 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M62 20 Q75 20 78 35" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M50 56 L50 74" fill="none" stroke="#1B5E20" stroke-width="2"/><path d="M38 50 Q30 58 35 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/><path d="M62 50 Q70 58 65 70" fill="none" stroke="#1B5E20" stroke-width="1.5"/></svg>')}" alt="Huella" class="huella-sello-img" /></div><div class="huella-sello-body"><table class="huella-sello-table"><tr><td class="huella-sello-label-cell">Beneficiario:</td><td class="huella-sello-value-cell"><strong>${escapeHtml(b.nombre || '—')}</strong></td></tr><tr><td class="huella-sello-label-cell">Método:</td><td class="huella-sello-value-cell">Autenticación biométrica</td></tr><tr><td class="huella-sello-label-cell">Estado:</td><td class="huella-sello-value-cell"><span class="huella-sello-exitoso">Exitoso</span></td></tr></table></div><div class="huella-sello-footer"><span class="huella-sello-stamp">🖐️ VERIFICADO BIOMÉTRICAMENTE</span></div></div></div>`
    : '<p class="no-data">No registrada</p>';

  // Datos de caracterización (si existen)
  let datosGenerales = '', compSocial = '', compProductivo = '', compAgro = '', analisisSuelo = '', recomendaciones = '';

  if (cn.municipio || cn.productor_nombre || cn.productor) {
    datosGenerales = `
    ${row('Municipio', cn.municipio)}
    ${row('Fecha', cn.fecha)}
    ${row('Vereda', cn.vereda)}
    ${row('N° Encuesta', cn.numero_encuesta || cn.encuesta_numero)}
    ${row('Productor', cn.productor_nombre || cn.productor)}
    ${row('Documento', cn.documento)}
    ${row('Teléfono', cn.telefono)}
    ${row('Técnico', cn.tecnico_responsable || cn.tecnico)}
    ${row('Cédula del Técnico', cn.tecnico_cedula)}
    ${row('Finca / Predio', cn.finca)}
    `;
  }

  // Componentes con mapeo compatible (nuevos nombres vs. legacy)
  const cs = cn.componente_social || cn;
  const cp = cn.componente_productivo || cn;
  const ca = cn.componente_agroambiental || cn;
  const asuelo = cn.analisis_suelo || cn;

  if (cs.nivel_educativo || cs.personas_nucleo || cs.fuente_ingresos) {
    compSocial = section('Componente Social', '🤝', [
      row('Nivel educativo', cs.nivel_educativo),
      row('Personas núcleo familiar', cs.personas_nucleo),
      row('Fuente de ingresos', cs.fuente_ingresos),
      row('Servicios públicos', cs.servicios_publicos),
      row('Participa en asociaciones', cs.participa_asociaciones || cs.participa_organizacion),
      row('Asistencia técnica', cs.asistencia_tecnica),
    ].join(''));
  }

  if (cp.actividad_productiva || cp.acceso_agua) {
    compProductivo = section('Componente Productivo', '🌾', [
      row('Actividad productiva', cp.actividad_productiva),
      row('Mano de obra', cp.mano_obra),
      row('Acceso al agua', cp.acceso_agua),
      row('Asistencia técnica agropecuaria', cp.asistencia_tecnica || cp.asistencia_agropecuaria),
      row('Crédito / financiación', cp.credito_financiacion),
    ].join(''));
  }

  if (ca.procesos_erosion || ca.fuentes_hidricas) {
    compAgro = section('Componente Agroambiental', '🌿', [
      row('Procesos de erosión', ca.procesos_erosion),
      row('Fuentes hídricas', ca.fuentes_hidricas),
      row('Áreas de conservación', ca.areas_conservacion),
      row('Prácticas de conservación', ca.practicas_conservacion),
      row('Manejo de residuos', ca.manejo_residuos),
    ].join(''));
  }

  if (asuelo.textura || asuelo.textura_suelo || asuelo.color || asuelo.color_suelo) {
    analisisSuelo = section('Análisis de Suelo', '🧪', [
      row('Textura', asuelo.textura || asuelo.textura_suelo),
      row('Color', asuelo.color || asuelo.color_suelo),
      row('Drenaje', asuelo.drenaje),
      row('Profundidad efectiva', asuelo.profundidad),
      row('Presencia de piedras', asuelo.piedras || asuelo.presencia_piedras),
      row('Compactación', asuelo.compactacion),
      row('Cobertura del suelo', asuelo.cobertura || asuelo.cobertura_suelo),
      row('Evidencia de erosión', asuelo.evidencia_erosion),
      row('pH del suelo', asuelo.ph_suelo),
    ].join(''));
  }

  const rec = cn.recomendaciones || cn;
  if (rec.recomendaciones_tecnicas || rec.recomendaciones_ambientales || rec.recomendacion_tecnica || rec.observaciones_finales) {
    const tec = rec.recomendaciones_tecnicas || rec.recomendacion_tecnica;
    const amb = rec.recomendaciones_ambientales;
    const obs = rec.observaciones_finales;
    recomendaciones = `<div class="section"><h2>📋 Recomendaciones</h2>
      ${tec ? `<div class="row" style="margin-bottom:4px;"><span class="label">Técnicas:</span></div><div class="desc-detallada">${escapeHtml(tec)}</div>` : ''}
      ${amb ? `<div class="row" style="margin-top:12px;margin-bottom:4px;"><span class="label">Ambientales:</span></div><div class="desc-detallada">${escapeHtml(amb)}</div>` : ''}
      ${obs ? `<div class="row" style="margin-top:12px;margin-bottom:4px;"><span class="label">Observaciones:</span></div><div class="desc-detallada">${escapeHtml(obs)}</div>` : ''}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Caracterización ${escapeHtml(form.id)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2d3436; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #1B5E20; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #1B5E20; font-size: 22px; margin-bottom: 4px; }
  .header p { color: #636e72; font-size: 13px; }
  .section { margin: 20px 0; padding: 16px 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; }
  .section h2 { color: #1B5E20; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .row { display: flex; margin: 3px 0; font-size: 13px; }
  .label { font-weight: bold; color: #555; min-width: 160px; }
  .value { flex: 1; color: #2d3436; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  .foto-item { margin: 16px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .foto-img { width: 100%; max-width: 350px; max-height: 240px; height: auto; border-radius: 4px; margin: 8px auto; display: block; object-fit: cover; }
  .foto-coords { font-size: 11px; color: #636e72; font-family: monospace; }
  .firma-item { display: inline-block; vertical-align: top; margin: 8px; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; width: calc(50% - 16px); min-width: 200px; }
  .firmas-contiguo { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
  .firma-img { max-width: 100%; max-height: 100px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 8px; background: #fff; }
  .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
  .huella-sello { margin: 16px 0; page-break-inside: avoid; }
  .huella-sello-inner { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #1B5E20; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(27,94,32,0.15); }
  .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
  .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
  .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
  .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
  .huella-sello-value-cell { color: #2d3436; }
  .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
  .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
  @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
</style></head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Caracterización Sociodemográfica</h1>
    <p><strong>ID:</strong> ${escapeHtml(form.id)} | <strong>Productor:</strong> ${escapeHtml(cn.productor_nombre || cn.productor || '—')} | <strong>Fecha:</strong> ${escapeHtml(cn.fecha || formatFecha(form.created_at))}</p>
  </div>

  ${datosGenerales ? `<div class="section"><h2>📋 Datos Generales</h2>${datosGenerales}</div>` : ''}
  ${compSocial}
  ${compProductivo}
  ${compAgro}
  ${analisisSuelo}
  ${recomendaciones}

  <div class="section"><h2>👤 Datos del Técnico</h2>
    ${row('Nombre', t.nombre)}
    ${row('Cédula', t.cedula)}
    ${row('Teléfono', t.telefono)}
  </div>

  <div class="section"><h2>👥 Datos del Beneficiario</h2>
    ${row('Nombre', b.nombre)}
    ${row('Cédula', b.cedula)}
    ${row('Teléfono', b.telefono)}
    ${row('Departamento', b.departamento)}
    ${row('Municipio', b.municipio)}
    ${row('Vereda', b.vereda)}
    ${row('Finca', b.finca)}
  </div>

  ${c.latitud ? `<div class="section"><h2>📍 Ubicación Geográfica</h2>
    ${row('Latitud', Number(c.latitud).toFixed(6))}
    ${row('Longitud', Number(c.longitud).toFixed(6))}
    ${c.altitud != null ? row('Altitud', `${Number(c.altitud).toFixed(1)} m`) : ''}
    ${c.precision_gps != null ? row('Precisión', `±${Number(c.precision_gps)} m`) : ''}
  </div>` : ''}

  <div class="section"><h2>📸 Evidencias de Campo</h2>
    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    <div class="firmas-contiguo">${firmaBenef}${firmaTec}</div>
    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
</body></html>`;
}

// ─── POST /api/pdfs/generar ─────────────────────────────────
router.post('/generar', authenticateToken, async (req, res) => {
  try {
    const formulario = req.body;

    if (!formulario || !formulario.id) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Datos del formulario requeridos',
      });
    }

    const timestamp = Date.now();
    const filename = `formulario_${formulario.id}_${timestamp}.html`;

    // Elegir plantilla según tipo
    let html;
    if (formulario.tipo === 'caracterizacion') {
      html = htmlCaracterizacion(formulario);
    } else {
      html = htmlVisitaTecnica(formulario);
    }

    // Subir a MinIO
    const buffer = Buffer.from(html, 'utf8');

    await storage.uploadFile(
      req.user.rol,
      req.user.usuario,
      'pdfs',
      filename,
      buffer,
      { contentType: 'text/html' }
    );

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
    const minioPath = `${basePath}/pdfs/${filename}`;
    await db.query(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id,
        'pdf',
        filename,
        filename,
        'text/html',
        buffer.length,
        minioPath,
        bucket,
        JSON.stringify({ formulario_id: formulario.id, tipo_formulario: formulario.tipo }),
      ]
    );

    // Obtener el ID generado
    const archivo = await db.queryOne(
      'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
      [minioPath]
    );
    const pdfId = archivo ? archivo.id : `pdf-${timestamp}`;

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'generar_pdf', JSON.stringify({ archivo_id: pdfId, filename, formulario_id: formulario.id })]
    );

    console.log(`[PDF] 📄 PDF subido a MinIO: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: pdfId,
      pdf_ruta: minioPath,
      filename,
      mensaje: 'PDF generado y almacenado en MinIO correctamente',
    });
  } catch (error) {
    console.error('[PDF] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al generar PDF' });
  }
});

// GET /api/pdfs/:id — Obtener metadata de un PDF
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const pdfRecord = await db.queryOne(
      'SELECT * FROM archivos WHERE id = $1 AND tipo = $2',
      [req.params.id, 'pdf']
    );
    if (!pdfRecord) {
      return res.status(404).json({ estado: 'error', mensaje: 'PDF no encontrado' });
    }

    res.json({
      estado: 'ok',
      pdf: {
        id: pdfRecord.id,
        minio_path: pdfRecord.minio_path,
        filename: pdfRecord.filename,
        size_bytes: pdfRecord.size_bytes,
        metadata: pdfRecord.metadata_json,
        timestamp: pdfRecord.created_at,
      },
    });
  } catch (error) {
    console.error('[PDF] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener PDF' });
  }
});

module.exports = router;
