// ============================================================
// GEODAILY — Informes PDF de la Bitácora del Beneficiario (interventoría)
// ============================================================
// Dos informes con el membrete de interventoría (el mismo de los demás PDF):
//   · General: todos los beneficiarios, agrupados por técnico.
//   · Individual: la ficha completa de un beneficiario.
// Ambos resumen visitas y actividades; no modifican ningún dato.
// ============================================================

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { avisar } from '../utils/dialogos';
import { membreteAperturaHtml, membreteCierreHtml, membreteCss, MembreteVariante } from '../utils/membrete';
import { escapeHtml } from './pdfLocal.service';
import { abrirPdf } from './informeTecnicoPdf.service';
import { descargarHtmlComoPdfWeb } from '../utils/printWeb';
import { ACTIVIDADES_EN_HECTAREAS, buscarActividad } from '../data/actividades';
import { formatearHectareas } from './actividadesHectareas.service';
import {
  BitacoraActividadHectareas,
  BitacoraFicha,
  BitacoraFilaInforme,
  etiquetaVisitaBitacora,
  obtenerInformeGeneral,
} from './bitacora.service';

const VERDE = '#2E7D32';
const ROJO = '#C62828';
const AMBAR = '#EF6C00';

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  ${membreteCss()}
  body { font-family: 'Arial Narrow', Arial, sans-serif; color: #2d3436; }
  .doc-titulo { text-align: center; border-bottom: 2px solid #00695C; padding-bottom: 6px; margin-bottom: 4px; }
  .doc-titulo h1 { color: #00695C; font-size: 15pt; }
  .doc-subtitulo { text-align: center; color: #555; font-size: 9pt; margin-bottom: 14px; }
  h2 { color: #00695C; font-size: 11.5pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 3px; margin: 14px 0 7px; break-after: avoid; }
  h3 { color: #37474F; font-size: 9.5pt; margin: 10px 0 4px; break-after: avoid; }
  .cifras { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .cifra { flex: 1 1 22%; min-width: 22%; border: 1px solid #cfd8dc; border-radius: 4px; padding: 5px 6px; text-align: center; }
  .cifra b { display: block; font-size: 13pt; color: #00695C; }
  .cifra span { font-size: 7.5pt; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 7.8pt; }
  th { background: #00695C; color: #fff; text-align: left; padding: 3px 5px; }
  td { padding: 3px 5px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f9fa; }
  tr { break-inside: avoid; }
  table.ficha td.k { width: 30%; color: #555; background: #f4f8f7; font-weight: bold; }
  .ok { color: ${VERDE}; font-weight: bold; } .falta { color: ${ROJO}; font-weight: bold; } .medio { color: ${AMBAR}; font-weight: bold; }
  .nd { color: #999; font-style: italic; }
  .peq { font-size: 7pt; color: #666; }
  .vacio { font-size: 9pt; color: #999; font-style: italic; margin: 4px 0; }
  .footer { margin-top: 22px; padding-top: 8px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 8.5pt; color: #999; }
`;

const fechaCorta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const fechaLarga = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

const dato = (v?: string | number | null) =>
  v === null || v === undefined || v === '' ? '<span class="nd">Sin registrar</span>' : escapeHtml(String(v));

const CALIDAD: Record<string, string> = { propietario: 'Propietario', poseedor: 'Poseedor', otro: 'Otro' };

/** Interventoría usa su membrete; el resto de roles, el de ejecución (igual que el informe de suelos). */
const varianteDe = (rol?: string): MembreteVariante => (rol === 'interventor' ? 'interventoria' : 'ejecucion');

function envolver(titulo: string, subtitulo: string, cuerpo: string, variante: MembreteVariante = 'interventoria'): string {
  const ahora = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(titulo)}</title><style>${CSS}</style></head>
<body>
  ${membreteAperturaHtml(variante)}
  <div class="doc-titulo"><h1>${escapeHtml(titulo)}</h1></div>
  <div class="doc-subtitulo">${escapeHtml(subtitulo)} · ${ahora}</div>
  ${cuerpo}
  <div class="footer">Informe generado automáticamente por GEODAILY el ${ahora}</div>
  ${membreteCierreHtml()}
</body></html>`;
}

const nombreActividad = (id: string) => {
  const a = buscarActividad(id);
  return a ? a.nombre : id;
};

const fotosTexto = (f: BitacoraActividadHectareas['fotos']) => `${f.antes}/${f.durante}/${f.despues}`;

/** Entrega el PDF: descarga directa en web; en el teléfono lo genera y lo abre. */
async function entregarPdf(html: string, base: string): Promise<void> {
  const fecha = new Date().toISOString().slice(0, 10);
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
}

const slug = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'Beneficiario';

// ─── Informe individual ─────────────────────────────────────

export function htmlInformeBeneficiario(f: BitacoraFicha, generadoPor: string, variante: MembreteVariante = 'interventoria'): string {
  const { beneficiario: b, predio, ubicacion, visitas, actividades } = f;
  const prep = actividades.enHectareas.find((a) => a.id === 'preparacion_terreno');
  // Igual que la pantalla: las conectadas en la app y cualquiera que ya tenga registros.
  const visibles = actividades.enHectareas.filter(
    (a) => ACTIVIDADES_EN_HECTAREAS.includes(a.id) || a.hectareas > 0 || a.actas > 0 || a.fotos.antes + a.fotos.durante + a.fotos.despues > 0
  );
  const totalActas = actividades.enHectareas.reduce((s, a) => s + a.actas, 0);
  const totalFotos = actividades.enHectareas.reduce((s, a) => s + a.fotos.antes + a.fotos.durante + a.fotos.despues, 0);

  const coord = (c: { latitud: number; longitud: number } | null, extra = '') =>
    c ? `${c.latitud.toFixed(6)}, ${c.longitud.toFixed(6)}${extra ? ` ${escapeHtml(extra)}` : ''}` : '<span class="nd">Sin registrar</span>';
  const gps = ubicacion.gpsVisita1;

  const filaFicha = (k: string, v: string) => `<tr><td class="k">${escapeHtml(k)}</td><td>${v}</td></tr>`;

  const cuerpo = `
    <h2>Resumen</h2>
    <div class="cifras">
      <div class="cifra"><b>${visitas.length}</b><span>Visitas realizadas</span></div>
      <div class="cifra"><b class="${actividades.analisisSuelos.subido ? 'ok' : 'falta'}">${actividades.analisisSuelos.subido ? 'Subido' : 'Pendiente'}</b><span>Análisis de suelos</span></div>
      <div class="cifra"><b>${prep ? formatearHectareas(prep.hectareas) : '0'} ha</b><span>Preparación del terreno</span></div>
      <div class="cifra"><b>${totalActas} / ${totalFotos}</b><span>Actas / fotos de actividades</span></div>
    </div>

    <h2>Datos personales</h2>
    <table class="ficha"><tbody>
      ${filaFicha('Nombre', dato(b.nombre))}
      ${filaFicha('Cédula', dato(b.cedula))}
      ${filaFicha('Teléfono', dato(b.telefono))}
      ${filaFicha('Correo electrónico', dato(b.correo))}
      ${filaFicha('Técnico asignado', dato(b.tecnico))}
    </tbody></table>

    <h2>Datos del predio</h2>
    <table class="ficha"><tbody>
      ${filaFicha('Predio', dato(predio.nombre))}
      ${filaFicha('Área', predio.area != null ? `${escapeHtml(formatearHectareas(predio.area))} ha` : '<span class="nd">Sin registrar</span>')}
      ${filaFicha('Calidad del predio', dato(predio.calidad ? CALIDAD[predio.calidad] ?? predio.calidad : null))}
      ${filaFicha('Vereda', dato(b.vereda))}
      ${filaFicha('Corregimiento', dato(b.corregimiento))}
      ${filaFicha('Municipio', dato([b.municipio, b.departamento].filter(Boolean).join(', ') || null))}
    </tbody></table>

    <h2>Ubicación</h2>
    <table class="ficha"><tbody>
      ${filaFicha('Coordenadas del predio', coord(ubicacion.registrada))}
      ${filaFicha('GPS de la Visita 1', coord(gps, gps?.precision != null ? `(±${gps.precision} m)` : ''))}
    </tbody></table>

    <h2>Visitas realizadas (${visitas.length})</h2>
    ${
      visitas.length === 0
        ? '<p class="vacio">Aún no se han realizado visitas a este beneficiario.</p>'
        : `<table><thead><tr><th>Visita</th><th>Fecha</th><th>Técnico</th></tr></thead><tbody>
          ${visitas.map((v) => `<tr><td><b>${escapeHtml(etiquetaVisitaBitacora(v))}</b></td><td>${fechaLarga(v.fecha)}</td><td>${dato(v.tecnico)}</td></tr>`).join('')}
        </tbody></table>`
    }

    <h2>Actividades</h2>
    <table><thead><tr><th>Actividad</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
      <tr>
        <td><b>${escapeHtml(nombreActividad('analisis_suelos'))}</b></td>
        <td class="${actividades.analisisSuelos.subido ? 'ok' : 'falta'}">${actividades.analisisSuelos.subido ? 'Realizado' : 'Pendiente'}</td>
        <td>${actividades.analisisSuelos.subido ? `PDF de laboratorio subido el ${fechaLarga(actividades.analisisSuelos.fecha)}` : '—'}</td>
      </tr>
      ${visibles
        .map((a) => {
          const nFotos = a.fotos.antes + a.fotos.durante + a.fotos.despues;
          const iniciada = a.hectareas > 0 || a.actas > 0 || nFotos > 0;
          return `<tr>
            <td><b>${escapeHtml(nombreActividad(a.id))}</b></td>
            <td class="${iniciada ? 'ok' : 'falta'}">${iniciada ? 'Registrada' : 'Pendiente'}</td>
            <td>
              ${escapeHtml(formatearHectareas(a.hectareas))} ha${a.respaldadaPorVisita ? ` (respaldadas por la Visita ${a.respaldadaPorVisita})` : ''}<br/>
              Actas de entrega: ${a.actas} · Fotos antes / durante / después: ${fotosTexto(a.fotos)} de 3
              ${a.observacionesPendientes > 0 ? `<br/><span class="falta">${a.observacionesPendientes} ${a.observacionesPendientes === 1 ? 'observación pendiente' : 'observaciones pendientes'} sobre el acta</span>` : ''}
            </td>
          </tr>`;
        })
        .join('')}
    </tbody></table>`;

  return envolver(`Informe del Beneficiario — ${b.nombre}`, `Generado por ${generadoPor}`, cuerpo, variante);
}

export async function generarYAbrirInformeBeneficiario(ficha: BitacoraFicha, generadoPor: string, rol?: string): Promise<void> {
  try {
    await entregarPdf(htmlInformeBeneficiario(ficha, generadoPor, varianteDe(rol)), `Informe_${slug(ficha.beneficiario.nombre)}`);
  } catch (error: any) {
    console.warn('[Bitácora PDF] Error (individual):', error?.message || error);
    avisar('No se pudo generar el informe', 'Inténtalo de nuevo.');
  }
}

// ─── Informe general ────────────────────────────────────────

const visita = (f: BitacoraFilaInforme, n: number) => f.visitas.find((v) => v.numero === n);
const prepDe = (f: BitacoraFilaInforme) => f.enHectareas.find((a) => a.id === 'preparacion_terreno');

export function htmlInformeGeneral(filas: BitacoraFilaInforme[], generadoPor: string, variante: MembreteVariante = 'interventoria'): string {
  const n = filas.length;
  const conV1 = filas.filter((f) => visita(f, 1)).length;
  const conV2 = filas.filter((f) => visita(f, 2)).length;
  const conSuelos = filas.filter((f) => f.suelos).length;
  const haPrep = filas.reduce((s, f) => s + (prepDe(f)?.hectareas ?? 0), 0);
  const todas = filas.flatMap((f) => f.enHectareas);
  const actas = todas.reduce((s, a) => s + a.actas, 0);
  const fotos = todas.reduce((s, a) => s + a.fotos.antes + a.fotos.durante + a.fotos.despues, 0);
  const obs = todas.reduce((s, a) => s + a.observacionesPendientes, 0);

  const grupos = new Map<string, BitacoraFilaInforme[]>();
  for (const f of filas) {
    const k = f.tecnico || 'Sin técnico asignado';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(f);
  }
  const resumenTecnico = (lista: BitacoraFilaInforme[]) => ({
    n: lista.length,
    v1: lista.filter((f) => visita(f, 1)).length,
    v2: lista.filter((f) => visita(f, 2)).length,
    suelos: lista.filter((f) => f.suelos).length,
    ha: lista.reduce((s, f) => s + (prepDe(f)?.hectareas ?? 0), 0),
  });

  const celdaVisitas = (f: BitacoraFilaInforme) =>
    f.visitas.length === 0
      ? '<span class="falta">Sin visitas</span>'
      : f.visitas
          .map((v) => `<span class="ok">${v.numero != null ? `V${v.numero}` : 'V.T.'}</span> <span class="peq">${fechaCorta(v.fecha)}</span>`)
          .join('<br/>');

  const celdaActividades = (f: BitacoraFilaInforme) => {
    const out = f.enHectareas.map((a) => {
      const nf = a.fotos.antes + a.fotos.durante + a.fotos.despues;
      const corto = nombreActividad(a.id).split(' ').slice(0, 3).join(' ');
      return `${escapeHtml(corto)}: <b>${escapeHtml(formatearHectareas(a.hectareas))} ha</b><br/><span class="peq">Acta ${a.actas} · Fotos ${fotosTexto(a.fotos)}${nf ? '' : ' (sin fotos)'}${
        a.observacionesPendientes ? ` · <span class="falta">${a.observacionesPendientes} obs.</span>` : ''
      }</span>`;
    });
    return out.length ? out.join('<br/>') : '<span class="nd">—</span>';
  };

  const cuerpo = `
    <h2>Resumen general</h2>
    <div class="cifras">
      <div class="cifra"><b>${n}</b><span>Beneficiarios</span></div>
      <div class="cifra"><b>${conV1}</b><span>Con Visita 1 (${n ? Math.round((conV1 / n) * 100) : 0}%)</span></div>
      <div class="cifra"><b>${conV2}</b><span>Con Visita 2 (${n ? Math.round((conV2 / n) * 100) : 0}%)</span></div>
      <div class="cifra"><b>${conSuelos}</b><span>Con análisis de suelos</span></div>
      <div class="cifra"><b>${formatearHectareas(haPrep)} ha</b><span>Preparación del terreno</span></div>
      <div class="cifra"><b>${actas}</b><span>Actas de entrega</span></div>
      <div class="cifra"><b>${fotos}</b><span>Fotos de actividades</span></div>
      <div class="cifra"><b class="${obs ? 'falta' : 'ok'}">${obs}</b><span>Observaciones pendientes</span></div>
    </div>

    <h2>Avance por técnico</h2>
    <table><thead><tr><th>Técnico</th><th>Benef.</th><th>Visita 1</th><th>Visita 2</th><th>Suelos</th><th>Prep. terreno</th></tr></thead><tbody>
      ${[...grupos.entries()]
        .map(([t, lista]) => {
          const r = resumenTecnico(lista);
          return `<tr><td>${escapeHtml(t)}</td><td>${r.n}</td><td>${r.v1}</td><td>${r.v2}</td><td>${r.suelos}</td><td>${escapeHtml(formatearHectareas(r.ha))} ha</td></tr>`;
        })
        .join('')}
    </tbody></table>

    <h2>Detalle por técnico</h2>
    ${[...grupos.entries()]
      .map(([t, lista]) => {
        const r = resumenTecnico(lista);
        return `<h3>${escapeHtml(t)} — ${r.n} beneficiarios · Visita 1: ${r.v1} · Visita 2: ${r.v2} · Suelos: ${r.suelos} · Prep. terreno: ${escapeHtml(formatearHectareas(r.ha))} ha</h3>
        <table><thead><tr><th>Beneficiario</th><th>Vereda</th><th>Visitas</th><th>Suelos</th><th>Actividades en hectáreas</th></tr></thead><tbody>
          ${lista
            .map(
              (f) => `<tr>
              <td><b>${escapeHtml(f.nombre)}</b><br/><span class="peq">C.C. ${escapeHtml(f.cedula)}</span></td>
              <td>${escapeHtml(f.vereda)}<br/><span class="peq">${escapeHtml(f.corregimiento)}</span></td>
              <td>${celdaVisitas(f)}</td>
              <td class="${f.suelos ? 'ok' : 'falta'}">${f.suelos ? `Subido<br/><span class="peq">${fechaCorta(f.suelos.fecha)}</span>` : 'Pendiente'}</td>
              <td>${celdaActividades(f)}</td>
            </tr>`
            )
            .join('')}
        </tbody></table>`;
      })
      .join('')}
    <p class="peq" style="margin-top:8px">Fotos = antes / durante / después (máximo 3 por momento). V.T. = visita técnica del formato antiguo, sin número. No incluye beneficiarios asignados a usuarios de prueba.</p>`;

  return envolver('Informe General — Bitácora de Beneficiarios', `Generado por ${generadoPor}`, cuerpo, variante);
}

export async function generarYAbrirInformeGeneral(generadoPor: string, rol?: string): Promise<void> {
  try {
    const filas = await obtenerInformeGeneral();
    await entregarPdf(htmlInformeGeneral(filas, generadoPor, varianteDe(rol)), 'Informe_General_Beneficiarios');
  } catch (error: any) {
    console.warn('[Bitácora PDF] Error (general):', error?.message || error);
    avisar(
      'No se pudo generar el informe',
      error?.response?.data?.mensaje || 'Verifica tu conexión a internet e inténtalo de nuevo.'
    );
  }
}
