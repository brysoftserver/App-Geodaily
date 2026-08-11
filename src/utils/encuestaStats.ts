// ============================================================
// GEODAILY — Estadísticas de la Encuesta Social AgroAmbiental
// ============================================================
// Agrega las respuestas del Formulario 1 (`caracterizacion_nueva`)
// pregunta por pregunta, para los carruseles de gráficas de los
// dashboards de Supervisor / Interventor / Gerente.
//
// Las preguntas y su texto oficial son las mismas que documenta
// `encuestaSchema.ts` (fuente única de verdad del formulario); acá
// solo se agrega el conteo/agrupación necesario para graficar.
// ============================================================

import { Formulario } from '../types';
import { esEncuestaSocial } from './encuestaSchema';
import { capitalizar } from './formatters';
import { CATEGORICAL_PALETTE, COLOR_OTROS, COLOR_BARRA_ACENTO, colorParaIndice } from './chartPalette';
import { COLORS } from '../theme';
import {
  SEXO_OPTS,
  RECONOCIMIENTO_OPTS,
  NIVEL_EDUCATIVO_ENV_OPTS,
  SINO_OPTS,
  FUENTE_INGRESOS_ENV_OPTS,
  INGRESOS_SALARIOS_OPTS,
  OCUPACION_SECUNDARIA_OPTS,
  TIPO_ASOCIACION_OPTS,
  VIVIENDA_UBICACION_OPTS,
  TIPO_ENERGIA_OPTS,
  AGUA_CONSUMO_OPTS,
  ELEMENTOS_TECNOLOGICOS_OPTS,
  QUIENES_TRABAJAN_OPTS,
  MEDIO_TRANSPORTE_OPTS,
  MEDIO_SALIDA_OPTS,
  ACTIVIDADES_FINCA_OPTS,
  ACTIVIDAD_AGRICOLA_OPTS,
  ACTIVIDAD_PECUARIA_OPTS,
  ACTIVIDAD_PRODUCTIVA_OPTS,
  ANALISIS_SUELO_REALIZADO_OPTS,
  TEXTURA_SUELO_OPTS,
  COLOR_SUELO_OPTS,
  DRENAJE_OPTS,
  USO_TIERRA_HISTORICO_OPTS,
  PRESENCIA_PIEDRAS_OPTS,
  COMPACTACION_OPTS,
  COBERTURA_SUELO_OPTS,
  EVIDENCIA_EROSION_OPTS,
  PROCESOS_EROSION_OPTS,
  FUENTES_HIDRICAS_OPTS,
  PRACTICAS_CONSERVACION_OPTS,
  AREAS_CONSERVACION_OPTS,
  TIPO_AGROQUIMICO_OPTS,
  MANEJO_RESIDUOS_OPTS,
} from './constants';

export type TipoGrafica = 'pie' | 'bar';

export interface PuntoDato {
  etiqueta: string;
  valor: number;
  color: string;
}

export interface EncuestaChartSpec {
  id: string;
  titulo: string;
  tipo: TipoGrafica;
  datos: PuntoDato[];
  /** Denominador para el cálculo de %: número de encuestas que respondieron esta pregunta (o total de hectáreas para P22). */
  totalRespuestas: number;
  /** Unidad del valor, solo para gráficas que no cuentan formularios (ej. "ha" en P22). */
  unidad?: string;
}

export interface EncuestaSeccionStats {
  id: string;
  titulo: string;
  icono: string;
  color: string;
  graficas: EncuestaChartSpec[];
}

const MAX_BARRAS = 10;

/** Extrae el arreglo de encuestas (`caracterizacion_nueva`) de los formularios tipo Formulario 1. */
const encuestasDe = (formularios: Formulario[]): any[] =>
  formularios.filter(esEncuestaSocial).map((f) => (f as any).caracterizacion_nueva || {});

const colorPara = (etiqueta: string, opciones: readonly string[]): string => {
  const idx = opciones.indexOf(etiqueta);
  return idx >= 0 ? colorParaIndice(idx) : COLOR_OTROS;
};

