// ============================================================
// GEODAILY — Reglas compartidas de resolución de novedades
// ============================================================

import type { Revision, Correccion } from '../services/revisiones.service';

/** Tipos de revisión que determinan el estado de un rol (los checklists no cuentan). */
const TIPOS_ESTADO: ReadonlyArray<Revision['tipo']> = ['novedad', 'visto_bueno'];

const ts = (fecha: string): number => {
  const v = new Date(fecha).getTime();
  return Number.isFinite(v) ? v : 0;
};

/*
 * ⚠️ Estas reglas replican backend/src/lib/estadoRevision.js (la fuente de
 * verdad, que además calcula el estado del flujo). Ambas suites corren los
 * MISMOS casos: backend/src/lib/__tests__/casosEstadoRevision.json.
 *
 * Antes un rol quedaba "OK" si su ÚLTIMO clic era un visto bueno, aunque
 * fuera de una sola sección; con eso el botón «Todo OK» se deshabilitaba
 * («✔ Ya aprobado por ti») y el coordinador no podía cerrar la revisión.
 */

/**
 * ¿El rol CERRÓ su revisión? Sí cuando tiene un visto bueno GLOBAL
 * (seccion null — el «cierre») posterior o igual a su última novedad.
 * Aprobar secciones no cierra; una novedad posterior al cierre lo reabre.
 */
export const rolEstaOk = (rol: string, revisiones: Revision[]): boolean => {
  const propias = revisiones.filter((r) => r.revisor_rol === rol && TIPOS_ESTADO.includes(r.tipo));
  const cierres = propias.filter((r) => r.tipo === 'visto_bueno' && !r.seccion);
  if (cierres.length === 0) return false;
  const ultimoCierre = Math.max(...cierres.map((r) => ts(r.created_at)));
  const ultimaNovedad = Math.max(0, ...propias.filter((r) => r.tipo === 'novedad').map((r) => ts(r.created_at)));
  return ultimoCierre >= ultimaNovedad;
};

/** Alias con el nombre que describe la regla actual. */
export const rolCerroRevision = rolEstaOk;

/**
 * Una novedad queda RESUELTA cuando el MISMO rol que la marcó da un visto
 * bueno posterior (o igual) que la cubre: global (el cierre) o de la MISMA
 * sección. Aprobar OTRA sección ya no la resuelve.
 * No se borra nada: las novedades resueltas siguen visibles como historial.
 */
export const estaNovedadResuelta = (
  novedad: Revision,
  revisiones: Revision[]
): boolean =>
  revisiones.some(
    (x) =>
      x.revisor_rol === novedad.revisor_rol &&
      x.tipo === 'visto_bueno' &&
      (!x.seccion || x.seccion === novedad.seccion) &&
      ts(x.created_at) >= ts(novedad.created_at)
  );

/** Cuántas novedades siguen pendientes (sin resolver) en un formulario. */
export const contarNovedadesPendientes = (revisiones: Revision[]): number =>
  revisiones.filter((r) => r.tipo === 'novedad' && !estaNovedadResuelta(r, revisiones)).length;

/**
 * Secciones cuyo ÚLTIMO movimiento del rol es un visto bueno (mismo
 * criterio que `seccionesAprobadas` del backend).
 */
export const seccionesAprobadasPorRol = (rol: string, revisiones: Revision[]): string[] => {
  const ultimo = new Map<string, Revision>();
  for (const r of revisiones) {
    if (r.revisor_rol !== rol || !r.seccion || !TIPOS_ESTADO.includes(r.tipo)) continue;
    const prev = ultimo.get(r.seccion);
    if (!prev || ts(r.created_at) > ts(prev.created_at) || (ts(r.created_at) === ts(prev.created_at) && r.id > prev.id)) {
      ultimo.set(r.seccion, r);
    }
  }
  return [...ultimo.values()].filter((r) => r.tipo === 'visto_bueno').map((r) => r.seccion as string);
};

/**
 * Corrección del técnico POSTERIOR a la novedad (la más reciente), o null.
 * Una novedad pendiente con corrección posterior se muestra como
 * "corregida — por verificar": sigue abierta hasta el visto bueno del
 * revisor, pero el revisor sabe que debe volver a mirarla.
 *
 * ⚠️ Mismo criterio que backend/src/lib/correcciones.js
 * (novedadEstaCorregida) y que el campo por_verificar de /resumen.
 */
export const correccionPosterior = (
  novedad: Revision,
  correcciones: Correccion[] | undefined
): Correccion | null => {
  const tNovedad = new Date(novedad.created_at).getTime();
  if (!Number.isFinite(tNovedad) || !correcciones?.length) return null;
  let ultima: Correccion | null = null;
  for (const c of correcciones) {
    const t = new Date(c.created_at).getTime();
    if (t > tNovedad && (!ultima || t > new Date(ultima.created_at).getTime())) ultima = c;
  }
  return ultima;
};
