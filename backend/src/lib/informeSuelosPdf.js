// ============================================================
// Informe PDF del Análisis de Suelos — generado en el SERVIDOR
// ============================================================
// Se imprime con Chromium headless (mismo motor en web, Android e iOS):
//   · membrete (encabezado y pie) en TODAS las páginas (thead/tfoot),
//   · "Página X de Y" en cada página (@page margin box),
//   · texto real (seleccionable), los predios nunca se parten.
// Se imprime dos veces: la primera para saber en qué página quedó cada
// sección y cada predio, la segunda con esos números en el índice.
// El PDF resultante se guarda en MinIO junto al registro del historial.
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
// El mismo membrete oficial que usan los PDF de la app (archivo sin
// dependencias; Node lo carga directamente quitando los tipos).
const { membreteAperturaHtml, membreteCierreHtml, membreteCss } = require('../../../src/utils/membrete.ts');

const execFileP = promisify(execFile);

const RUTAS_CHROMIUM = [
  process.env.CHROMIUM_PATH,
  '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const rutaChromium = () => RUTAS_CHROMIUM.find((r) => fs.existsSync(r)) || null;

const VERDE = '#2E7D32';
const ROJO = '#C62828';
const NARANJA = '#EF6C00';
const PALETA = ['#1B5E20', '#1565C0', '#EF6C00', '#6A1B9A', '#00838F', '#AD1457', '#827717', '#4E342E', '#37474F', '#C62828'];

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Número con coma decimal (formato colombiano). */
const num = (n) => (n == null ? '—' : String(n).replace('.', ','));
const miles = (n) => (n == null ? '—' : Math.round(n).toLocaleString('es-CO'));

/** Orden estable para objetos {clave: cantidad} (JSONB reordena las claves). */
const porCantidadYNombre = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es');

/** Color según la clase del laboratorio: bajo/ácido = rojo, alto = naranja, el resto = verde. */
function claseCss(interp) {
  const t = String(interp || '').toLowerCase();
  if (/extremadamente|muy fuertemente|fuertemente/.test(t) || /^baj[oa]$/.test(t)) return 'c-bajo';
  if (/^alt[oa]$/.test(t)) return 'c-alto';
  return 'c-ok';
}

function tortaSvg(datos, tamano = 120) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  const r = tamano / 2;
  if (total <= 0) return `<svg width="${tamano}" height="${tamano}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="#e0e0e0"/></svg>`;
  const con = datos.filter((d) => d.valor > 0);
  if (con.length === 1) return `<svg width="${tamano}" height="${tamano}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="${con[0].color}"/></svg>`;
  let ang = -Math.PI / 2;
  const trozos = con.map((d) => {
    const fin = ang + (d.valor / total) * Math.PI * 2;
    const p = (a) => `${(r + (r - 2) * Math.cos(a)).toFixed(2)},${(r + (r - 2) * Math.sin(a)).toFixed(2)}`;
    const pth = `M${r},${r} L${p(ang)} A${r - 2},${r - 2} 0 ${fin - ang > Math.PI ? 1 : 0} 1 ${p(fin)} Z`;
    ang = fin;
    return `<path d="${pth}" fill="${d.color}"/>`;
  });
  return `<svg width="${tamano}" height="${tamano}" viewBox="0 0 ${tamano} ${tamano}">${trozos.join('')}</svg>`;
}

const leyenda = (items) =>
  items.map((i) => `<div class="ley"><span class="pto" style="background:${i.color}"></span>${esc(i.etiqueta)}: <b>${i.valor}</b></div>`).join('');

const parrafos = (texto) =>
  String(texto)
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join('');

const variable = (d, clave) => (d?.variables || []).find((v) => v.clave === clave) || null;
const requiereEncalado = (d) =>
  !!d?.preparacion && /cal (dolomita|agr[ií]cola)|cal viva|encalar/i.test(d.preparacion) && !/no requiere encalado/i.test(d.preparacion);
/** "Aplicar 1,01 kg de cal dolomita por planta" → "1,01" */
const calPorPlanta = (d) => {
  const m = String(d?.preparacion || '').match(/Aplicar ([\d.,]+) kg de cal[^.]*?por planta/i);
  return m ? m[1] : null;
};

