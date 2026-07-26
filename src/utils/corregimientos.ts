// ============================================================
// GEODAILY — Catálogo de corregimientos de Puerto Rico (Caquetá)
// ============================================================
// Fuente: mapa político oficial (Logos_imagenes_pdf/mapa_interactivo_puerto_rico.png)
// y el padrón real de beneficiarios (SEED_DATA en beneficiariosDB.service.ts),
// que es la única fuente del código con la asociación vereda → corregimiento.

import { SEED_DATA } from '../services/beneficiariosDB.service';
import type { Formulario } from '../types';

export const CORREGIMIENTOS = [
  'SANTANA RAMOS',
  'LA AGUILILLA',
  'LA PAZ',
  'LA ESMERALDA',
  'LUSITANIA',
  'RIO NEGRO',
] as const;

export type Corregimiento = (typeof CORREGIMIENTOS)[number];

/**
 * Colores para la torta/tabla de corregimientos. NO son los colores exactos
 * de la leyenda del mapa impreso: esos (verde oliva, amarillo pálido, verde
 * azulado, gris, salmón, verde brillante) fallan la validación de paleta
 * categórica (skill dataviz) — el par gris↔verde-azulado es casi
 * indistinguible entre sí incluso con visión normal (ΔE 9.2, piso 15). Se
 * usa en su lugar el orden categórico validado (6 tonos con separación
 * CVD/contraste comprobada), asignado en el mismo orden fijo que
 * CORREGIMIENTOS para que cada corregimiento tenga siempre el mismo color.
 */
export const COLOR_CORREGIMIENTO: Record<Corregimiento, string> = {
  'SANTANA RAMOS': '#2A78D6', // azul
  'LA AGUILILLA': '#EB6834', // naranja
  'LA PAZ': '#1BAF7A', // aqua
  'LA ESMERALDA': '#EDA100', // amarillo
  LUSITANIA: '#E87BA4', // magenta
  'RIO NEGRO': '#008300', // verde
};

/**
 * En el mapa impreso el corregimiento central aparece rotulado como
 * "Puerto Rico (Central)", pero en la base de datos de beneficiarios el
 * mismo corregimiento se registra como "LA PAZ". Este mapeo permite
 * mostrar en la UI el nombre del mapa sin tocar el dato guardado.
 */
export const NOMBRE_VISIBLE_CORREGIMIENTO: Record<Corregimiento, string> = {
  'SANTANA RAMOS': 'Santana Ramos',
  'LA AGUILILLA': 'La Aguililla',
  'LA PAZ': 'Puerto Rico (Central)',
  'LA ESMERALDA': 'La Esmeralda',
  LUSITANIA: 'Lusitania',
  'RIO NEGRO': 'Río Negro',
};

const normalizar = (s?: string | null): string => (s || '').trim().toUpperCase();

/** vereda (normalizada) → corregimiento, derivado del padrón real de beneficiarios */
const VEREDA_A_CORREGIMIENTO: Record<string, Corregimiento> = {};
SEED_DATA.forEach((b) => {
  const vereda = normalizar(b.vereda);
  if (vereda && !VEREDA_A_CORREGIMIENTO[vereda]) {
    VEREDA_A_CORREGIMIENTO[vereda] = b.corregimiento as Corregimiento;
  }
});

/** Alias de nombres de corregimiento que pueden llegar como texto libre desde el formulario */
const ALIAS_CORREGIMIENTO: Record<string, Corregimiento> = {
  'PUERTO RICO': 'LA PAZ',
  'PUERTO RICO (CENTRAL)': 'LA PAZ',
  'PUERTO RICO CENTRAL': 'LA PAZ',
  CENTRO: 'LA PAZ',
};

const ES_CORREGIMIENTO = new Set<string>(CORREGIMIENTOS);

/**
 * Resuelve el corregimiento canónico de un formulario:
 * 1. beneficiario.corregimiento, si coincide con el catálogo o un alias conocido.
 * 2. lookup por vereda contra el padrón de beneficiarios.
 * 3. null si no se pudo determinar (se agrupa como "Sin corregimiento" en la UI).
 */
export function resolverCorregimiento(formulario: Pick<Formulario, 'beneficiario'>): Corregimiento | null {
  const bruto = normalizar(formulario.beneficiario?.corregimiento);
  if (bruto) {
    if (ES_CORREGIMIENTO.has(bruto)) return bruto as Corregimiento;
    if (ALIAS_CORREGIMIENTO[bruto]) return ALIAS_CORREGIMIENTO[bruto];
  }
  const vereda = normalizar(formulario.beneficiario?.vereda);
  if (vereda && VEREDA_A_CORREGIMIENTO[vereda]) return VEREDA_A_CORREGIMIENTO[vereda];
  return null;
}

/** Nombre de vereda normalizado (trim + mayúsculas), usado para contar veredas únicas visitadas */
export function normalizarVereda(vereda?: string | null): string | null {
  const v = normalizar(vereda);
  return v || null;
}

/** Catálogo de veredas conocidas por corregimiento (nombre "bonito", tal como aparece en el padrón), para el panel del mapa coroplético. */
export const VEREDAS_POR_CORREGIMIENTO: Record<Corregimiento, string[]> = (() => {
  const acumulado: Record<string, Set<string>> = {};
  CORREGIMIENTOS.forEach((c) => (acumulado[c] = new Set()));
  SEED_DATA.forEach((b) => {
    const c = b.corregimiento as Corregimiento;
    if (acumulado[c] && b.vereda) acumulado[c].add(b.vereda.trim());
  });
  const resultado = {} as Record<Corregimiento, string[]>;
  CORREGIMIENTOS.forEach((c) => {
    resultado[c] = Array.from(acumulado[c]).sort((a, b) => a.localeCompare(b));
  });
  return resultado;
})();
