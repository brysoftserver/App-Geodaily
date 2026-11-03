// ============================================================
// GEODAILY — Normalización de respuestas "compuestas"
// ============================================================
// Algunas preguntas del Formulario 1 se GUARDAN como un valor simple
// ("10") pero se MUESTRAN compuestas: con la etiqueta de la pregunta, la
// unidad o el campo «Otro / Porque» anexado.
//
// Ejemplo (pregunta 22): el campo guarda "10" y la vista muestra
// "Bosque: 10 ha · Agrícola: 60 ha · …".
//
// El problema: si ese texto ya compuesto se vuelve a guardar (con
// «✎ Corregir»), la siguiente composición lo envuelve otra vez y queda
// "Bosque: Bosque: 10 ha ha · Agrícola: …". Cada corrección anidaba un
// nivel más.
//
// Estas funciones hacen la composición IDEMPOTENTE y permiten recuperar
// el valor simple de una respuesta ya contaminada SIN perder información:
// solo se recorta la etiqueta/unidad repetida que la propia vista agregó.
// ============================================================

const escaparRegex = (texto: string): string =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Primer número de un texto: "Bosque: 10 ha" → "10". '' si no hay. */
export const soloNumero = (valor?: string | null): string => {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (/^-?\d+(?:[.,]\d+)?$/.test(v)) return v;
  const encontrado = v.match(/-?\d+(?:[.,]\d+)?/);
  return encontrado ? encontrado[0] : '';
};

/** Primer tramo de un valor compuesto con "·" o "|". */
export const primerSegmento = (valor: string): string =>
  String(valor ?? '').split(/\s*[·|]\s*/)[0].trim();

/** Quita las veces que el texto ya traiga la etiqueta al inicio ("Bosque: Bosque: 10"). */
export const quitarEtiqueta = (valor: string, etiqueta: string): string => {
  let v = String(valor ?? '').trim();
  if (!etiqueta) return v;
  const re = new RegExp(`^\\s*${escaparRegex(etiqueta)}\\s*:\\s*`, 'i');
  while (re.test(v)) v = v.replace(re, '');
  return v.trim();
};

/** Quita la unidad repetida al final ("70 ha ha" → "70", "2.5 ha" → "2.5"). */
export const quitarUnidad = (valor: string, unidad: string): string => {
  let v = String(valor ?? '').trim();
  if (!unidad) return v;
  const re = new RegExp(`\\s*${escaparRegex(unidad)}\\s*$`, 'i');
  while (re.test(v)) v = v.replace(re, '');
  return v.trim();
};

/**
 * Recupera el número de hectáreas de un valor que pudo quedar compuesto.
 * "Bosque: Bosque: 10 ha · Agrícola: 60 ha" → "10".
 * Si no hay número (el técnico escribió texto libre), devuelve el texto.
 */
export const numeroDeArea = (valor?: string | null, etiquetas: string[] = []): string => {
  let v = primerSegmento(String(valor ?? ''));
  for (const etiqueta of etiquetas) v = quitarEtiqueta(v, etiqueta);
  v = quitarUnidad(quitarUnidad(v, 'hectáreas'), 'ha');
  const numero = soloNumero(v);
  return numero || v.trim();
};

/**
 * Compone "valor + unidad" sin duplicar la unidad ya presente.
 * Es idempotente: conUnidadSegura("70 ha", "ha") === "70 ha".
 */
export const conUnidadSegura = (valor?: string | null, unidad?: string): string => {
  const base = String(valor ?? '').trim();
  if (!base) return '';
  if (!unidad) return base;
  // Valor ya compuesto (varias secciones con "·"): se respeta tal cual.
  if (/\s[·|]\s/.test(base)) return base;
  const limpio = quitarUnidad(base, unidad);
  if (!limpio) return base;
  return `${limpio} ${unidad}`;
};

/**
 * Compone "valor — otro" sin duplicar el complemento ya anexado.
 * Es idempotente: conOtroSeguro("Otro — X", "X") === "Otro — X".
 */
export const conOtroSeguro = (valor?: string | null, otro?: string | null): string => {
  const base = String(valor ?? '').trim();
  if (!base) return '';
  const extra = String(otro ?? '').trim();
  if (!extra) return base;
  // Ya venía compuesto por una versión anterior de la vista.
  if (base.includes(' — ')) return base;
  return `${base} — ${extra}`;
};

// ------------------------------------------------------------------
// Valor "simple" de cada campo que la vista compone al mostrarlo
// ------------------------------------------------------------------

/** Etiquetas que la vista antepone al mostrar la respuesta de cada path. */
const ETIQUETAS_POR_PATH: Record<string, string[]> = {
  'caracterizacion_finca.division_bosque': ['Bosque'],
  'caracterizacion_finca.division_agricola': ['Agrícola', 'Agricola', 'Agricultura'],
  'caracterizacion_finca.division_pecuaria': ['Pecuaria'],
  'caracterizacion_finca.division_instalaciones': ['Instalaciones'],
  'acompaniamiento.manejo_plagas_hectareas': ['Número de hectáreas'],
  'acompaniamiento.manejo_suelo_cantidad': ['Muestreo de suelo realizado'],
};

/** Campos que guardan un número "pelado" (sin etiqueta). */
const CAMPOS_NUMERICOS = new Set([
  'componente_social.personas_nucleo',
  'caracterizacion_finca.area_total',
  'caracterizacion_finca.distancia_km',
  'analisis_suelo.pendiente',
]);

/**
 * Valor que debe precargarse al editar la respuesta de `path`.
 *
 * Devuelve el dato SIMPLE que corresponde al campo (p. ej. "10" para la
 * división de bosque), no el texto compuesto que se ve en pantalla. Así,
 * guardar la corrección no vuelve a anidar etiquetas ni unidades, y de
 * paso se repara cualquier valor que ya hubiera quedado contaminado.
 */
export const valorParaEditar = (path: string, valor?: string | null): string => {
  const base = String(valor ?? '').trim();
  if (!base) return '';
  const etiquetas = ETIQUETAS_POR_PATH[path];
  if (etiquetas) return numeroDeArea(base, etiquetas);
  if (CAMPOS_NUMERICOS.has(path)) return soloNumero(base) || base;
  return base;
};
