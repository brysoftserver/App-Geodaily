// ============================================================
// GEODAILY — Visita Técnica 3 (formato v3)
// ============================================================
// Esquema único del formulario: textos, opciones, estado, validación y
// resumen legible. Lo comparten la pantalla de captura, el detalle y el
// PDF, para que una pregunta nueva se agregue en UN solo sitio.
//
// Los datos viajan DENTRO de `actividad` (columna `actividad_json`):
//   - `visita3_datos` = estado completo (reabrir borradores sin ambigüedad).
//   - campos legibles (`objetivo`, `descripcion`, `observaciones`, …) para
//     listas, dashboards y el resto de pantallas que ya los leen.
// ============================================================

export const VISITA3_NUMERO = 3;
export const VISITA3_FORMATO = 'v3';
/** Clave de carpeta MinIO (backend/src/storage.js → Formulario_3). */
export const VISITA3_CLAVE_CARPETA = 'visita_tecnica_3';

export const OBJETIVO_VISITA3_DEFAULT =
  'Verificar el cumplimiento de las recomendaciones sobre adecuación del terreno realizadas en la Visita 2 y orientar técnicamente al productor en la etapa de trazado, ahoyado, siembra del plátano, cacao y maderables.';

export const DESCRIPCION_VISITA3_DEFAULT =
  'Realizar seguimiento al cumplimiento de las recomendaciones y compromisos establecidos en la Visita 2 relacionados con la adecuación del terreno, y brindar asistencia técnica al productor en las actividades previas y propias de la siembra de plátano, verificando las condiciones del lote, el trazado, el ahoyado, la selección del material vegetal y las prácticas requeridas para el establecimiento adecuado del cultivo.';

// ─── Opciones ────────────────────────────────────────────────
export const SI_NO = ['Sí', 'No'];

export const PROBLEMAS_SUELO_OPTS = [
  'Encharcamiento o acumulación de agua',
  'Erosión del suelo',
  'Compactación del suelo',
  'Drenaje deficiente',
  'Otro',
];

export const SISTEMA_TRAZADO_OPTS = [
  'Cuadrado',
  'Rectangular',
  'Triangular o tresbolillos',
  'Siguiendo las curvas de nivel',
];

export const ORIENTACION_SURCOS_OPTS = [
  'Pendiente del terreno',
  'Dirección de la luz solar',
  'Drenaje del terreno',
  'Facilidad de acceso y manejo',
  'Combinación de varios criterios',
];

export const MANEJO_DRENAJE_OPTS = [
  'Canales de drenaje',
  'Surcos o zanjas de evacuación',
  'Drenaje natural',
];

export const CUMPLIMIENTO_OPTS = ['Cumplido', 'Parcial', 'No cumplido'];
export const CUMPLIMIENTO_CON_NO_APLICA_OPTS = ['Cumplido', 'Parcial', 'No cumplido', 'No aplica'];
export const CUMPLE_RECOMENDACIONES_OPTS = ['Sí', 'Parcialmente', 'No'];
export const PORCENTAJES_PARCIAL = ['15%', '30%', '50%', '75%', '90%', 'Otro'];

// ─── Compromisos a verificar (sección "Seguimiento a compromisos") ───
export type CompromisoClave = 'cercado' | 'limpieza' | 'trazado' | 'ahoyado';

export const COMPROMISOS_V3: {
  clave: CompromisoClave;
  pregunta: string;
  opciones: string[];
}[] = [
  {
    clave: 'cercado',
    pregunta: '¿El productor realizó el cercado o delimitación del terreno recomendado en la Visita 2?',
    opciones: CUMPLIMIENTO_CON_NO_APLICA_OPTS,
  },
  {
    clave: 'limpieza',
    pregunta: '¿Se realizó la limpieza del terreno para facilitar el establecimiento del cultivo?',
    opciones: CUMPLIMIENTO_OPTS,
  },
  {
    clave: 'trazado',
    pregunta: '¿Se efectuó el trazado del lote para la siembra de plátano?',
    opciones: CUMPLIMIENTO_OPTS,
  },
  {
    clave: 'ahoyado',
    pregunta: '¿Se realizó el ahoyado en los sitios definidos para la siembra?',
    opciones: CUMPLIMIENTO_OPTS,
  },
];