/** Recorta a las top N categorías + balde "Otras" con el resto, ordenado descendente. */
function ordenarBar(entradas: [string, number][]): PuntoDato[] {
  const ordenado = entradas.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const visibles = ordenado.length <= MAX_BARRAS ? ordenado : ordenado.slice(0, MAX_BARRAS);
  const datos: PuntoDato[] = visibles.map(([etiqueta, valor]) => ({ etiqueta, valor, color: COLOR_BARRA_ACENTO }));
  if (ordenado.length > MAX_BARRAS) {
    const restoTotal = ordenado.slice(MAX_BARRAS).reduce((acc, [, v]) => acc + v, 0);
    datos.push({ etiqueta: 'Otras', valor: restoTotal, color: COLOR_OTROS });
  }
  return datos;
}

/** Selección única contra una lista fija de opciones oficiales. */
function contarUnica(
  encuestas: any[],
  extractor: (e: any) => string | undefined | null,
  opciones: readonly string[],
  tipo: TipoGrafica = 'pie'
): { datos: PuntoDato[]; total: number } {
  const conteo = new Map<string, number>();
  let total = 0;
  encuestas.forEach((e) => {
    const val = (extractor(e) || '').trim();
    if (!val) return;
    conteo.set(val, (conteo.get(val) || 0) + 1);
    total += 1;
  });
  const entradas = Array.from(conteo.entries());
  if (tipo === 'bar') {
    return { datos: ordenarBar(entradas), total };
  }
  const datos = entradas
    .filter(([, v]) => v > 0)
    .sort((a, b) => opciones.indexOf(a[0]) - opciones.indexOf(b[0]))
    .map(([etiqueta, valor]) => ({ etiqueta, valor, color: colorPara(etiqueta, opciones) }));
  return { datos, total };
}

/** Selección múltiple (respuestas separadas por ", "). Siempre se grafica en barras. */
function contarMultiple(
  encuestas: any[],
  extractor: (e: any) => string | undefined | null
): { datos: PuntoDato[]; total: number } {
  const conteo = new Map<string, number>();
  let total = 0;
  encuestas.forEach((e) => {
    const raw = (extractor(e) || '').trim();
    if (!raw) return;
    total += 1;
    raw
      .split(', ')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((val) => conteo.set(val, (conteo.get(val) || 0) + 1));
  });
  return { datos: ordenarBar(Array.from(conteo.entries())), total };
}

interface Balde {
  etiqueta: string;
  min: number;
  max: number; // exclusivo
}

/** Agrupa un valor numérico (texto libre en el formulario) en baldes/rangos. */
function contarBaldes(
  encuestas: any[],
  extractor: (e: any) => string | undefined | null,
  baldes: Balde[],
  tipo: TipoGrafica = 'pie'
): { datos: PuntoDato[]; total: number } {
  const conteo = new Map<string, number>();
  let total = 0;
  encuestas.forEach((e) => {
    const raw = extractor(e);
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    const num = parseFloat(String(raw).replace(',', '.'));
    if (Number.isNaN(num)) return;
    const balde = baldes.find((b) => num >= b.min && num < b.max);
    if (!balde) return;
    conteo.set(balde.etiqueta, (conteo.get(balde.etiqueta) || 0) + 1);
    total += 1;
  });
  const entradas = Array.from(conteo.entries());
  if (tipo === 'bar') return { datos: ordenarBar(entradas), total };
  const etiquetasOrden = baldes.map((b) => b.etiqueta);
  const datos = entradas
    .filter(([, v]) => v > 0)
    .sort((a, b) => etiquetasOrden.indexOf(a[0]) - etiquetasOrden.indexOf(b[0]))
    .map(([etiqueta, valor]) => ({ etiqueta, valor, color: colorPara(etiqueta, etiquetasOrden) }));
  return { datos, total };
}

/** Texto libre (o dropdown sin lista cerrada, como Vereda): agrupa por valor exacto, top N + "Otras". */
function contarLibre(
  encuestas: any[],
  extractor: (e: any) => string | undefined | null,
  normalizar = false
): { datos: PuntoDato[]; total: number } {
  const conteo = new Map<string, number>();
  let total = 0;
  encuestas.forEach((e) => {
    const raw = (extractor(e) || '').trim();
    if (!raw) return;
    const clave = normalizar ? capitalizar(raw.toLowerCase()) : raw;
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
    total += 1;
  });
  return { datos: ordenarBar(Array.from(conteo.entries())), total };
}

