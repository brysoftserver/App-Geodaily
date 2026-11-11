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
/** Fases del flujo jerárquico (igual que FASES en el backend). */
const FASES = ['coordinador', 'interventor'];

/** Último cierre vigente del rol sin mirar correcciones (0 si no cerró). */
const cierreSinCorreccion = (rol: string, revisiones: Revision[]): number => {
  const propias = revisiones.filter((r) => r.revisor_rol === rol && TIPOS_ESTADO.includes(r.tipo));
  const cierres = propias.filter((r) => r.tipo === 'visto_bueno' && !r.seccion);
  if (cierres.length === 0) return 0;
  const ultimoCierre = Math.max(...cierres.map((r) => ts(r.created_at)));
  const ultimaNovedad = Math.max(0, ...propias.filter((r) => r.tipo === 'novedad').map((r) => ts(r.created_at)));
  return ultimoCierre >= ultimaNovedad ? ultimoCierre : 0;
};

/**
 * Además (nov-2026): una corrección del técnico POSTERIOR al cierre lo
 * reabre, salvo que una fase posterior (interventoría) haya cerrado después
 * de esa corrección. `correcciones` es opcional para no romper llamadas
 * antiguas: sin ella se comporta como antes.
 */
export const rolEstaOk = (rol: string, revisiones: Revision[], correcciones: Correccion[] = []): boolean => {
  const ultimoCierre = cierreSinCorreccion(rol, revisiones);
  if (!ultimoCierre) return false;
  const ultimaCorreccion = Math.max(0, ...(correcciones || []).map((c) => ts(c.created_at)));
  if (!(ultimaCorreccion > ultimoCierre)) return true;
  const idx = FASES.indexOf(rol);
  if (idx < 0) return false;
  return FASES.slice(idx + 1).some((sig) => cierreSinCorreccion(sig, revisiones) >= ultimaCorreccion);
};

/**
 * Correcciones del técnico que el rol todavía NO ha visto: posteriores a
 * su último movimiento en el formulario y, para interventoría, también al
 * cierre del coordinador. Mismo criterio que `correccion_sin_verificar` de
 * backend/src/lib/estadoRevision.js. Sirve para mostrarle al revisor qué
 * cambió aunque no hubiera marcado ninguna novedad (caso: el técnico usó
 * «✎ Completar» a pedido del revisor por fuera de la app).
 */
export const correccionesSinVerificar = (
  rol: string,
  revisiones: Revision[],
  correcciones: Correccion[] | undefined
): Correccion[] => {
  if (!correcciones?.length) return [];
  const propias = revisiones.filter((r) => r.revisor_rol === rol && TIPOS_ESTADO.includes(r.tipo));
  const ultimoPropio = Math.max(0, ...propias.map((r) => ts(r.created_at)));
  const idx = FASES.indexOf(rol);
  const cierresPrevios = idx > 0 ? FASES.slice(0, idx).map((r) => cierreSinCorreccion(r, revisiones)) : [];
  const referencia = Math.max(ultimoPropio, ...cierresPrevios);
  return correcciones
    .filter((c) => ts(c.created_at) > referencia)
    .sort((a, b) => ts(b.created_at) - ts(a.created_at));
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
