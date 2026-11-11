// ============================================================
// Lectura determinística del PDF de Análisis de Suelos
// ============================================================
// Cada PDF del laboratorio (AGROSAVIA) del contrato trae al final una hoja de
// resumen por predio (Anexo B):
//   · Área del predio · densidad · plantas por predio
//   · tabla "Variable Valor Interpretación" (16 variables)
//   · Preparación del sitio (encalado y abono)
//   · Nutrientes aportados / Insumos para el predio
//   · Observaciones del agrónomo
// Se extrae SIN IA: el mismo PDF da siempre el mismo resultado. Si el PDF no
// trae esa hoja, se devuelve el texto de la sección "4. Resultados del
// Análisis" para que la IA lo interprete.
// ============================================================

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch {
  pdfParse = null;
}

/** Variables de la hoja de resumen, en el orden en que se muestran. */
const VARIABLES = [
  { clave: 'ph', etiqueta: 'pH' },
  { clave: 'mo', etiqueta: 'MO (g/100g)' },
  { clave: 'p', etiqueta: 'P (mg/kg)' },
  { clave: 's', etiqueta: 'S (mg/kg)' },
  { clave: 'k', etiqueta: 'K (cmol(+)/kg)' },
  { clave: 'ca', etiqueta: 'Ca (cmol(+)/kg)' },
  { clave: 'mg', etiqueta: 'Mg (cmol(+)/kg)' },
  { clave: 'al', etiqueta: 'Al (cmol(+)/kg)' },
  { clave: 'sat_al', etiqueta: 'Sat. Al (%)' },
  { clave: 'cice', etiqueta: 'CICE (cmol(+)/kg)' },
  { clave: 'b', etiqueta: 'B (mg/kg)' },
  { clave: 'zn', etiqueta: 'Zn (mg/kg)' },
  { clave: 'fe', etiqueta: 'Fe (mg/kg)' },
  { clave: 'mn', etiqueta: 'Mn (mg/kg)' },
  { clave: 'cu', etiqueta: 'Cu (mg/kg)' },
  { clave: 'ca_mg', etiqueta: 'Ca/Mg' },
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ETIQUETAS_RE = VARIABLES.map((v) => escRe(v.etiqueta)).sort((a, b) => b.length - a.length).join('|');
// "pH 4,72 Muy fuertemente ácido Sat. Al (%) 43,3 Alto" → dos variables por línea.
const CELDA_RE = new RegExp(`(${ETIQUETAS_RE}) (-?[\\d.]+(?:,\\d+)?) (.+?)(?= (?:${ETIQUETAS_RE}) -?[\\d.]|$)`, 'g');

/** "1.111" → 1111 · "4,72" → 4.72 (formato colombiano). */
const numero = (s) => {
  if (s == null) return null;
  const n = Number(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const limpiar = (t) =>
  String(t || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

/** Junta las líneas de un párrafo partido por el maquetado del PDF. */
const unirLineas = (t) => String(t || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

function entre(texto, desde, hasta) {
  const i = texto.search(desde);
  if (i < 0) return null;
  const resto = texto.slice(i).replace(desde, '');
  const j = hasta ? resto.search(hasta) : -1;
  return (j >= 0 ? resto.slice(0, j) : resto).trim();
}

/** "cal dolomita 2.805 kg; abono orgánico compostado 5.556 kg; DAP 245 kg…" → { insumo: kg } */
function parsearInsumos(linea) {
  const out = {};
  if (!linea) return out;
  const cuerpo = linea.replace(/^.*?\):\s*/, '');
  for (const parte of cuerpo.split(/;|\.\s*$/)) {
    const m = parte.trim().match(/^(.+?) ([\d.]+(?:,\d+)?) kg$/i);
    if (m) out[m[1].trim().toLowerCase()] = numero(m[2]);
  }
  return out;
}

/**
 * Extrae los datos estructurados del texto de un PDF de suelos.
 * Devuelve { formato: 'resumen' | 'laboratorio' | 'desconocido', ... }.
 */
function extraerDeTexto(textoBruto) {
  const texto = limpiar(textoBruto);
  const datos = { formato: 'desconocido' };

  const cod = texto.match(/(\d+ - LQAS[\d-]+ \/\/ PC-PR-\d+)/);
  if (cod) datos.codigo = cod[1];
  const muestra = texto.match(/PC-PR-\d+/);
  if (muestra) datos.codigoMuestra = muestra[0];

  const cab = texto.match(/Área del predio: ([\d.,]+) ha · Densidad: ([\d.,]+) plantas\/ha(?: \(([^)]+)\))? · Plantas por predio: ([\d.,]+)/);
  if (cab) {
    datos.areaHa = numero(cab[1]);
    datos.densidad = numero(cab[2]);
    datos.distancia = cab[3] || null;
    datos.plantas = numero(cab[4]);
  }

  const tabla = entre(texto, /Variable Valor Interpretación Variable Valor Interpretación\n/, /\n(?:Preparación del sitio|Fertilizaciones)/);
  if (tabla) {
    const vistos = {};
    for (const linea of tabla.split('\n')) {
      for (const m of linea.trim().matchAll(CELDA_RE)) {
        vistos[m[1]] = { valor: numero(m[2]), interpretacion: m[3].trim() };
      }
    }
    datos.variables = VARIABLES.filter((v) => vistos[v.etiqueta]).map((v) => ({ ...v, ...vistos[v.etiqueta] }));
    if (datos.variables.length >= 10) datos.formato = 'resumen';
  }

  const prep = entre(texto, /Preparación del sitio[^\n]*\n/, /\nFertilizaciones del primer año/);
  if (prep) datos.preparacion = unirLineas(prep);
  const totalAnio = texto.match(/\nTotal año\n?([\d,–\s]+?)\nNutrientes/);
  if (totalAnio) {
    const nums = totalAnio[1].trim().split(/\s+/);
    datos.totalAnioGPlanta = numero(nums[nums.length - 1]);
  }
  const nutr = entre(texto, /Nutrientes aportados en el año \(kg\/ha\):\s*/, /\nInsumos para el predio/);
  if (nutr) datos.nutrientes = unirLineas(nutr);
  const ins = entre(texto, /\nInsumos para el predio/, /\nObservaciones\n/);
  if (ins) {
    const linea = unirLineas('Insumos para el predio ' + ins);
    datos.insumosTexto = linea;
    datos.insumos = parsearInsumos(linea);
  }
  const obs = entre(texto, /\nObservaciones\n/, null);
  if (obs) datos.observaciones = unirLineas(obs);

  // Respaldo para PDF sin hoja de resumen: la tabla de resultados del laboratorio.
  if (datos.formato !== 'resumen') {
    const lab = entre(texto, /4\. Resultados del Análisis\n/, /\n(?:GRAFICA DE INTERPRETACION|5\. Notas)/);
    if (lab) {
      datos.formato = 'laboratorio';
      datos.textoResultados = lab.slice(0, 6000);
    }
  }
  return datos;
}

/** Lee el PDF (Buffer). Nunca lanza: si no se puede leer, formato 'desconocido'. */
async function extraerDatosSuelos(buffer) {
  if (!pdfParse) return { formato: 'desconocido', error: 'pdf-parse no instalado' };
  try {
    const { text } = await pdfParse(buffer);
    return extraerDeTexto(text);
  } catch (err) {
    return { formato: 'desconocido', error: err.message };
  }
}

module.exports = { extraerDatosSuelos, extraerDeTexto, VARIABLES };
