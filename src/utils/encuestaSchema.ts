// ============================================================
// GEODAILY — Esquema canónico de la Encuesta Social AgroAmbiental
// ============================================================
// FUENTE ÚNICA DE VERDAD para las 53 preguntas oficiales del
// Formulario 01 + el bloque de acompañamiento técnico.
//
// Lo consumen tanto el generador de PDF (pdfLocal.service) como
// la pantalla de "Detalle del Formulario". Antes cada uno tenía
// su propia lista de campos y divergieron: el PDF mostraba las 52
// preguntas y el detalle solo ~34, porque leía un modelo anterior.
//
// ⚠️ Al agregar o cambiar una pregunta, hazlo AQUÍ. Ambas vistas
//    se actualizan solas.
// ============================================================

import { Formulario } from '../types';
import { formatFecha } from './formatters';

/** Una pregunta con su respuesta ya resuelta a texto */
export interface PreguntaResuelta {
  /** Número oficial de la pregunta ('1'…'52') o '•' para datos de encabezado */
  numero: string;
  texto: string;
  /** Respuesta ya formateada. Cadena vacía si no se respondió. */
  valor: string;
  /** Observación adicional (bloque de acompañamiento técnico) */
  observacion?: string;
}

/** Un bloque del formulario con sus preguntas */
export interface SeccionResuelta {
  titulo: string;
  preguntas: PreguntaResuelta[];
  /**
   * true cuando las respuestas son texto largo (recomendaciones):
   * se renderizan a ancho completo en lugar de en dos columnas.
   */
  textoLargo?: boolean;
}

// ------------------------------------------------------------------
// Helpers de formato
// ------------------------------------------------------------------

/** Combina una respuesta con su campo "otro / especifique" */
const conOtro = (val?: string, otro?: string): string => {
  if (!val) return '';
  return otro ? `${val} — ${otro}` : val;
};

/** Formatea un valor con unidad, vacío si no hay dato */
const conUnidad = (val: string | number | undefined | null, unidad: string): string =>
  val !== undefined && val !== null && String(val).trim() !== ''
    ? `${val} ${unidad}`
    : '';

/** Formatea un trío de coordenadas */
const coords = (lat?: any, lon?: any, alt?: any): string => {
  if (!lat || !lon) return '';
  return `Lat: ${lat}  Lon: ${lon}${alt ? `  Alt: ${alt} m` : ''}`;
};

const p = (
  numero: string,
  texto: string,
  valor?: string | null,
  observacion?: string
): PreguntaResuelta => ({
  numero,
  texto,
  valor: valor ? String(valor) : '',
  observacion: observacion || undefined,
});

/** Ítem del acompañamiento técnico: Sí/No + extra opcional + observación */
const pAco = (
  numero: string,
  texto: string,
  si?: boolean,
  no?: boolean,
  obs?: string,
  extra?: string
): PreguntaResuelta => {
  const base = si ? 'Sí' : no ? 'No' : '';
  return {
    numero,
    texto,
    valor: base && extra ? `${base} · ${extra}` : base || (extra ?? ''),
    observacion: obs || undefined,
  };
};

// ------------------------------------------------------------------
// Construcción de secciones
// ------------------------------------------------------------------

/**
 * Resuelve la encuesta completa en secciones listas para renderizar.
 *
 * @param encuesta objeto `caracterizacion_nueva` del formulario
 * @param form     formulario contenedor, usado solo para respaldos
 *                 (fecha de creación, nombre del técnico)
 */
