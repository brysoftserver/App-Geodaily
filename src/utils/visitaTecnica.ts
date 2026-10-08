// ============================================================
// GEODAILY — Configuración de las Visitas Técnicas
// ============================================================
// El técnico entra a "Visita Técnica" y ve UN BOTÓN POR VISITA.
// La cantidad de visitas todavía no está cerrada, así que aquí se
// centraliza la lista: para agregar la Visita 3, 4, … basta con añadir
// un objeto al arreglo `VISITAS_TECNICAS` (y, si cambia el formato del
// formulario, apuntar `formato` a otro valor).
//
// `formato` marca la versión del formulario que se abre con ese botón:
//   - 'v2' → `VisitaTecnicaFormScreen` (el formato nuevo por ítems).
//   - undefined / ausente → formulario antiguo (`FormularioScreen`).
// El marcador se guarda en `actividad.formato_visita` para poder rutear
// los borradores correctamente desde "Formularios Incompletos".
// ============================================================

export type FormatoVisita = 'v2';

export interface VisitaTecnicaDef {
  /** Número de la visita (1, 2, 3…). Se guarda en `actividad.visita_numero`. */
  numero: number;
  /** Título visible del botón. */
  titulo: string;
  /** Texto corto de apoyo debajo del título. */
  descripcion: string;
  /** Emoji/ícono del botón. */
  icono: string;
  /** Versión de formulario que abre este botón. */
  formato: FormatoVisita;
  /** Color de acento del botón. */
  color: string;
}

/**
 * Botones que se muestran al entrar a "Visita Técnica".
 * Actualmente solo la Visita 2 (el formato nuevo). Agrega aquí las
 * siguientes visitas cuando se definan.
 */
export const VISITAS_TECNICAS: VisitaTecnicaDef[] = [
  {
    numero: 2,
    titulo: 'Visita Técnica 2',
    descripcion: 'Seguimiento, compromisos y registro fotográfico',
    icono: '📋',
    formato: 'v2',
    color: '#1565C0',
  },
];

/** Devuelve la definición de una visita por su número (o la primera). */
export const getVisitaTecnica = (numero?: number): VisitaTecnicaDef | undefined =>
  numero != null ? VISITAS_TECNICAS.find((v) => v.numero === numero) : VISITAS_TECNICAS[0];

// ─── Rótulos de visitas ya guardadas ─────────────────────────
// Estos dos helpers se usan en las listas, el detalle y el PDF para que el
// número de la visita NO se pierda. Sin ellos todo se veía como "Visita
// Técnica" a secas y no se distinguía la Visita 2 de una visita antigua.

/**
 * ¿La actividad viene del formulario nuevo por ítems (formato 'v2')?
 * Los formularios de visita técnica del formato antiguo no traen
 * `formato_visita`, así que se conservan tal cual.
 */
export const esVisitaTecnicaV2 = (
  actividad?: { formato_visita?: string } | null
): boolean => actividad?.formato_visita === 'v2';

/**
 * Título visible de una visita técnica, conservando su número:
 *   - con número → "Visita Técnica 2"
 *   - sin número (formato antiguo) → "Visita Técnica"
 */
export const tituloVisitaTecnica = (numero?: number): string =>
  numero != null ? `Visita Técnica ${numero}` : 'Visita Técnica';

// ─── Valores por defecto del formulario de visita técnica ───

/** Ítem 2 — Objetivo de la visita (texto sugerido, editable). */
export const OBJETIVO_VISITA_DEFAULT =
  'Realizar seguimiento y asistencia técnica al proceso de asistencia técnica.';

/**
 * Ítem 8 — Compromisos base para la visita siguiente.
 * El técnico puede activarlos/desactivarlos y agregar los que necesite.
 */
export const COMPROMISOS_VISITA_DEFAULT: string[] = [
  'Cercar el terreno',
  'Limpieza del terreno',
  'Trazar para siembra de plátano',
  'Realizar ahoyado',
];

/** Texto guía de cada ítem (columna DESCRIPCIÓN de la tabla). */
export const DESCRIPCION_ITEM: Record<string, string> = {
  no_identificacion: 'Generar desplegable con los datos',
  objetivo: 'Realizar seguimiento y asistencia técnica al proceso de asistencia técnica',
  descripcion_visita: 'Describir condiciones actuales del predio y paso a paso de la visita',
  georreferenciacion: 'Georreferenciar el área a intervenir',
  seguimiento_compromisos:
    'Describir cómo las actividades que se han realizado para el cumplimiento de los compromisos adquiridos previamente',
  valoracion_cumplimiento: 'Establecer un valor porcentual del cumplimiento de los compromisos',
  recomendaciones: 'Realizar recomendaciones técnicas',
  compromisos_siguiente: 'Compromisos adquiridos para la próxima visita',
  registro_fotografico: 'Beneficiario y técnico, terreno',
  observaciones: 'Describir situaciones anómalas',
};