/** Suma un conjunto de campos numéricos (ej. hectáreas por uso del suelo) entre todas las encuestas. */
function sumarPorCategoria(
  encuestas: any[],
  campos: { etiqueta: string; extractor: (e: any) => string | undefined | null }[]
): { datos: PuntoDato[]; total: number } {
  const sumas = campos.map(() => 0);
  encuestas.forEach((e) => {
    campos.forEach((c, i) => {
      const num = parseFloat(String(c.extractor(e) || '').replace(',', '.'));
      if (!Number.isNaN(num) && num > 0) sumas[i] += num;
    });
  });
  const total = Math.round(sumas.reduce((a, b) => a + b, 0) * 10) / 10;
  const datos = campos
    .map((c, i) => ({ etiqueta: c.etiqueta, valor: Math.round(sumas[i] * 10) / 10, color: colorParaIndice(i) }))
    .filter((d) => d.valor > 0);
  return { datos, total };
}

// ------------------------------------------------------------------
// Baldes numéricos
// ------------------------------------------------------------------

const BALDES_EDAD: Balde[] = [
  { etiqueta: 'Hasta 29 años', min: 0, max: 30 },
  { etiqueta: '30 a 39 años', min: 30, max: 40 },
  { etiqueta: '40 a 49 años', min: 40, max: 50 },
  { etiqueta: '50 a 59 años', min: 50, max: 60 },
  { etiqueta: '60 años o más', min: 60, max: 200 },
];

const BALDES_PERSONAS_NUCLEO: Balde[] = [
  { etiqueta: '1 a 3 personas', min: 1, max: 4 },
  { etiqueta: '4 a 6 personas', min: 4, max: 7 },
  { etiqueta: '7 a 9 personas', min: 7, max: 10 },
  { etiqueta: 'Más de 9 personas', min: 10, max: 200 },
];

const BALDES_AREA: Balde[] = [
  { etiqueta: 'Menos de 1 ha', min: 0, max: 1 },
  { etiqueta: '1 a 5 ha', min: 1, max: 5 },
  { etiqueta: '5 a 10 ha', min: 5, max: 10 },
  { etiqueta: '10 a 20 ha', min: 10, max: 20 },
  { etiqueta: 'Más de 20 ha', min: 20, max: 1e6 },
];

const BALDES_DISTANCIA: Balde[] = [
  { etiqueta: 'Menos de 1 km', min: 0, max: 1 },
  { etiqueta: '1 a 3 km', min: 1, max: 3 },
  { etiqueta: '3 a 5 km', min: 3, max: 5 },
  { etiqueta: '5 a 10 km', min: 5, max: 10 },
  { etiqueta: 'Más de 10 km', min: 10, max: 1e6 },
];

const BALDES_PENDIENTE: Balde[] = [
  { etiqueta: 'Plano (0° a 5°)', min: 0, max: 5 },
  { etiqueta: 'Ligero (5° a 15°)', min: 5, max: 15 },
  { etiqueta: 'Inclinado (15° a 30°)', min: 15, max: 30 },
  { etiqueta: 'Fuerte (más de 30°)', min: 30, max: 200 },
];

/** Etiqueta corta para las opciones largas de compactación ("Sq1 - Desmenuzable (buena) …" → "Sq1 - Desmenuzable"). */
const compactacionCorta = (op: string): string => op.split(' (')[0];

// ------------------------------------------------------------------
// Construcción de secciones
// ------------------------------------------------------------------