export interface CompromisoEstado {
  /** Cumplido | Parcial | No cumplido | No aplica */
  estado: string;
  /** Si es Parcial: '15%'…'90%' u 'Otro'. */
  porcentaje: string;
  /** Si el porcentaje es 'Otro': número manual (1–99). */
  porcentaje_otro: string;
}

// ─── Estado completo ─────────────────────────────────────────
export interface Visita3Datos {
  objetivo: string;
  descripcion_visita: string;
  // Preguntas
  p1_estado_terreno: string;
  p2_actividades_adecuacion: string;
  p3_terreno_limpio: string;
  p4_area_delimitada: string;
  p5_condiciones_siembra: string;
  p5_1_recomendaciones_material: string;
  p6_problemas_drenaje: string;
  p6_problemas: string[];
  p6_otro: string;
  p7_medidas_preventivas: string;
  p8_recomendaciones_adecuacion: string;
  p9_sistema_trazado: string;
  p10_orientacion_surcos: string;
  p11_manejo_drenaje: string;
  p12_ajustes_previos: string;
  // Seguimiento a compromisos
  compromisos: Record<CompromisoClave, CompromisoEstado>;
  cumple_recomendaciones: string;
  dificultades: string;
  // Cierre
  observaciones: string;
  recomendaciones: string;
  // Georreferenciación capturada con GPS de alta precisión (tarjeta de
  // evidencias; mismo formato de texto que la pregunta 20 del form 1).
  ubicacion_latitud: string;
  ubicacion_longitud: string;
  ubicacion_altitud: string;
  ubicacion_precision: string;
}

const compromisoVacio = (): CompromisoEstado => ({ estado: '', porcentaje: '', porcentaje_otro: '' });

export const crearEstadoInicialV3 = (): Visita3Datos => ({
  objetivo: OBJETIVO_VISITA3_DEFAULT,
  descripcion_visita: DESCRIPCION_VISITA3_DEFAULT,
  p1_estado_terreno: '',
  p2_actividades_adecuacion: '',
  p3_terreno_limpio: '',
  p4_area_delimitada: '',
  p5_condiciones_siembra: '',
  p5_1_recomendaciones_material: '',
  p6_problemas_drenaje: '',
  p6_problemas: [],
  p6_otro: '',
  p7_medidas_preventivas: '',
  p8_recomendaciones_adecuacion: '',
  p9_sistema_trazado: '',
  p10_orientacion_surcos: '',
  p11_manejo_drenaje: '',
  p12_ajustes_previos: '',
  compromisos: {
    cercado: compromisoVacio(),
    limpieza: compromisoVacio(),
    trazado: compromisoVacio(),
    ahoyado: compromisoVacio(),
  },
  cumple_recomendaciones: '',
  dificultades: '',
  observaciones: '',
  recomendaciones: '',
  ubicacion_latitud: '',
  ubicacion_longitud: '',
  ubicacion_altitud: '',
  ubicacion_precision: '',
});

/**
 * Fusiona un estado guardado (posiblemente de una versión anterior o
 * parcial) sobre el estado inicial, para tolerar campos que no existían.
 */
export const hidratarEstadoV3 = (guardado?: Partial<Visita3Datos> | null): Visita3Datos => {
  const base = crearEstadoInicialV3();
  if (!guardado || typeof guardado !== 'object') return base;
  const compromisos = { ...base.compromisos };
  for (const { clave } of COMPROMISOS_V3) {
    compromisos[clave] = { ...base.compromisos[clave], ...(guardado.compromisos?.[clave] || {}) };
  }
  return {
    ...base,
    ...guardado,
    p6_problemas: Array.isArray(guardado.p6_problemas) ? guardado.p6_problemas : [],
    compromisos,
  };
};

