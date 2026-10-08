// ============================================================
// GEODAILY — Reglas compartidas de resolución de novedades
// ============================================================

import type { Revision } from '../services/revisiones.service';

/** Tipos de revisión que determinan el estado de un rol (los checklists no cuentan). */
const TIPOS_ESTADO: ReadonlyArray<Revision['tipo']> = ['novedad', 'visto_bueno'];

/**
 * ¿El revisor de un rol ya "dio OK" al formulario? Se considera que sí
 * cuando su ÚLTIMO movimiento (novedad o visto bueno) fue un visto bueno.
 * Los checklists "formulario_en_linea/campo" se ignoran: no afectan el estado.
 */
export const rolEstaOk = (rol: string, revisiones: Revision[]): boolean => {
  const propias = revisiones
    .filter((r) => r.revisor_rol === rol && TIPOS_ESTADO.includes(r.tipo))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return propias[0]?.tipo === 'visto_bueno';
};

/**
 * Una novedad queda RESUELTA cuando el MISMO rol que la marcó la da por buena:
 *   1. Ese rol ya "dio OK" (su último movimiento fue un visto bueno) → se
 *      resuelven TODAS sus novedades de ese formulario. Esto refleja el flujo
 *      real: el coordinador/interventor aprueba por secciones y, cuando termina,
 *      todas sus observaciones previas quedan cerradas.
 *   2. O bien existe un visto bueno posterior que la cubre directamente:
 *      global (seccion = null) o de la MISMA sección.
 * No se borra nada: las novedades resueltas siguen visibles como historial.
 *
 * ⚠️ Este criterio DEBE mantenerse idéntico al SQL de
 * GET /api/revisiones/resumen (campo novedades_total), para que la tarjeta
 * del listado y el detalle del formulario coincidan siempre.
 */
export const estaNovedadResuelta = (
  novedad: Revision,
  revisiones: Revision[]
): boolean => {
  if (rolEstaOk(novedad.revisor_rol, revisiones)) return true;
  return revisiones.some(
    (x) =>
      x.revisor_rol === novedad.revisor_rol &&
      x.tipo === 'visto_bueno' &&
      (!x.seccion || x.seccion === novedad.seccion) &&
      new Date(x.created_at).getTime() >= new Date(novedad.created_at).getTime()
  );
};

/** Cuántas novedades siguen pendientes (sin resolver) en un formulario. */
export const contarNovedadesPendientes = (revisiones: Revision[]): number =>
  revisiones.filter((r) => r.tipo === 'novedad' && !estaNovedadResuelta(r, revisiones)).length;