export function construirEstadisticasEncuesta(formularios: Formulario[]): EncuestaSeccionStats[] {
  const encuestas = encuestasDe(formularios);

  // ---- Datos generales ----
  const vereda = contarLibre(encuestas, (e) => e.vereda);
  const edad = contarBaldes(encuestas, (e) => e.edad, BALDES_EDAD);
  const sexo = contarUnica(encuestas, (e) => e.sexo, SEXO_OPTS);

  const datosGenerales: EncuestaSeccionStats = {
    id: 'datos_generales',
    titulo: 'RESULTADO DATOS GENERALES',
    icono: '📋',
    color: COLORS.primary,
    graficas: [
      { id: 'dg_vereda', titulo: 'Vereda', tipo: 'bar', datos: vereda.datos, totalRespuestas: vereda.total },
      { id: 'dg_edad', titulo: 'Edad (grupo etario)', tipo: 'pie', datos: edad.datos, totalRespuestas: edad.total },
      { id: 'dg_sexo', titulo: 'Sexo', tipo: 'pie', datos: sexo.datos, totalRespuestas: sexo.total },
    ],
  };

  // ---- Componente social (P1-18) ----
  const cs = (e: any) => e.componente_social || {};
  const p1 = contarUnica(encuestas, (e) => cs(e).reconocimiento, RECONOCIMIENTO_OPTS);
  const p2 = contarUnica(encuestas, (e) => cs(e).nivel_educativo, NIVEL_EDUCATIVO_ENV_OPTS, 'bar');
  const p3 = contarUnica(encuestas, (e) => cs(e).participo_eca, SINO_OPTS);
  const p4 = contarBaldes(encuestas, (e) => cs(e).personas_nucleo, BALDES_PERSONAS_NUCLEO);
  const p5 = contarUnica(encuestas, (e) => cs(e).fuente_ingresos, FUENTE_INGRESOS_ENV_OPTS, 'bar');
  const p6 = contarUnica(encuestas, (e) => cs(e).ingresos_salarios, INGRESOS_SALARIOS_OPTS);
  const p7 = contarUnica(encuestas, (e) => cs(e).ocupacion_secundaria, OCUPACION_SECUNDARIA_OPTS, 'bar');
  const p8 = contarUnica(encuestas, (e) => cs(e).participa_organizacion, SINO_OPTS);
  const p9 = contarUnica(encuestas, (e) => cs(e).tipo_asociacion, TIPO_ASOCIACION_OPTS, 'bar');
  const p10 = contarLibre(encuestas, (e) => cs(e).rol_asociacion, true);
  const p11 = contarUnica(encuestas, (e) => cs(e).vivienda_ubicacion, VIVIENDA_UBICACION_OPTS);
  const p12 = contarUnica(encuestas, (e) => cs(e).energia_electrica, SINO_OPTS);
  const p13 = contarUnica(encuestas, (e) => cs(e).tipo_energia, TIPO_ENERGIA_OPTS);
  const p14 = contarUnica(encuestas, (e) => cs(e).agua_consumo, AGUA_CONSUMO_OPTS, 'bar');
  const p15 = contarMultiple(encuestas, (e) => cs(e).elementos_tecnologicos);
  const p16 = contarUnica(encuestas, (e) => cs(e).senal_celular, SINO_OPTS);
  const p17 = contarMultiple(encuestas, (e) => cs(e).quienes_trabajan);
  const p18 = contarMultiple(encuestas, (e) => cs(e).medio_transporte);

  const componenteSocial: EncuestaSeccionStats = {
    id: 'componente_social',
    titulo: 'RESULTADO COMPONENTE SOCIAL',
    icono: '👥',
    color: '#2E7D32',
    graficas: [
      { id: 'p1', titulo: '1. Se reconoce como', tipo: 'pie', datos: p1.datos, totalRespuestas: p1.total },
      { id: 'p2', titulo: '2. Nivel educativo del productor', tipo: 'bar', datos: p2.datos, totalRespuestas: p2.total },
      { id: 'p3', titulo: '3. ¿Ha participado en Escuelas de Campo (ECA)?', tipo: 'pie', datos: p3.datos, totalRespuestas: p3.total },
      { id: 'p4', titulo: '4. Personas en el núcleo familiar', tipo: 'pie', datos: p4.datos, totalRespuestas: p4.total },
      { id: 'p5', titulo: '5. Principal fuente de ingresos', tipo: 'bar', datos: p5.datos, totalRespuestas: p5.total },
      { id: 'p6', titulo: '6. Ingresos en salarios', tipo: 'pie', datos: p6.datos, totalRespuestas: p6.total },
      { id: 'p7', titulo: '7. Ocupación secundaria', tipo: 'bar', datos: p7.datos, totalRespuestas: p7.total },
      { id: 'p8', titulo: '8. Participa en organización o asociación', tipo: 'pie', datos: p8.datos, totalRespuestas: p8.total },
      { id: 'p9', titulo: '9. Tipo de asociación u organización', tipo: 'bar', datos: p9.datos, totalRespuestas: p9.total },
      { id: 'p10', titulo: '10. Rol en la organización', tipo: 'bar', datos: p10.datos, totalRespuestas: p10.total },
      { id: 'p11', titulo: '11. Ubicación de la vivienda principal', tipo: 'pie', datos: p11.datos, totalRespuestas: p11.total },
      { id: 'p12', titulo: '12. ¿Cuenta con energía en la vivienda?', tipo: 'pie', datos: p12.datos, totalRespuestas: p12.total },
      { id: 'p13', titulo: '13. Tipo de energía', tipo: 'pie', datos: p13.datos, totalRespuestas: p13.total },
      { id: 'p14', titulo: '14. Origen del agua de consumo', tipo: 'bar', datos: p14.datos, totalRespuestas: p14.total },
      { id: 'p15', titulo: '15. Elementos tecnológicos disponibles', tipo: 'bar', datos: p15.datos, totalRespuestas: p15.total },
      { id: 'p16', titulo: '16. ¿Cuenta con señal de celular?', tipo: 'pie', datos: p16.datos, totalRespuestas: p16.total },
      { id: 'p17', titulo: '17. Quiénes trabajan en la finca', tipo: 'bar', datos: p17.datos, totalRespuestas: p17.total },
      { id: 'p18', titulo: '18. Medio de transporte utilizado', tipo: 'bar', datos: p18.datos, totalRespuestas: p18.total },
    ],
  };

  // ---- Caracterización de la finca (P19-27) ----
  const cf = (e: any) => e.caracterizacion_finca || {};
  const p21 = contarBaldes(encuestas, (e) => cf(e).area_total, BALDES_AREA);
  const p22 = sumarPorCategoria(encuestas, [
    { etiqueta: 'Bosque', extractor: (e) => cf(e).division_bosque },
    { etiqueta: 'Agrícola', extractor: (e) => cf(e).division_agricola },
    { etiqueta: 'Pecuaria', extractor: (e) => cf(e).division_pecuaria },
    { etiqueta: 'Instalaciones', extractor: (e) => cf(e).division_instalaciones },
  ]);
  const p23 = contarUnica(encuestas, (e) => cf(e).medio_salida, MEDIO_SALIDA_OPTS);
  const p24 = contarBaldes(encuestas, (e) => cf(e).distancia_km, BALDES_DISTANCIA);
  const p26 = contarUnica(encuestas, (e) => cf(e).aprovechamiento_directo, SINO_OPTS);
  const p27 = contarMultiple(encuestas, (e) => cf(e).actividades_finca);
  const p27a = contarMultiple(encuestas, (e) => cf(e).actividades_agricolas);
  const p27b = contarMultiple(encuestas, (e) => cf(e).actividades_pecuarias);

  const caracterizacionFinca: EncuestaSeccionStats = {
    id: 'caracterizacion_finca',
    titulo: 'RESULTADO CARACTERIZACIÓN DE LA FINCA',
    icono: '🏠',
    color: '#8D6E63',
    graficas: [
      { id: 'p21', titulo: '21. Área total de la finca', tipo: 'pie', datos: p21.datos, totalRespuestas: p21.total },
      { id: 'p22', titulo: '22. Distribución del uso del suelo (ha)', tipo: 'pie', datos: p22.datos, totalRespuestas: p22.total, unidad: 'ha' },
      { id: 'p23', titulo: '23. Medio de salida de productos', tipo: 'pie', datos: p23.datos, totalRespuestas: p23.total },
      { id: 'p24', titulo: '24. Distancia al centro poblado', tipo: 'pie', datos: p24.datos, totalRespuestas: p24.total },
      { id: 'p26', titulo: '26. Aprovechamiento productivo directo', tipo: 'pie', datos: p26.datos, totalRespuestas: p26.total },
      { id: 'p27', titulo: '27. Actividades que realiza en la finca', tipo: 'bar', datos: p27.datos, totalRespuestas: p27.total },
      { id: 'p27a', titulo: '27a. Actividades agrícolas', tipo: 'bar', datos: p27a.datos, totalRespuestas: p27a.total },
      { id: 'p27b', titulo: '27b. Actividades pecuarias', tipo: 'bar', datos: p27b.datos, totalRespuestas: p27b.total },
    ],
  };

  // ---- Componente productivo (P28-31) ----
  const cp = (e: any) => e.componente_productivo || {};
  const p28 = contarUnica(encuestas, (e) => cp(e).actividad_principal, ACTIVIDAD_PRODUCTIVA_OPTS);
  const p29 = contarUnica(encuestas, (e) => cp(e).acceso_agua, SINO_OPTS);
  const p30 = contarUnica(encuestas, (e) => cp(e).sistemas_riego, SINO_OPTS);
  const p31 = contarUnica(encuestas, (e) => cp(e).asistencia_tecnica, SINO_OPTS);

  const componenteProductivo: EncuestaSeccionStats = {
    id: 'componente_productivo',
    titulo: 'RESULTADO COMPONENTE PRODUCTIVO',
    icono: '🌱',
    color: '#1565C0',
    graficas: [
      { id: 'p28', titulo: '28. Actividad principal productiva', tipo: 'pie', datos: p28.datos, totalRespuestas: p28.total },
      { id: 'p29', titulo: '29. Acceso permanente al agua', tipo: 'pie', datos: p29.datos, totalRespuestas: p29.total },
      { id: 'p30', titulo: '30. Dispone de sistemas de riego', tipo: 'pie', datos: p30.datos, totalRespuestas: p30.total },
      { id: 'p31', titulo: '31. Asistencia técnica en los últimos 2 años', tipo: 'pie', datos: p31.datos, totalRespuestas: p31.total },
    ],
  };

  // ---- Sección de suelo (P32-42) ----
  const asuelo = (e: any) => e.analisis_suelo || {};
  const p33 = contarUnica(encuestas, (e) => asuelo(e).analisis_realizado, ANALISIS_SUELO_REALIZADO_OPTS);
  const p34 = contarMultiple(encuestas, (e) => asuelo(e).textura);
  const p35 = contarUnica(encuestas, (e) => asuelo(e).color, COLOR_SUELO_OPTS);
  const p36 = contarUnica(encuestas, (e) => asuelo(e).drenaje, DRENAJE_OPTS);
  const p37 = contarUnica(encuestas, (e) => asuelo(e).uso_tierra, USO_TIERRA_HISTORICO_OPTS);
  const p38 = contarUnica(encuestas, (e) => asuelo(e).piedras, PRESENCIA_PIEDRAS_OPTS);
  const p39raw = contarUnica(encuestas, (e) => asuelo(e).compactacion, COMPACTACION_OPTS);
  const p39 = { ...p39raw, datos: p39raw.datos.map((d) => ({ ...d, etiqueta: compactacionCorta(d.etiqueta) })) };
  const p40 = contarUnica(encuestas, (e) => asuelo(e).cobertura, COBERTURA_SUELO_OPTS);
  const p41 = contarUnica(encuestas, (e) => asuelo(e).erosion, EVIDENCIA_EROSION_OPTS);
  const p42 = contarBaldes(encuestas, (e) => asuelo(e).pendiente, BALDES_PENDIENTE);

  const seccionSuelo: EncuestaSeccionStats = {
    id: 'seccion_suelo',
    titulo: 'RESULTADO SECCIÓN DE SUELO',
    icono: '🔬',
    color: '#6A1B9A',
    graficas: [
      { id: 'p33', titulo: '33. ¿Ha realizado análisis de suelo?', tipo: 'pie', datos: p33.datos, totalRespuestas: p33.total },
      { id: 'p34', titulo: '34. Textura predominante del suelo', tipo: 'bar', datos: p34.datos, totalRespuestas: p34.total },
      { id: 'p35', titulo: '35. Coloración predominante', tipo: 'pie', datos: p35.datos, totalRespuestas: p35.total },
      { id: 'p36', titulo: '36. Tipo de drenaje', tipo: 'pie', datos: p36.datos, totalRespuestas: p36.total },
      { id: 'p37', titulo: '37. Uso histórico del suelo', tipo: 'pie', datos: p37.datos, totalRespuestas: p37.total },
      { id: 'p38', titulo: '38. Presencia de piedras o fragmentos rocosos', tipo: 'pie', datos: p38.datos, totalRespuestas: p38.total },
      { id: 'p39', titulo: '39. Estado de compactación del suelo', tipo: 'pie', datos: p39.datos, totalRespuestas: p39.total },
      { id: 'p40', titulo: '40. Cobertura del suelo', tipo: 'pie', datos: p40.datos, totalRespuestas: p40.total },
      { id: 'p41', titulo: '41. Evidencia de erosión', tipo: 'pie', datos: p41.datos, totalRespuestas: p41.total },
      { id: 'p42', titulo: '42. Grado de pendiente del terreno', tipo: 'pie', datos: p42.datos, totalRespuestas: p42.total },
    ],
  };

  // ---- Componente agroambiental (P43-50) ----
  const ca = (e: any) => e.componente_agroambiental || {};
  const p43 = contarUnica(encuestas, (e) => ca(e).procesos_erosion, PROCESOS_EROSION_OPTS);
  const p44 = contarUnica(encuestas, (e) => ca(e).fuentes_hidricas, FUENTES_HIDRICAS_OPTS);
  const p45 = contarMultiple(encuestas, (e) => ca(e).areas_conservacion);
  const p46 = contarUnica(encuestas, (e) => ca(e).practicas_conservacion, PRACTICAS_CONSERVACION_OPTS);
  const p47 = contarUnica(encuestas, (e) => ca(e).uso_agroquimicos, SINO_OPTS);
  const p48 = contarUnica(encuestas, (e) => ca(e).tipo_agroquimicos, [...TIPO_AGROQUIMICO_OPTS, 'Ninguno']);
  const p49 = contarLibre(encuestas, (e) => ca(e).herbicidas_cuales, true);
  const p50 = contarUnica(encuestas, (e) => ca(e).manejo_residuos, MANEJO_RESIDUOS_OPTS);

  const componenteAgroambiental: EncuestaSeccionStats = {
    id: 'componente_agroambiental',
    titulo: 'RESULTADO COMPONENTE AGROAMBIENTAL',
    icono: '🌿',
    color: '#E65100',
    graficas: [
      { id: 'p43', titulo: '43. Procesos de erosión en el predio', tipo: 'pie', datos: p43.datos, totalRespuestas: p43.total },
      { id: 'p44', titulo: '44. Fuentes hídricas dentro o cerca del predio', tipo: 'pie', datos: p44.datos, totalRespuestas: p44.total },
      { id: 'p45', titulo: '45. Áreas de conservación o protección', tipo: 'bar', datos: p45.datos, totalRespuestas: p45.total },
      { id: 'p46', titulo: '46. Prácticas de conservación del suelo', tipo: 'pie', datos: p46.datos, totalRespuestas: p46.total },
      { id: 'p47', titulo: '47. Utiliza algún tipo de agroquímico', tipo: 'pie', datos: p47.datos, totalRespuestas: p47.total },
      { id: 'p48', titulo: '48. Tipo de agroquímico que más utiliza', tipo: 'pie', datos: p48.datos, totalRespuestas: p48.total },
      { id: 'p49', titulo: '49. Agroquímico más mencionado', tipo: 'bar', datos: p49.datos, totalRespuestas: p49.total },
      { id: 'p50', titulo: '50. Manejo de residuos de agroquímicos', tipo: 'pie', datos: p50.datos, totalRespuestas: p50.total },
    ],
  };

  return [
    datosGenerales,
    componenteSocial,
    caracterizacionFinca,
    componenteProductivo,
    seccionSuelo,
    componenteAgroambiental,
  ];
}

/** Número de formularios de Encuesta Social AgroAmbiental disponibles (para el estado vacío). */
export function contarEncuestasSociales(formularios: Formulario[]): number {
  return formularios.filter(esEncuestaSocial).length;
}