const fechaLarga = (iso) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  ${membreteCss()}
  @page {
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-family: Arial, sans-serif; font-size: 8pt; color: #555; }
  }
  body { font-family: 'Arial Narrow', Arial, sans-serif; color: #2d3436; }
  .salto { break-before: page; }
  /* Portada */
  .portada { text-align: center; padding-top: 40px; }
  .portada .p-tipo { font-size: 11pt; color: #555; letter-spacing: 1px; text-transform: uppercase; }
  .portada h1 { color: #1B5E20; font-size: 24pt; margin: 10px 0 6px; }
  .portada .p-alcance { font-size: 14pt; color: #1B5E20; font-weight: bold; }
  .portada .p-datos { margin: 26px auto 0; font-size: 10pt; color: #333; line-height: 1.7; }
  .portada .cifras { margin: 30px 0 0; }
  .contenido { margin: 34px auto 0; width: 80%; text-align: left; }
  .contenido .c-titulo { font-weight: bold; color: #1B5E20; font-size: 11pt; border-bottom: 1px solid #cfdccf; padding-bottom: 4px; margin-bottom: 6px; }
  .contenido .c-fila { display: flex; font-size: 10pt; padding: 3px 0; }
  .contenido .c-fila span:first-child { flex: 1; border-bottom: 1px dotted #bbb; margin-right: 6px; }
  /* Generales */
  h2 { color: #1B5E20; font-size: 12pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin: 16px 0 8px; break-after: avoid; }
  h3 { color: #1B5E20; font-size: 10.5pt; margin: 12px 0 6px; break-after: avoid; }
  .tortas { display: flex; gap: 24px; justify-content: space-around; margin-bottom: 8px; }
  .torta { text-align: center; font-size: 8.5pt; }
  .torta .t { font-weight: bold; color: #1B5E20; margin-bottom: 4px; }
  .ley { font-size: 8pt; text-align: left; margin-top: 2px; }
  .pto { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  .cifras { display: flex; gap: 8px; margin: 6px 0 4px; }
  .cifra { flex: 1; border: 1px solid #dfe6df; border-radius: 6px; padding: 6px; text-align: center; background: #f6faf6; }
  .cifra b { display: block; font-size: 13pt; color: #1B5E20; }
  .cifra span { font-size: 7.5pt; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #1B5E20; color: #fff; text-align: left; padding: 4px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f9fa; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .ok { color: ${VERDE}; font-weight: bold; } .falta { color: ${ROJO}; font-weight: bold; }
  .c-bajo { color: ${ROJO}; font-weight: bold; } .c-alto { color: ${NARANJA}; font-weight: bold; } .c-ok { color: ${VERDE}; font-weight: bold; }
  .num { text-align: right; white-space: nowrap; }
  .centro { text-align: center; }
  table.indice { font-size: 7.5pt; }
  table.indice th { padding: 3px 4px; font-size: 7pt; }
  table.indice td { padding: 2px 4px; }
  table.indice .pag { width: 34px; text-align: right; font-weight: bold; color: #1B5E20; }
  .grupo-tecnico { background: #e8f1e8; color: #1B5E20; font-weight: bold; font-size: 10pt; padding: 4px 8px; margin: 14px 0 6px; border-radius: 4px; break-after: avoid; }
  .predio { border: 1px solid #dfe6df; border-radius: 6px; padding: 6px 9px; margin-bottom: 8px; break-inside: avoid; }
  .predio-nombre { font-size: 10pt; font-weight: bold; color: #1B5E20; }
  .predio-meta { font-size: 7.5pt; color: #666; margin: 1px 0 4px; }
  table.vars { table-layout: fixed; margin-bottom: 2px; }
  table.vars td { border: 1px solid #e3e9e3; padding: 2px 3px; text-align: center; background: #fff !important; line-height: 1.15; }
  table.vars .v-et { display: block; font-size: 7pt; color: #555; }
  table.vars .v-et small { font-size: 6pt; color: #888; }
  table.vars .v-val { display: block; font-size: 8.5pt; font-weight: bold; color: #222; }
  table.vars .v-int { display: block; font-size: 6.8pt; }
  .campo { font-size: 8pt; line-height: 1.3; margin-top: 3px; }
  .campo b { color: #1B5E20; }
  .no-data { font-size: 9pt; color: #999; font-style: italic; margin-top: 6px; }
  .nota { font-size: 7.5pt; color: #777; margin: 2px 0 8px; }
  .analisis-global { margin-top: 10px; padding: 8px 12px; background: #f4f8f4; border-left: 3px solid #1B5E20; border-radius: 4px; }
  .analisis-global p { font-size: 9pt; color: #3d4a3d; line-height: 1.5; text-align: justify; }
  .analisis-global p + p { margin-top: 7px; }
  .footer-doc { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 8.5pt; color: #999; }
`;

/** Bloque de un beneficiario con su estudio. */
function htmlPredio(b, n) {
  const d = b.datos;
  const meta = [
    b.cedula ? `C.C. ${b.cedula}` : '',
    [b.corregimiento, b.vereda].filter(Boolean).join(' · '),
    d?.areaHa != null ? `${num(d.areaHa)} ha · ${miles(d.plantas)} plantas${d.distancia ? ` (${d.distancia})` : ''}` : '',
    d?.codigo ? `Muestra ${d.codigo}` : '',
  ]
    .filter(Boolean)
    .map(esc)
    .join(' &nbsp;|&nbsp; ');

  let cuerpo;
  if (d?.formato === 'resumen' && d.variables?.length) {
    const celda = (v) => {
      const m = v.etiqueta.match(/^(.*?)\s*\((.*)\)$/);
      const et = m ? `${esc(m[1])} <small>${esc(m[2])}</small>` : esc(v.etiqueta);
      return `<td><span class="v-et">${et}</span><span class="v-val">${num(v.valor)}</span><span class="v-int ${claseCss(v.interpretacion)}">${esc(v.interpretacion)}</span></td>`;
    };
    const filas = [];
    for (let i = 0; i < d.variables.length; i += 8) {
      const fila = d.variables.slice(i, i + 8);
      filas.push(`<tr>${fila.map(celda).join('')}${'<td></td>'.repeat(8 - fila.length)}</tr>`);
    }
    cuerpo = `
      <table class="vars"><tbody>${filas.join('')}</tbody></table>
      ${b.diagnostico ? `<div class="campo"><b>Diagnóstico:</b> ${esc(b.diagnostico)}</div>` : ''}
      ${d.preparacion ? `<div class="campo"><b>Preparación del sitio:</b> ${esc(d.preparacion)}</div>` : ''}
      ${d.observaciones ? `<div class="campo"><b>Observaciones del estudio:</b> ${esc(d.observaciones)}</div>` : ''}
      ${d.insumosTexto ? `<div class="campo"><b>Insumos del predio:</b> ${esc(d.insumosTexto.replace(/^Insumos para el predio\s*\([^)]*\):?\s*/i, ''))}</div>` : ''}`;
  } else if (b.lecturaIa) {
    cuerpo = `<div class="campo"><b>Lectura del resultado:</b> ${esc(b.lecturaIa)}</div>`;
  } else {
    cuerpo = '<p class="no-data">El PDF no trae datos legibles.</p>';
  }
  return `<div class="predio"><div class="predio-nombre">${n}. ${esc(b.nombre)}</div><div class="predio-meta">${meta}</div>${cuerpo}</div>`;
}

const SECCIONES = ['1. Resumen', '2. Índice y resumen de predios', '3. Resultados por beneficiario', '4. Análisis global'];

/**
 * HTML completo del informe. `paginas` (opcional) = { secciones: {titulo: pág},
 * predios: [pág por predio] } — se llena en la segunda impresión.
 */
function construirHtml(d, paginas = null) {
  const todos = d.alcance === 'tecnicos';
  const variante = d.informe.generadoPorRol === 'interventor' ? 'interventoria' : 'ejecucion';
  const fecha = fechaLarga(d.informe.creadoEn);
  const alcance = todos ? 'Todos los predios' : d.tecnico?.nombre || '';
  const titulo = `Análisis de Suelos — ${alcance}`;
  const est = d.estadisticas || { variables: [], insumos: {}, areaHa: 0, plantas: 0, requierenEncalado: 0, predios: 0 };
  const conEstudio = d.beneficiarios.filter((b) => b.tieneArchivo);
  const pendientes = d.beneficiarios.filter((b) => !b.tieneArchivo);
  const pag = (t) => (paginas?.secciones?.[t] ? String(paginas.secciones[t]) : '&nbsp;&nbsp;&nbsp;');

  const cifras = `<div class="cifras">
      <div class="cifra"><b>${d.subidos}</b><span>predios con estudio</span></div>
      <div class="cifra"><b>${num(est.areaHa)}</b><span>hectáreas</span></div>
      <div class="cifra"><b>${miles(est.plantas)}</b><span>plantas de cacao</span></div>
      <div class="cifra"><b>${est.requierenEncalado}</b><span>requieren encalado</span></div>
    </div>`;

  // ── Portada ──
  const portada = `
    <div class="portada">
      <div class="p-tipo">Informe de análisis de suelos por predio</div>
      <h1>Análisis de Suelos</h1>
      <div class="p-alcance">${esc(alcance)}</div>
      <div class="p-datos">
        Informe N.º <b>${d.informe.id}</b><br/>
        Generado por <b>${esc(d.informe.generadoPor)}</b><br/>
        ${esc(fecha)}
      </div>
      ${cifras}
      <div class="contenido">
        <div class="c-titulo">Contenido</div>
        ${SECCIONES.map((s) => `<div class="c-fila"><span>${esc(s)}</span><span>${pag(s)}</span></div>`).join('')}
      </div>
    </div>`;

  // ── 1. Resumen ──
  const faltanMeta = Math.max(d.meta - d.subidos, 0);
  const faltanAsignados = Math.max(d.asignados - d.subidos, 0);
  const porTecnico = (d.tecnicos || []).map((t, i) => ({ etiqueta: t.nombre, valor: t.subidos, color: PALETA[i % PALETA.length] }));
  const tortas = todos
    ? `<div class="tortas">
        <div class="torta"><div class="t">Estudios por técnico</div>${tortaSvg(porTecnico)}${leyenda(porTecnico)}</div>
        <div class="torta"><div class="t">Realizados vs. faltantes (meta ${d.meta})</div>
          ${tortaSvg([{ valor: d.subidos, color: VERDE }, { valor: faltanMeta, color: ROJO }])}
          ${leyenda([{ etiqueta: 'Realizados', valor: d.subidos, color: VERDE }, { etiqueta: 'Faltan', valor: faltanMeta, color: ROJO }])}
        </div></div>`
    : `<div class="tortas"><div class="torta"><div class="t">Estudios de sus beneficiarios</div>
        ${tortaSvg([{ valor: d.subidos, color: VERDE }, { valor: faltanAsignados, color: ROJO }])}
        ${leyenda([{ etiqueta: 'Con estudio', valor: d.subidos, color: VERDE }, { etiqueta: 'Sin estudio', valor: faltanAsignados, color: ROJO }])}
      </div></div>`;
  const avance = todos && d.tecnicos?.length
    ? `<h3>Avance por técnico</h3>
       <table><thead><tr><th>Técnico</th><th class="num">Asignados</th><th class="num">Con estudio</th><th class="num">Pendientes</th></tr></thead><tbody>
       ${d.tecnicos.map((t) => `<tr><td>${esc(t.nombre)}</td><td class="num">${t.asignados}</td><td class="num ok">${t.subidos}</td><td class="num falta">${Math.max(t.asignados - t.subidos, 0)}</td></tr>`).join('')}
       </tbody></table>`
    : '';
  const listaPendientes = !todos && pendientes.length
    ? `<h3>Beneficiarios sin estudio (${pendientes.length})</h3>
       <table><thead><tr><th>Beneficiario</th><th>Cédula</th><th>Vereda</th></tr></thead><tbody>
       ${pendientes.map((b) => `<tr><td>${esc(b.nombre)}</td><td>${esc(b.cedula)}</td><td>${esc(b.vereda)}</td></tr>`).join('')}
       </tbody></table>`
    : '';

  // ── 2. Índice y resumen de predios ──
  const celdaVar = (b, clave) => {
    const v = variable(b.datos, clave);
    return v ? `<td class="num ${claseCss(v.interpretacion)}">${num(v.valor)}</td>` : '<td class="num">—</td>';
  };
  const indice = conEstudio.length
    ? `<p class="nota">Valores clave de cada predio y la página donde está su detalle. Colores: <span class="c-bajo">bajo / ácido</span> · <span class="c-ok">medio, normal o ideal</span> · <span class="c-alto">alto</span>.</p>
       <table class="indice"><thead><tr>
         <th>N.º</th><th>Beneficiario</th><th>Vereda</th>${todos ? '<th>Técnico</th>' : ''}
         <th class="num">pH</th><th class="num">Sat. Al %</th><th class="num">MO</th><th class="num">P</th><th class="num">K</th>
         <th class="centro">Encalado</th><th class="num">Cal kg/planta</th><th class="pag">Pág.</th>
       </tr></thead><tbody>
       ${conEstudio
         .map((b, i) => {
           const enc = b.datos?.formato === 'resumen' ? (requiereEncalado(b.datos) ? 'Sí' : 'No') : '—';
           return `<tr><td>${i + 1}</td><td>${esc(b.nombre)}</td><td>${esc(b.vereda)}</td>${todos ? `<td>${esc(b.tecnico)}</td>` : ''}
             ${celdaVar(b, 'ph')}${celdaVar(b, 'sat_al')}${celdaVar(b, 'mo')}${celdaVar(b, 'p')}${celdaVar(b, 'k')}
             <td class="centro ${enc === 'Sí' ? 'c-bajo' : enc === 'No' ? 'c-ok' : ''}">${enc}</td>
             <td class="num">${calPorPlanta(b.datos) || '—'}</td>
             <td class="pag">${paginas?.predios?.[i] || '&nbsp;&nbsp;&nbsp;'}</td></tr>`;
         })
         .join('')}
       </tbody></table>`
    : '<p class="no-data">Aún no hay estudios de suelos subidos.</p>';

  // ── 3. Beneficiario por beneficiario ──
  let predios = '';
  let tecnicoActual;
  conEstudio.forEach((b, i) => {
    if (todos && b.tecnico !== tecnicoActual) {
      tecnicoActual = b.tecnico;
      predios += `<div class="grupo-tecnico">Técnico: ${esc(b.tecnico || 'Sin técnico')}</div>`;
    }
    predios += htmlPredio(b, i + 1);
  });

  // ── 4. Análisis global ──
  const varsConDatos = (est.variables || []).filter((v) => v.n);
  const tablaEst = varsConDatos.length
    ? `<h3>Estadísticas del conjunto (${est.predios} predios)</h3>
       <table><thead><tr><th>Variable</th><th class="num">Promedio</th><th class="num">Mínimo</th><th class="num">Máximo</th><th>Predios por clase</th></tr></thead><tbody>
       ${varsConDatos
         .map(
           (v) => `<tr><td>${esc(v.etiqueta)}</td><td class="num">${num(v.promedio)}</td><td class="num">${num(v.min)}</td><td class="num">${num(v.max)}</td>
           <td>${Object.entries(v.conteos).sort(porCantidadYNombre).map(([c, k]) => `<span class="${claseCss(c)}">${esc(c)}</span> ${k}`).join(' · ')}</td></tr>`
         )
         .join('')}
       </tbody></table>`
    : '';
  const insumos = Object.entries(est.insumos || {}).sort(porCantidadYNombre);
  const tablaInsumos = insumos.length
    ? `<h3>Insumos totales para los predios con estudio</h3>
       <table><thead><tr><th>Insumo</th><th class="num">Cantidad (kg)</th></tr></thead><tbody>
       ${insumos.map(([k, kg]) => `<tr><td>${esc(k.length <= 3 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1))}</td><td class="num">${miles(kg)}</td></tr>`).join('')}
       </tbody></table>`
    : '';
  const global = d.analisis
    ? `<h3>Conclusiones y recomendaciones</h3><div class="analisis-global">${parrafos(d.analisis)}</div>`
    : '<p class="no-data">No se pudo redactar el análisis global en este momento. Los datos de cada predio y las estadísticas sí están completos.</p>';

  const cuerpo = `
    ${portada}
    <div class="salto"></div>
    <h2>${SECCIONES[0]}</h2>${tortas}${cifras}${avance}${listaPendientes}
    <h2 class="salto">${SECCIONES[1]} (${conEstudio.length})</h2>${indice}
    <h2 class="salto">${SECCIONES[2]} (${conEstudio.length})</h2>
    <p class="nota">Valores e interpretación tomados del informe del laboratorio. Colores: <span class="c-bajo">bajo / ácido</span> · <span class="c-ok">medio, normal o ideal</span> · <span class="c-alto">alto</span>.</p>
    ${predios || '<p class="no-data">Aún no hay estudios de suelos subidos.</p>'}
    ${d.sinLeer ? `<p class="no-data">${d.sinLeer} PDF con formato distinto aún no se han leído: genera el informe de nuevo para completarlos.</p>` : ''}
    <h2 class="salto">${SECCIONES[3]}</h2>${tablaEst}${tablaInsumos}${global}
    <div class="footer-doc">Informe N.º ${d.informe.id} · Generado por ${esc(d.informe.generadoPor)} el ${esc(fecha)} · GEODAILY</div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${esc(titulo)}</title><style>${CSS}</style></head>
<body>
  ${membreteAperturaHtml(variante)}
  ${cuerpo}
  ${membreteCierreHtml()}
</body></html>`;
}

/** Imprime un HTML a PDF con Chromium headless. Devuelve { pdf: Buffer, textoPorPagina: string[] }. */
async function imprimir(html, dir, nombre) {
  const chromium = rutaChromium();
  if (!chromium) throw new Error('Chromium no está instalado en el servidor (defina CHROMIUM_PATH)');
  const rutaHtml = path.join(dir, `${nombre}.html`);
  const rutaPdf = path.join(dir, `${nombre}.pdf`);
  fs.writeFileSync(rutaHtml, html);
  await execFileP(
    chromium,
    ['--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${rutaPdf}`, `file://${rutaHtml}`],
    { timeout: 90000 }
  );
  const pdf = fs.readFileSync(rutaPdf);
  let textoPorPagina = [];
  try {
    const { stdout } = await execFileP('pdftotext', ['-layout', rutaPdf, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    textoPorPagina = stdout.split('\f');
  } catch {
    // Sin pdftotext el índice queda sin números de página, el PDF sale igual.
  }
  return { pdf, textoPorPagina };
}

const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Busca en qué página quedó cada sección y cada predio. */
function localizarPaginas(d, textoPorPagina) {
  const paginas = textoPorPagina.map(normalizar);
  const secciones = {};
  // Las secciones se buscan en orden después de la portada (que también las nombra).
  let desde = 1;
  for (const s of SECCIONES) {
    const clave = normalizar(s);
    const i = paginas.findIndex((t, k) => k >= desde && t.includes(clave));
    if (i >= 0) {
      secciones[s] = i + 1;
      desde = i;
    }
  }
  const predios = [];
  const inicio = (secciones[SECCIONES[2]] || 1) - 1;
  let k = inicio;
  const conEstudio = d.beneficiarios.filter((b) => b.tieneArchivo);
  conEstudio.forEach((b, i) => {
    const marca = normalizar(`${i + 1}. ${b.nombre}`).slice(0, 28);
    let j = k;
    while (j < paginas.length && !paginas[j].includes(marca)) j += 1;
    if (j < paginas.length) {
      predios[i] = j + 1;
      k = j;
    }
  });
  return { secciones, predios };
}

/** Genera el PDF final del informe (dos pasadas para el índice). */
async function generarPdfInforme(informe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'informe-suelos-'));
  try {
    const primera = await imprimir(construirHtml(informe), dir, 'p1');
    if (!primera.textoPorPagina.length) return primera.pdf;
    const paginas = localizarPaginas(informe, primera.textoPorPagina);
    const segunda = await imprimir(construirHtml(informe, paginas), dir, 'p2');
    return segunda.pdf;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { generarPdfInforme, construirHtml, rutaChromium };