// ─── Helpers ────────────────────────────────────────────────

/** Solo dígitos, máximo 2 (1–99). Vacío si no hay dígitos. */
export const sanearPorcentajeManual = (raw: string): string => {
  const limpio = raw.replace(/[^0-9]/g, '').slice(0, 2);
  if (limpio === '') return '';
  return String(Number(limpio));
};

/** Texto legible de un compromiso: "Cumplido", "Parcial (30%)", … */
export const textoCompromiso = (c?: CompromisoEstado | null): string => {
  if (!c || !c.estado) return '';
  if (c.estado !== 'Parcial') return c.estado;
  const pct = c.porcentaje === 'Otro' ? (c.porcentaje_otro ? `${c.porcentaje_otro}%` : '') : c.porcentaje;
  return pct ? `Parcial (${pct})` : 'Parcial';
};

/** ¿El compromiso está completamente diligenciado? */
const compromisoCompleto = (c: CompromisoEstado): boolean => {
  if (!c.estado) return false;
  if (c.estado !== 'Parcial') return true;
  if (!c.porcentaje) return false;
  if (c.porcentaje === 'Otro') return !!c.porcentaje_otro && Number(c.porcentaje_otro) > 0;
  return true;
};

/**
 * Lista de ítems sin diligenciar (para la alerta al completar).
 * Las condicionales solo se exigen cuando aplican: la lista de problemas si
 * la 6 es "Sí", y el "¿Cuál?" si se marcó "Otro".
 */
export const faltantesV3 = (d: Visita3Datos): string[] => {
  const f: string[] = [];
  const lleno = (v: string) => !!v && v.trim().length > 0;

  if (!lleno(d.objetivo)) f.push('Objetivo de la visita');
  if (!lleno(d.descripcion_visita)) f.push('Descripción de la visita');

  if (!lleno(d.p1_estado_terreno)) f.push('Pregunta 1');
  if (!lleno(d.p2_actividades_adecuacion)) f.push('Pregunta 2');
  if (!lleno(d.p3_terreno_limpio)) f.push('Pregunta 3');
  if (!d.p4_area_delimitada) f.push('Pregunta 4');
  if (!d.p5_condiciones_siembra) f.push('Pregunta 5');
  if (!lleno(d.p5_1_recomendaciones_material)) f.push('Pregunta 5.1');
  if (!d.p6_problemas_drenaje) {
    f.push('Pregunta 6');
  } else if (d.p6_problemas_drenaje === 'Sí') {
    if (d.p6_problemas.length === 0) f.push('Pregunta 6 (indica los problemas)');
    else if (d.p6_problemas.includes('Otro') && !lleno(d.p6_otro)) f.push('Pregunta 6 (¿Cuál otro?)');
  }
  if (!lleno(d.p7_medidas_preventivas)) f.push('Pregunta 7');
  if (!lleno(d.p8_recomendaciones_adecuacion)) f.push('Pregunta 8');
  if (!d.p9_sistema_trazado) f.push('Pregunta 9');
  if (!d.p10_orientacion_surcos) f.push('Pregunta 10');
  if (!d.p11_manejo_drenaje) f.push('Pregunta 11');
  if (!lleno(d.p12_ajustes_previos)) f.push('Pregunta 12');

  COMPROMISOS_V3.forEach(({ clave }, i) => {
    if (!compromisoCompleto(d.compromisos[clave])) f.push(`Seguimiento ${i + 1}`);
  });
  if (!d.cumple_recomendaciones) f.push('Seguimiento 5');
  if (!lleno(d.dificultades)) f.push('Seguimiento 6');

  if (!lleno(d.observaciones)) f.push('Observaciones durante la visita');
  if (!lleno(d.recomendaciones)) f.push('Recomendaciones');
  return f;
};

