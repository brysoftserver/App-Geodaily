// ============================================================
// Informe CONSOLIDADO de una ECA (PM. 2 FO. 12) — generado en el SERVIDOR
// ============================================================
// Cada grupo de veredas sube su propio "Informe de ejecución de la Escuela de
// Campo" (formato FO. 12). Este módulo lee esos informes y arma UNO solo para
// toda la ECA, en el mismo formato:
//   1. Lee el texto de cada informe de grupo (pdf-parse). Solo cuenta un PDF
//      que sea un FO. 12; anexos como diapositivas se ignoran. Los grupos sin
//      informe simplemente no participan (el consolidado no los menciona).
//   2. La ficha (técnicos, fechas, ubicación, participantes) sale de los
//      campos del formato por expresiones regulares; las cifras se suman en
//      código, nunca las inventa la IA.
//   3. La IA (DeepSeek) resume cada informe y luego redacta el consolidado
//      (objetivo, actividades, desarrollo, dificultades, conclusiones). Sin
//      IA, el informe sale igual con el texto de cada grupo por sección.
//   4. Anexo fotográfico: TODAS las fotos del Registro Fotográfico de cada
//      grupo; si un grupo no tiene, se sacan las fotos del propio informe.
//   5. Chromium imprime el HTML con el membrete oficial y pdf-lib estampa
//      "Página X de Y" dentro del recuadro del membrete en cada página.
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const storage = require('../storage');
const { preguntar } = require('./deepseek');
const { GRUPOS_VEREDAS } = require('./fortalecimiento');
const { rutaChromium } = require('./informeSuelosPdf');
const { membreteAperturaHtml, membreteCierreHtml, membreteCss } = require('../../../src/utils/membrete.ts');

const execFileP = promisify(execFile);

/** Sube este número si cambia el diseño: invalida los PDF guardados. */
const VERSION_FORMATO = 1;

const VERDE = '#1B5E20';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Texto con saltos de párrafo → <p>…</p>. */
const parrafos = (t) =>
  String(t || '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaTexto = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : null;
};

const fechaHoraLarga = (d) =>
  new Date(d).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });

/** Ejecuta tareas asíncronas con un máximo de `n` simultáneas. */
async function enParalelo(items, n, fn) {
  const salida = new Array(items.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      salida[k] = await fn(items[k], k);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

async function leerArchivo(key) {
  const stream = await storage.getFileStream(key);
  if (!stream) throw new Error(`Archivo no disponible: ${key}`);
  const partes = [];
  for await (const c of stream) partes.push(c);
  return Buffer.concat(partes);
}

// ─── Lectura de los informes ────────────────────────────────

const ES_FO12 = /INFORME\s+DE\s+EJECUCI[ÓO]N\s+DE\s+LA\s+ESCUELA\s+DE\s+CAMPO/i;

/** Quita el membrete que se repite en cada página del informe original. */
function limpiarTexto(texto) {
  const basura = [
    /^Rep[úu]blica de Colombia\s*$/i,
    /^Departamento del Caquet[áa]\s*$/i,
    /^AGROINDUSTRIAL CACAOTERA/i,
    /^NIT\.?\s*902/i,
    /^DIRECCI[ÓO]N T[ÉE]CNICA\s*$/i,
    /^P[áa]gina \d+ de \d+\s*$/i,
    /^PM\.?\s*2\s*FO/i,
    /^INFORME ESCUELA DE CAMPO\s*$/i,
  ];
  return String(texto || '')
    .split('\n')
    .filter((l) => !basura.some((r) => r.test(l.trim())))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cuerpo del informe sin el anexo fotográfico (ahorra tokens a la IA). */
const sinAnexos = (t) => t.split(/\bANEXO\s+1\s*\./i)[0];

const normalizarNombre = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const plano = (t) => t.replace(/\s+/g, ' ').trim();
const NUMEROS_PALABRA = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };

/** Campos de la cabecera del FO. 12 (siempre en el mismo orden). */
function fichaPorRegex(texto) {
  const t = plano(texto);
  const campo = (re) => (t.match(re)?.[1] || '').trim() || null;
  const tecnicos = campo(/t[ée]cnico a cargo:\s*(.+?)\s*(?:Acompa[ñn]amiento t[ée]cnico:|Nombre de la ECA:)/i);
  const acompanamiento = campo(/Acompa[ñn]amiento t[ée]cnico:\s*(.+?)\s*Nombre de la ECA:/i);
  const nombreEca = campo(/Nombre de la ECA:\s*(.+?)\s*Tema o M[óo]dulo/i);
  const temas = campo(/Tema o M[óo]dulo Desarrollado:\s*(.+?)\s*Fecha y Duraci[óo]n/i);
  const fechaDuracion = campo(/Fecha y Duraci[óo]n Total:\s*(.+?)\s*Ubicaci[óo]n:/i);
  const ubicacion = campo(/Ubicaci[óo]n:\s*(.+?)\s*No\.?\s*(?:de\s*)?Participantes/i);
  const partTxt = campo(/Participantes Registrados:\s*(.{1,40}?)\s*(?:1\.\s*OBJETIVO|OBJETIVO)/i);
  let participantes = null;
  if (partTxt) {
    const m = partTxt.match(/\((\d+)\)/) || partTxt.match(/\d+/);
    if (m) participantes = Number(m[1] ?? m[0]);
  }
  let horas = null;
  const h = (fechaDuracion || '').match(/(?:\((\d+)\)|(\d+)|(\b[a-z]+\b))\s*\)?\s*horas/i);
  if (h) horas = Number(h[1] || h[2]) || NUMEROS_PALABRA[(h[3] || '').toLowerCase()] || null;
  return { tecnicos, acompanamiento, nombreEca, temas, fechaDuracion, ubicacion, participantes, horas };
}

/** Texto de una sección del formato, entre dos títulos (para el modo sin IA). */
function seccionPorRegex(texto, desde, hasta) {
  const m = plano(texto).match(new RegExp(`${desde}\\s*(.+?)\\s*(?:${hasta})`, 'i'));
  return m ? m[1].trim() : null;
}

// ─── IA ─────────────────────────────────────────────────────

const SISTEMA_EXTRAER = `Eres un profesional agrónomo que revisa informes de Escuelas de Campo para Agricultores (ECA) de un proyecto de cacao en Puerto Rico, Caquetá (Colombia). Recibes el texto de UN informe en formato "PM. 2 FO. 12 – Informe de ejecución de la Escuela de Campo" y devuelves SOLO un JSON con esta forma:
{
  "fecha": "AAAA-MM-DD o null",
  "horas": número o null,
  "participantes": número o null,
  "objetivo": "texto",
  "actividades": [{"actividad": "…", "descripcion": "…", "tiempo": "…"}],
  "momentos": [{"titulo": "…", "temas": ["…"], "desarrollo": "resumen fiel de lo que se hizo y lo que se observó, 3 a 6 frases"}],
  "dificultades": "texto o cadena vacía si no hubo",
  "compromisos": [{"acuerdo": "…", "responsable": "…", "fecha": "…"}],
  "conclusiones": "texto o cadena vacía"
}
Reglas: no inventes nada que no esté en el texto; conserva cifras, nombres y tiempos tal como aparecen; si el informe dice que no hubo compromisos, devuelve una lista vacía.`;

const SISTEMA_CONSOLIDAR = `Eres un profesional agrónomo que redacta el INFORME CONSOLIDADO de una Escuela de Campo para Agricultores (ECA) de un proyecto de cacao en Puerto Rico, Caquetá (Colombia), en el formato "PM. 2 FO. 12 – Informe de ejecución de la Escuela de Campo". Recibes un JSON con el resumen del informe de cada grupo de veredas que ejecutó la ECA. Devuelve SOLO un JSON con esta forma:
{
  "objetivo": "objetivo de la ECA (uno solo, el común a los grupos)",
  "actividades": [{"actividad": "…", "descripcion": "descripción unificada", "tiempo": "tiempo estipulado"}],
  "desarrollo": [{"titulo": "título del momento o bloque temático", "temas": ["…"], "texto": "2 a 4 párrafos que consoliden cómo se desarrolló en los grupos, separados por salto de línea"}],
  "resultados": "2 o 3 párrafos con los resultados generales de la ECA, separados por salto de línea",
  "dificultades": "dificultades encontradas en conjunto, indicando en qué grupo ocurrió cada una; cadena vacía si ninguno reportó",
  "compromisos": [{"acuerdo": "…", "responsable": "…", "fecha": "…"}],
  "conclusiones": "2 o 3 párrafos de conclusiones del conjunto, separados por salto de línea"
}
Reglas: español formal, tercera persona, pasado. Usa SOLO la información recibida, sin inventar cifras, nombres ni hechos. Cuando algo solo ocurrió en algunos grupos, nómbralos ("Grupo 2", "Grupo 5"). Nunca menciones grupos que no aparecen en los datos ni digas que falta información de algún grupo. No incluyas el número total de participantes ni las fechas (se ponen aparte).`;

async function pedirJson(sistema, usuario, maxTokens) {
  const r = await preguntar({ sistema, usuario, json: true, maxTokens, timeoutMs: 180000 });
  if (!r) return null;
  try {
    return JSON.parse(r);
  } catch {
    const m = r.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  }
}

const lista = (x) => (Array.isArray(x) ? x : []);
const txt = (x) => (typeof x === 'string' ? x.trim() : '');

// ─── Fotos ──────────────────────────────────────────────────

/** Foto lista para el PDF: orientada por EXIF, ≤1400 px, JPEG liviano. */
async function prepararFoto(buffer, destino) {
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toFile(destino);
  return destino;
}

/**
 * Fotos incrustadas en un informe PDF (su anexo fotográfico). Se descartan
 * las imágenes que se repiten en varias páginas (logos del membrete) y las
 * muy pequeñas.
 */
async function fotosDelInforme(pdfBuffer, dir, prefijo) {
  const rutaPdf = path.join(dir, `${prefijo}.pdf`);
  fs.writeFileSync(rutaPdf, pdfBuffer);
  let lista;
  try {
    const { stdout } = await execFileP('pdfimages', ['-list', rutaPdf], { maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
    lista = stdout
      .split('\n')
      .slice(2)
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length > 11 && c[2] === 'image')
      .map((c) => ({ pagina: Number(c[0]), num: Number(c[1]), ancho: Number(c[3]), alto: Number(c[4]), objeto: c[10] }));
  } catch {
    return [];
  }
  const paginasPorObjeto = {};
  for (const i of lista) (paginasPorObjeto[i.objeto] = paginasPorObjeto[i.objeto] || new Set()).add(i.pagina);
  const vistos = new Set();
  const elegidas = lista.filter((i) => {
    if (paginasPorObjeto[i.objeto].size > 1 || vistos.has(i.objeto)) return false;
    vistos.add(i.objeto);
    return i.ancho >= 300 && i.alto >= 220;
  });
  if (!elegidas.length) return [];
  const raiz = path.join(dir, `${prefijo}-img`);
  await execFileP('pdfimages', ['-all', rutaPdf, raiz], { timeout: 120000 }).catch(() => null);
  const archivos = fs.readdirSync(dir).filter((f) => f.startsWith(`${prefijo}-img-`));
  const salida = [];
  for (const i of elegidas) {
    const nombre = archivos.find((f) => f.startsWith(`${prefijo}-img-${String(i.num).padStart(3, '0')}.`));
    if (!nombre) continue;
    try {
      salida.push(await prepararFoto(fs.readFileSync(path.join(dir, nombre)), path.join(dir, `${prefijo}-f${i.num}.jpg`)));
    } catch {
      // Imagen ilegible (máscara, formato raro): se omite.
    }
  }
  return salida;
}

// ─── HTML ───────────────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  ${membreteCss()}
  body { font-family: Arial, sans-serif; color: #111; font-size: 10pt; }
  .titulo-doc { text-align: center; font-weight: bold; font-size: 11pt; margin: 2px 0 2px; }
  .subtitulo-doc { text-align: center; font-weight: bold; font-size: 10pt; color: ${VERDE}; margin-bottom: 10px; }
  table.ficha { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.ficha td { border: 1pt solid #000; padding: 4px 6px; vertical-align: top; font-size: 9.5pt; line-height: 1.35; }
  table.ficha td.et { width: 32%; font-weight: bold; background: #f1f5f1; }
  h2 { font-size: 10.5pt; font-weight: bold; margin: 14px 0 6px; break-after: avoid; }
  h3 { font-size: 10pt; font-weight: bold; margin: 10px 0 4px; color: ${VERDE}; break-after: avoid; }
  p { text-align: justify; line-height: 1.45; margin-bottom: 6px; }
  ul.temas { margin: 2px 0 6px 18px; } ul.temas li { margin-bottom: 1px; line-height: 1.35; }
  table.tabla { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.8pt; }
  table.tabla th { border: 1pt solid #000; background: #e3ece3; padding: 4px 5px; text-align: center; font-weight: bold; }
  table.tabla td { border: 1pt solid #000; padding: 4px 5px; vertical-align: top; line-height: 1.3; }
  table.tabla tr { break-inside: avoid; }
  table.tabla thead { display: table-header-group; }
  .centro { text-align: center; } .num { text-align: center; white-space: nowrap; }
  .total td { font-weight: bold; background: #f1f5f1; }
  .veredas { font-size: 7.5pt; color: #444; }
  .grupo-fotos { margin-top: 10px; }
  .grupo-fotos h3 { border-bottom: 1px solid #cfdccf; padding-bottom: 3px; }
  .fotos { display: flex; flex-wrap: wrap; justify-content: space-between; }
  .foto { width: 49%; margin-bottom: 6px; break-inside: avoid; text-align: center; }
  .foto .marco { height: 5.7cm; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center; background: #fafafa; }
  .foto img { max-width: 100%; max-height: 100%; }
  .foto .pie { font-size: 8pt; margin-top: 2px; }
  .firma { margin-top: 36px; break-inside: avoid; font-size: 9.5pt; }
  .firma .linea { width: 7cm; border-top: 1px solid #000; margin-bottom: 3px; }
  .nota { font-size: 8pt; color: #555; margin-top: 4px; }
`;

function tablaActividades(actividades) {
  if (!actividades.length) return '';
  return `<table class="tabla"><thead><tr><th style="width:7%">ÍTEM</th><th style="width:25%">ACTIVIDAD</th><th>DESCRIPCIÓN</th><th style="width:14%">TIEMPO ESTIPULADO</th></tr></thead><tbody>
    ${actividades.map((a, i) => `<tr><td class="centro">${i + 1}</td><td>${esc(txt(a.actividad))}</td><td>${esc(txt(a.descripcion))}</td><td class="centro">${esc(txt(a.tiempo))}</td></tr>`).join('')}
  </tbody></table>`;
}

function tablaCompromisos(compromisos) {
  const filas = compromisos.length
    ? compromisos.map((c) => `<tr><td>${esc(txt(c.acuerdo))}</td><td>${esc(txt(c.responsable))}</td><td class="centro">${esc(txt(c.fecha))}</td></tr>`).join('')
    : '<tr><td>No se establecieron compromisos específicos durante el desarrollo de las jornadas</td><td class="centro">No aplica</td><td class="centro">No aplica</td></tr>';
  return `<table class="tabla"><thead><tr><th>ACUERDO / COMPROMISO ESTABLECIDO</th><th style="width:25%">RESPONSABLE(S)</th><th style="width:18%">FECHA LÍMITE</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function construirHtml(d) {
  const { eca, grupos, ficha, cons, generadoPor, generadoEn } = d;
  const temasLista = (ficha.temas || '')
    .split(/\s*(?=\b\d{1,2}\)\s)/)
    .map((t) => t.trim())
    .filter(Boolean);

  const filasGrupos = grupos
    .map(
      (g) => `<tr>
        <td class="centro"><b>Grupo ${g.grupo}</b></td>
        <td>${esc(g.ficha.ubicacion || '—')}<div class="veredas">${esc(g.veredas)}</div></td>
        <td class="centro">${esc(fechaTexto(g.fecha) || g.ficha.fechaDuracion || '—')}</td>
        <td>${esc([g.ficha.tecnicos, g.ficha.acompanamiento && `Acompañamiento: ${g.ficha.acompanamiento}`].filter(Boolean).join('. ') || '—')}</td>
        <td class="num">${g.participantes ?? '—'}</td>
      </tr>`
    )
    .join('');

  const desarrollo = lista(cons.desarrollo)
    .map(
      (m, i) => `<h3>3.${i + 1}. ${esc(txt(m.titulo))}</h3>
        ${lista(m.temas).length ? `<ul class="temas">${lista(m.temas).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${parrafos(m.texto)}`
    )
    .join('');

  let nFoto = 0;
  const anexoFotos = grupos
    .filter((g) => g.fotos.length)
    .map(
      (g) => `<div class="grupo-fotos"><h3>Grupo ${g.grupo} — ${esc(g.ficha.ubicacion || g.veredas)}</h3><div class="fotos">
        ${g.fotos
          .map((f) => {
            nFoto += 1;
            return `<div class="foto"><div class="marco"><img src="file://${f}" /></div><div class="pie">Imagen ${nFoto}. Grupo ${g.grupo}${g.ficha.ubicacion ? ` – ${esc(g.ficha.ubicacion)}` : ''}</div></div>`;
          })
          .join('')}
      </div></div>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  ${membreteAperturaHtml('ejecucion', 'informe_eca', 1, 1)}
    <div class="titulo-doc">INFORME DE EJECUCIÓN DE LA ESCUELA DE CAMPO (ECA)</div>
    <div class="subtitulo-doc">CONSOLIDADO ECA ${eca} — ${grupos.length} grupo${grupos.length === 1 ? '' : 's'} de veredas</div>

    <table class="ficha">
      <tr><td class="et">Nombre(s) de técnico a cargo:</td><td>${esc(ficha.tecnicos.join(', ') || '—')}</td></tr>
      <tr><td class="et">Nombre de la ECA:</td><td>${esc(ficha.nombreEca || `ECA ${eca}`)}</td></tr>
      <tr><td class="et">Tema o Módulo Desarrollado:</td><td>${temasLista.length > 1 ? temasLista.map(esc).join('<br>') : esc(ficha.temas || '—')}</td></tr>
      <tr><td class="et">Fecha y Duración Total:</td><td>${esc(ficha.fechas)}${ficha.duracion ? `<br>${esc(ficha.duracion)}` : ''}</td></tr>
      <tr><td class="et">Ubicación:</td><td>${grupos.map((g) => `Grupo ${g.grupo}: ${esc(g.ficha.ubicacion || g.veredas)}`).join('<br>')}</td></tr>
      <tr><td class="et">No. Participantes Registrados:</td><td><b>${ficha.participantes ?? '—'}</b></td></tr>
    </table>

    <h2>1. OBJETIVO DE LA ECA</h2>
    ${parrafos(cons.objetivo) || '<p>—</p>'}

    <h2>2. ACTIVIDADES EJECUTADAS, METODOLOGÍA Y RESULTADOS</h2>
    ${tablaActividades(lista(cons.actividades))}
    <h3>Jornadas realizadas por grupo</h3>
    <table class="tabla"><thead><tr><th style="width:11%">GRUPO</th><th>UBICACIÓN / VEREDAS</th><th style="width:15%">FECHA</th><th style="width:24%">TÉCNICO(S)</th><th style="width:11%">PARTICIPANTES</th></tr></thead><tbody>
      ${filasGrupos}
      <tr class="total"><td colspan="4" style="text-align:right">Total participantes registrados</td><td class="num">${ficha.participantes ?? '—'}</td></tr>
    </tbody></table>
    ${cons.resultados ? `<h3>Resultados</h3>${parrafos(cons.resultados)}` : ''}

    <h2>3. DESARROLLO DE LA ACTIVIDAD</h2>
    ${desarrollo || '<p>—</p>'}

    <h2>4. DIFICULTADES ENCONTRADAS</h2>
    ${parrafos(cons.dificultades) || '<p>No se reportaron dificultades durante el desarrollo de las jornadas.</p>'}

    <h2>5. CONCLUSIONES Y COMPROMISOS</h2>
    ${tablaCompromisos(lista(cons.compromisos))}
    ${parrafos(cons.conclusiones)}

    <h2>6. ANEXOS</h2>
    <ul class="temas">
      <li>Registro fotográfico con evidencia de los grupos (Anexo 1).</li>
      <li>Informes de ejecución de cada grupo y listas oficiales de asistencia firmadas (disponibles en GEODAILY, ECA ${eca}, por grupo).</li>
    </ul>

    <div class="firma">
      <div class="linea"></div>
      <div>Consolidado generado por: <b>${esc(generadoPor || '—')}</b></div>
      <div>Fecha de generación: ${esc(fechaHoraLarga(generadoEn))}</div>
      <div class="nota">Consolidado elaborado a partir de los informes de ejecución (PM. 2 FO. 12) de los grupos ${grupos.map((g) => g.grupo).join(', ')}.</div>
    </div>

    ${anexoFotos ? `<div style="break-before: page"></div><h2>ANEXO 1. REGISTRO FOTOGRÁFICO</h2>${anexoFotos}` : ''}
  ${membreteCierreHtml()}
  </body></html>`;
}

// ─── Impresión y numeración ─────────────────────────────────

async function imprimir(html, dir) {
  const chromium = rutaChromium();
  if (!chromium) throw new Error('Chromium no está instalado en el servidor (defina CHROMIUM_PATH)');
  const rutaHtml = path.join(dir, 'consolidado.html');
  const rutaPdf = path.join(dir, 'consolidado.pdf');
  fs.writeFileSync(rutaHtml, html);
  await execFileP(
    chromium,
    ['--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${rutaPdf}`, `file://${rutaHtml}`],
    { timeout: 240000, maxBuffer: 16 * 1024 * 1024 }
  );
  return rutaPdf;
}

/**
 * El membrete trae "Página 1 de 1" fijo (el encabezado se repite igual en
 * todas las páginas). Se localiza ese texto en la página 1 y, en cada
 * página, se tapa y se escribe el número real.
 */
async function numerarPaginas(rutaPdf) {
  const doc = await PDFDocument.load(fs.readFileSync(rutaPdf));
  const total = doc.getPageCount();
  let caja = null;
  try {
    const { stdout } = await execFileP('pdftotext', ['-bbox', '-f', '1', '-l', '1', rutaPdf, '-'], { timeout: 30000 });
    const palabras = [...stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
      x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5],
    }));
    const i = palabras.findIndex((w, k) => /^P.gina$/.test(w.t) && palabras[k + 2]?.t === 'de');
    if (i >= 0) {
      const grupo = palabras.slice(i, i + 4);
      caja = { x0: grupo[0].x0, x1: grupo[3].x1, y0: Math.min(...grupo.map((w) => w.y0)), y1: Math.max(...grupo.map((w) => w.y1)) };
    }
  } catch {
    // Sin pdftotext no se numera dentro del recuadro.
  }
  if (!caja) return { pdf: Buffer.from(await doc.save()), total };

  const fuente = await doc.embedFont(StandardFonts.HelveticaBold);
  const tam = Math.max(6, (caja.y1 - caja.y0) * 0.78);
  const centro = (caja.x0 + caja.x1) / 2;
  for (let p = 0; p < total; p++) {
    const pagina = doc.getPage(p);
    const alto = pagina.getHeight();
    pagina.drawRectangle({ x: caja.x0 - 1, y: alto - caja.y1 - 1, width: caja.x1 - caja.x0 + 2, height: caja.y1 - caja.y0 + 2, color: rgb(1, 1, 1) });
    const texto = `Página ${p + 1} de ${total}`;
    const ancho = fuente.widthOfTextAtSize(texto, tam);
    pagina.drawText(texto, { x: centro - ancho / 2, y: alto - caja.y1 + (caja.y1 - caja.y0) * 0.22, size: tam, font: fuente, color: rgb(0, 0, 0) });
  }
  return { pdf: Buffer.from(await doc.save()), total };
}

// ─── Orquestación ───────────────────────────────────────────

/** Huella de los archivos que alimentan el consolidado de una ECA. */
function huella(filas) {
  const base = `${VERSION_FORMATO}|${filas.map((f) => `${f.id}:${f.seccion}`).sort().join(',')}`;
  return crypto.createHash('sha1').update(base).digest('hex');
}

/**
 * Genera el consolidado. `filas` = archivos de la ECA (secciones informes y
 * registro_fotografico). `etapa(texto)` informa el avance.
 * Devuelve { pdf, paginas, resumen }.
 */
async function generarConsolidadoEca({ eca, filas, generadoPor, etapa = () => {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `consolidado-eca${eca}-`));
  try {
    // 1. Informes FO. 12 de cada grupo.
    etapa('Leyendo los informes de los grupos');
    const informesFilas = filas.filter((f) => f.seccion === 'informes' && f.mime === 'application/pdf');
    const leidos = await enParalelo(informesFilas, 3, async (f) => {
      try {
        const buffer = await leerArchivo(f.storage_key);
        const { text } = await pdfParse(buffer);
        return ES_FO12.test(text) ? { fila: f, buffer, texto: limpiarTexto(text) } : null;
      } catch (e) {
        console.warn(`[Consolidado ECA] No se pudo leer el informe ${f.id}:`, e.message);
        return null;
      }
    });

    const grupos = [];
    for (let g = 1; g <= GRUPOS_VEREDAS.length; g++) {
      const propios = leidos.filter((x) => x && x.fila.grupo === g);
      if (!propios.length) continue;
      const texto = propios.map((x) => x.texto).join('\n\n');
      const ficha = fichaPorRegex(propios[0].texto);
      grupos.push({ grupo: g, veredas: GRUPOS_VEREDAS[g - 1], informes: propios, texto, ficha, participantes: ficha.participantes, fecha: null, fotos: [] });
    }
    if (!grupos.length) {
      const e = new Error('Ningún grupo de esta ECA tiene aún su informe (formato FO. 12).');
      e.sinInformes = true;
      throw e;
    }

    // 2. IA: resumen de cada grupo y luego el consolidado.
    etapa(`Analizando ${grupos.length} informe${grupos.length === 1 ? '' : 's'} con IA`);
    await enParalelo(grupos, 4, async (g) => {
      g.ia = await pedirJson(SISTEMA_EXTRAER, sinAnexos(g.texto).slice(0, 45000), 4000);
      if (g.ia) {
        if (g.participantes == null && Number.isFinite(g.ia.participantes)) g.participantes = g.ia.participantes;
        if (g.ficha.horas == null && Number.isFinite(g.ia.horas)) g.ficha.horas = g.ia.horas;
        if (/^\d{4}-\d{2}-\d{2}$/.test(g.ia.fecha || '')) g.fecha = g.ia.fecha;
      }
    });

    etapa('Redactando el consolidado');
    let cons = null;
    const conIa = grupos.filter((g) => g.ia);
    if (conIa.length) {
      const entrada = conIa.map((g) => ({
        grupo: g.grupo,
        ubicacion: g.ficha.ubicacion,
        tecnicos: g.ficha.tecnicos,
        objetivo: g.ia.objetivo,
        actividades: g.ia.actividades,
        momentos: g.ia.momentos,
        dificultades: g.ia.dificultades,
        compromisos: g.ia.compromisos,
        conclusiones: g.ia.conclusiones,
      }));
      cons = await pedirJson(SISTEMA_CONSOLIDAR, JSON.stringify(entrada), 7000);
    }
    if (!cons) cons = consolidadoSinIa(grupos);

    // 3. Ficha consolidada (en código).
    // Un mismo técnico aparece escrito distinto ("Sergio Malaver" / "Sergio
    // Antonio Malaver Ramírez"): si las palabras de un nombre están todas en
    // otro, se deja el más completo.
    const palabras = (n) => normalizarNombre(n).split(' ').filter(Boolean);
    const contenido = (a, b) => palabras(a).every((w) => palabras(b).includes(w));
    const tecnicos = [];
    for (const g of grupos) {
      for (const n of `${g.ficha.tecnicos || ''},${g.ficha.acompanamiento || ''}`.split(/\s*,\s*|\s+y\s+/)) {
        const nombre = n.trim().replace(/\.$/, '');
        if (!nombre) continue;
        const i = tecnicos.findIndex((t) => contenido(nombre, t) || contenido(t, nombre));
        if (i < 0) tecnicos.push(nombre);
        else if (palabras(nombre).length > palabras(tecnicos[i]).length) tecnicos[i] = nombre;
      }
    }
    const masComun = (valores) => {
      const c = {};
      valores.filter(Boolean).forEach((v) => (c[v] = (c[v] || 0) + 1));
      return Object.entries(c).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || null;
    };
    const fechas = grupos.map((g) => g.fecha).filter(Boolean).sort();
    const horas = grupos.map((g) => g.ficha.horas).filter((h) => Number.isFinite(h));
    const ficha = {
      tecnicos,
      nombreEca: masComun(grupos.map((g) => g.ficha.nombreEca)),
      temas: masComun(grupos.map((g) => g.ficha.temas)),
      fechas:
        fechas.length === grupos.length && fechas.length
          ? fechas[0] === fechas[fechas.length - 1]
            ? fechaTexto(fechas[0])
            : `Del ${fechaTexto(fechas[0])} al ${fechaTexto(fechas[fechas.length - 1])}`
          : grupos.map((g) => `Grupo ${g.grupo}: ${fechaTexto(g.fecha) || g.ficha.fechaDuracion || '—'}`).join(' · '),
      duracion: horas.length
        ? `${grupos.length} jornada${grupos.length === 1 ? '' : 's'}${horas.every((h) => h === horas[0]) ? ` de ${horas[0]} horas` : ''} — ${horas.reduce((s, h) => s + h, 0)} horas en total`
        : null,
      participantes: grupos.some((g) => g.participantes != null) ? grupos.reduce((s, g) => s + (g.participantes || 0), 0) : null,
    };

    // 4. Fotos: todo el Registro Fotográfico; si el grupo no tiene, las del informe.
    const fotosFilas = filas.filter((f) => f.seccion === 'registro_fotografico' && /^image\//.test(f.mime));
    etapa(`Preparando las fotos (${fotosFilas.length})`);
    await enParalelo(fotosFilas, 4, async (f) => {
      const g = grupos.find((x) => x.grupo === f.grupo);
      if (!g) return;
      try {
        const destino = path.join(dir, `foto_${f.id}.jpg`);
        await prepararFoto(await leerArchivo(f.storage_key), destino);
        (g.fotosRegistro = g.fotosRegistro || []).push({ id: f.id, ruta: destino });
      } catch (e) {
        console.warn(`[Consolidado ECA] Foto ${f.id} omitida:`, e.message);
      }
    });
    for (const g of grupos) {
      if (g.fotosRegistro?.length) {
        g.fotos = g.fotosRegistro.sort((a, b) => a.id - b.id).map((x) => x.ruta);
      } else {
        for (const [k, inf] of g.informes.entries()) g.fotos.push(...(await fotosDelInforme(inf.buffer, dir, `inf${g.grupo}_${k}`)));
      }
    }

    // 5. PDF.
    etapa('Armando el PDF');
    const generadoEn = new Date();
    const rutaPdf = await imprimir(construirHtml({ eca, grupos, ficha, cons, generadoPor, generadoEn }), dir);
    etapa('Numerando las páginas');
    const { pdf, total } = await numerarPaginas(rutaPdf);

    const resumen = {
      grupos: grupos.map((g) => ({ grupo: g.grupo, participantes: g.participantes, fotos: g.fotos.length, fecha: g.fecha })),
      participantes: ficha.participantes,
      fotos: grupos.reduce((s, g) => s + g.fotos.length, 0),
      conIa: conIa.length > 0 && cons.__sinIa !== true,
    };
    return { pdf, paginas: total, resumen };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Sin IA: cada sección muestra lo que escribió cada grupo. */
function consolidadoSinIa(grupos) {
  const porGrupo = (desde, hasta) =>
    grupos
      .map((g) => {
        const t = seccionPorRegex(g.texto, desde, hasta);
        return t ? `Grupo ${g.grupo}: ${t}` : null;
      })
      .filter(Boolean)
      .join('\n');
  return {
    __sinIa: true,
    objetivo: seccionPorRegex(grupos[0].texto, '1\\.\\s*OBJETIVO DE LA ECA', '2\\.\\s*ACTIVIDADES') || '',
    actividades: [],
    desarrollo: grupos.map((g) => ({
      titulo: `Grupo ${g.grupo}${g.ficha.ubicacion ? ` — ${g.ficha.ubicacion}` : ''}`,
      temas: [],
      texto: (seccionPorRegex(g.texto, 'DESARROLLO DE LA ACTIVIDAD', '\\d\\.\\s*DIFICULTADES') || '').slice(0, 6000),
    })),
    resultados: '',
    dificultades: porGrupo('DIFICULTADES ENCONTRADAS', '\\d\\.\\s*CONCLUSIONES'),
    compromisos: [],
    conclusiones: porGrupo('CONCLUSIONES Y COMPROMISOS', '\\d\\.\\s*ANEXOS|Firma del T'),
  };
}

module.exports = { generarConsolidadoEca, huella, construirHtml, fichaPorRegex, limpiarTexto, ES_FO12 };