export function construirSeccionesEncuesta(
  encuesta: any,
  form?: Partial<Formulario>
): SeccionResuelta[] {
  const c = encuesta || {};
  const cs = c.componente_social || {};
  const cf = c.caracterizacion_finca || {};
  const cp = c.componente_productivo || {};
  const asuelo = c.analisis_suelo || {};
  const ca = c.componente_agroambiental || {};
  const rec = c.recomendaciones || {};
  const aco = c.acompaniamiento || {};

  // ---- Datos generales (encabezado oficial) ----
  const datosGenerales: SeccionResuelta = {
    titulo: 'DATOS GENERALES',
    preguntas: [
      p('•', 'Fecha', c.fecha || (form?.created_at ? formatFecha(form.created_at) : '')),
      p('•', 'Municipio', c.municipio),
      p('•', 'Vereda', c.vereda),
      p('•', 'Nombre del productor', c.productor_nombre),
      p('•', 'Edad (años)', c.edad),
      p('•', 'Sexo', conOtro(c.sexo, c.sexo_otro)),
      p('•', 'Documento (C.C.)', c.documento),
      p('•', 'Teléfono', c.telefono),
      p('•', 'Técnico responsable', c.tecnico_responsable || form?.tecnico?.nombre),
      p('•', 'Corregimiento', c.corregimiento),
    ],
  };

  // ---- Componente social (1-18) ----
  const componenteSocial: SeccionResuelta = {
    titulo: 'COMPONENTE SOCIAL',
    preguntas: [
      p('1', 'Se reconoce como:', conOtro(cs.reconocimiento, cs.reconocimiento_otro)),
      p('2', 'Nivel educativo del productor', cs.nivel_educativo),
      p('3', '¿Ha participado antes en Escuelas de Campo (ECA)?', cs.participo_eca),
      p('4', '¿Cuántas personas, incluyéndose usted, hacen parte de su núcleo familiar?', conUnidad(cs.personas_nucleo, 'personas')),
      p('5', 'Principal fuente de ingresos', conOtro(cs.fuente_ingresos, cs.fuente_ingresos_otra)),
      p('6', '¿Cuánto son sus ingresos en salarios?', cs.ingresos_salarios),
      p('7', '¿Cual es su ocupación secundaria?', conOtro(cs.ocupacion_secundaria, cs.ocupacion_secundaria_otro)),
      p('8', 'Participa en alguna organización o asociación', conOtro(cs.participa_organizacion, cs.organizacion_cual)),
      p('9', '¿A qué asociaciones u organizaciones se encuentra afiliado?', conOtro(cs.tipo_asociacion, cs.tipo_asociacion_otro)),
      p('10', '¿Cuál es el rol en la organización que está afiliado(a)?', cs.rol_asociacion),
      p('11', 'En donde está ubicada la vivienda principal de su núcleo familiar', conOtro(cs.vivienda_ubicacion, cs.vivienda_ubicacion_otra)),
      p('12', '¿Su vivienda cuenta con energía?', cs.energia_electrica),
      p('13', '¿Cuál es el tipo de energía con el que cuenta?', conOtro(cs.tipo_energia, cs.tipo_energia_otro)),
      p('14', '¿De dónde obtiene principalmente el agua para el consumo humano?', conOtro(cs.agua_consumo, cs.agua_consumo_otro)),
      p('15', '¿Cuenta con algunos de estos elementos? (respuesta multiple)', cs.elementos_tecnologicos),
      p('16', '¿Cuenta con señal de celular en su vivienda?', cs.senal_celular),
      p('17', '¿Quiénes trabajan en su finca? (respuesta multiple)', conOtro(cs.quienes_trabajan, cs.quienes_trabajan_otro)),
      p('18', '¿Qué medio de transporte utiliza?', conOtro(cs.medio_transporte, cs.medio_transporte_otro)),
    ],
  };

  // ---- Caracterización de la finca (19-27) ----
  const divisiones = [
    cf.division_bosque ? `Bosque: ${cf.division_bosque} ha` : '',
    cf.division_agricola ? `Agrícola: ${cf.division_agricola} ha` : '',
    cf.division_pecuaria ? `Pecuaria: ${cf.division_pecuaria} ha` : '',
    cf.division_instalaciones ? `Instalaciones: ${cf.division_instalaciones} ha` : '',
  ].filter(Boolean).join(' · ');

  const actividadesFinca = [
    conOtro(cf.actividades_finca, cf.actividades_finca_otro),
    cf.actividades_agricolas ? `Agrícolas: ${conOtro(cf.actividades_agricolas, cf.actividades_agricolas_otro)}` : '',
    cf.actividades_pecuarias ? `Pecuarias: ${conOtro(cf.actividades_pecuarias, cf.actividades_pecuarias_otro)}` : '',
  ].filter(Boolean).join(' | ');

  const caracterizacionFinca: SeccionResuelta = {
    titulo: 'CARACTERIZACIÓN DE LA FINCA',
    preguntas: [
      p('19', 'Nombre de la finca', cf.nombre_finca),
      p('20', 'Coordenada de la finca', coords(cf.latitud, cf.longitud, cf.altitud)),
      p('21', '¿Cuál es el área total de la finca en hectáreas?', conUnidad(cf.area_total, 'ha')),
      p('22', '¿Cómo está dividida en hectáreas?', divisiones),
      p('23', 'Medio de salida de productos al centro poblado más cercano', cf.medio_salida),
      p('24', 'Distancia aproximada del predio al centro poblado', conUnidad(cf.distancia_km, 'km')),
      p('25', 'Observaciones de la descripción llegada al predio (desde cabecera municipal)', cf.distancia_observaciones),
      p('26', '¿Realiza aprovechamiento productivo de manera directa?', conOtro(cf.aprovechamiento_directo, cf.aprovechamiento_porque ? `Porque: ${cf.aprovechamiento_porque}` : '')),
      p('27', '¿Cuáles son las actividades que realiza en su finca?', actividadesFinca),
    ],
  };

  // ---- Componente productivo (28-31) ----
  const componenteProductivo: SeccionResuelta = {
    titulo: 'COMPONENTE PRODUCTIVO',
    preguntas: [
      p('28', '¿Cual es la actividad principal productiva de la finca?', conOtro(cp.actividad_principal, cp.actividad_principal_cual)),
      p('29', '¿El predio cuenta con acceso permanente al agua?', cp.acceso_agua),
      p('30', '¿Dispone de sistemas de riego?', cp.sistemas_riego),
      p('31', '¿Ha recibido asistencia técnica en los últimos dos años?', cp.asistencia_tecnica),
    ],
  };

  // ---- Sección de suelo (32-42) ----
  const seccionSuelo: SeccionResuelta = {
    titulo: 'SECCIÓN DE SUELO',
    preguntas: [
      p('32', 'Ubicación del área de intervención del proyecto', coords(asuelo.intervencion_latitud, asuelo.intervencion_longitud, asuelo.intervencion_altitud)),
      p('33', '¿Ha realizado alguna vez análisis de suelo en su predio?', asuelo.analisis_realizado),
      p('34', '¿Cuál es la textura predominante en el suelo? Selección multiple', asuelo.textura),
      p('35', '¿Qué coloración predomina en el suelo?', asuelo.color),
      p('36', '¿Qué tipo de drenaje hay en el suelo?', asuelo.drenaje),
      p('37', '¿Cuál ha sido el uso que se le ha dado a la Tierra?', asuelo.uso_tierra),
      p('38', '¿Existe alguna presencia de piedras o fragmentos rocosos?', asuelo.piedras),
      p('39', '¿Cuál es el estado de la compactación del suelo?', asuelo.compactacion),
      p('40', '¿Qué presencia de cobertura presenta el suelo?', asuelo.cobertura),
      p('41', '¿Se evidencia algún tipo de erosión en el suelo?', asuelo.erosion),
      p('42', '¿Cual es el grado de Pendiente del terreno?', conUnidad(asuelo.pendiente, '°')),
    ],
  };

  // ---- Componente agroambiental (43-50) ----
  const componenteAgro: SeccionResuelta = {
    titulo: 'COMPONENTE AGROAMBIENTAL',
    preguntas: [
      p('43', '¿El predio presenta procesos de erosión?', ca.procesos_erosion),
      p('44', '¿Existen fuentes hídricas dentro o cerca del predio?', ca.fuentes_hidricas),
      p('45', '¿El predio cuenta con áreas de conservación o protección? (respuesta multiple)', ca.areas_conservacion),
      p('46', '¿Realiza prácticas de conservación del suelo?', ca.practicas_conservacion),
      p('47', '¿Utiliza algún tipo agroquímico?', ca.uso_agroquimicos),
      p('48', '¿Qué tipo de agroquímicos utiliza?', conOtro(ca.tipo_agroquimicos, ca.tipo_agroquimicos_otro)),
      p('49', 'Mencione el nombre del agroquimico', ca.herbicidas_cuales),
      p('50', '¿Realiza manejo de residuos de agroquímicos?', ca.manejo_residuos),
    ],
  };

  // ---- Recomendaciones del técnico (51-53) — texto largo ----
  const recomendaciones: SeccionResuelta = {
    titulo: 'RECOMENDACIONES DEL TÉCNICO',
    textoLargo: true,
    preguntas: [
      p('51', 'Recomendaciones técnicas para el sistema productivo:', rec.recomendaciones_tecnicas),
      p('52', 'Compromisos adquiridos sobre el desarrollo del estado actual del terreno:', rec.compromisos_productor),
      p('53', 'Recomendaciones ambientales y de conservación:', rec.recomendaciones_ambientales),
    ],
  };

  // ---- Desarrollo del acompañamiento técnico (6 ítems oficiales) ----
  const acompanamiento: SeccionResuelta = {
    titulo: 'DESARROLLO ACOMPAÑAMIENTO TÉCNICO',
    preguntas: [
      pAco('1', 'Socialización de actividades del proyecto al productor, mediante presentación digital.', aco.actividades_realizadas_si, aco.actividades_realizadas_no, aco.actividades_realizadas_obs),
      pAco('2', 'Realización de selección y delimitación técnica del terreno para la implementación del cultivo de cacao en arreglo agroforestal con plátano y maderable.', aco.manejo_plagas_si, aco.manejo_plagas_no, aco.manejo_plagas_obs),
      pAco('3', 'Realización de muestreo de suelo, teniendo en cuenta: criterios de homogeneidad, uso actual del terreno, topografía y condiciones agroecológicas.', aco.manejo_suelo_si, aco.manejo_suelo_no, aco.manejo_suelo_obs),
      pAco('4', 'Orientación al productor sobre procesos de producción y beneficios de la producción de cacao.', aco.capacitacion_si, aco.capacitacion_no, aco.capacitacion_obs),
      pAco('5', 'Orientación del manejo de preparación del terreno: realización de limpias si es rastrojo de porte bajo (herbáceas), recomendando no utilización de herbicidas a base de componentes de medio a altamente tóxicos.', aco.seguimiento_si, aco.seguimiento_no, aco.seguimiento_obs),
      pAco('6', 'Orientación del manejo de preparación del terreno: realización de entresacado en rastrojo biche de regeneración baja (arbóreas o arbustos), recomendando entresacado', aco.entresacado_si, aco.entresacado_no, aco.entresacado_obs),
      p('•', 'Observaciones generales', aco.observaciones_generales),
    ],
  };

  return [
    datosGenerales,
    componenteSocial,
    caracterizacionFinca,
    componenteProductivo,
    seccionSuelo,
    componenteAgro,
    recomendaciones,
    acompanamiento,
  ];
}

/**
 * ¿El formulario corresponde a la Encuesta Social AgroAmbiental?
 * Se usa para decidir qué vista de detalle renderizar.
 */
export function esEncuestaSocial(form: Partial<Formulario> | undefined | null): boolean {
  if (!form) return false;
  return form.tipo === 'caracterizacion' || !!(form as any).caracterizacion_nueva;
}