/** Resumen de una línea por compromiso, para el campo legible `seguimiento_compromisos`. */
export const resumenSeguimientoV3 = (d: Visita3Datos): string =>
  COMPROMISOS_V3.map(({ clave, pregunta }, i) => `${i + 1}. ${pregunta} ${textoCompromiso(d.compromisos[clave]) || '—'}`)
    .concat([
      `5. ¿Las actividades realizadas cumplen con las recomendaciones técnicas impartidas en la visita anterior? ${d.cumple_recomendaciones || '—'}`,
      `6. Dificultades: ${d.dificultades.trim() || '—'}`,
    ])
    .join('\n');

/** Lista legible de problemas de suelo (con el "Otro" resuelto). */
export const textoProblemasV3 = (d: Pick<Visita3Datos, 'p6_problemas' | 'p6_otro'>): string =>
  d.p6_problemas
    .map((p) => (p === 'Otro' ? `Otro: ${d.p6_otro.trim() || '—'}` : p))
    .join(', ');

/** Preguntas en orden, para pintar el detalle y el PDF sin repetir textos. */
export const PREGUNTAS_V3: { clave: keyof Visita3Datos; numero: string; texto: string }[] = [
  { clave: 'p1_estado_terreno', numero: '1', texto: '¿Cuál es el estado actual del terreno desde la última visita técnica?' },
  { clave: 'p2_actividades_adecuacion', numero: '2', texto: '¿Qué actividades de adecuación del terreno ha realizado el productor desde la Visita 2?' },
  { clave: 'p3_terreno_limpio', numero: '3', texto: '¿El terreno se encuentra limpio y libre de malezas, residuos y obstáculos que dificulten la siembra?' },
  { clave: 'p4_area_delimitada', numero: '4', texto: '¿Se encuentra delimitada o cercada el área destinada al cultivo?' },
  { clave: 'p5_condiciones_siembra', numero: '5', texto: '¿Las condiciones del terreno permiten iniciar siembra de plátano y maderables?' },
  { clave: 'p5_1_recomendaciones_material', numero: '5.1', texto: '¿Qué recomendaciones se brindaron para la selección, preparación y manejo del material vegetal?' },
  { clave: 'p6_problemas_drenaje', numero: '6', texto: '¿Se identifican problemas de drenaje o condiciones físicas del suelo que puedan afectar el establecimiento y desarrollo del cultivo de plátano y maderables?' },
  { clave: 'p7_medidas_preventivas', numero: '7', texto: '¿Qué medidas preventivas debe implementar el productor para proteger el cultivo durante el establecimiento?' },
  { clave: 'p8_recomendaciones_adecuacion', numero: '8', texto: '¿Cuáles son las recomendaciones técnicas que debe implementar el productor para completar la adecuación del terreno?' },
  { clave: 'p9_sistema_trazado', numero: '9', texto: '¿Qué sistema de trazado se utilizará para distribuir las plantas de plátano y maderables?' },
  { clave: 'p10_orientacion_surcos', numero: '10', texto: '¿Qué criterio se tendrá en cuenta para definir la orientación de los surcos?' },
  { clave: 'p11_manejo_drenaje', numero: '11', texto: '¿Cómo se manejará el drenaje del terreno dentro del arreglo del cultivo?' },
  { clave: 'p12_ajustes_previos', numero: '12', texto: '¿Qué actividades requieren ajustes antes de iniciar la siembra?' },
];

/**
 * Respuesta legible de una pregunta (la 6 incorpora la lista de problemas).
 * Devuelve '' si no hay respuesta.
 */
export const respuestaPreguntaV3 = (d: Visita3Datos, clave: keyof Visita3Datos): string => {
  const v = d[clave];
  if (clave === 'p6_problemas_drenaje') {
    const base = String(v || '');
    if (base === 'Sí' && d.p6_problemas.length > 0) return `Sí — ${textoProblemasV3(d)}`;
    return base;
  }
  return typeof v === 'string' ? v.trim() : '';
};
