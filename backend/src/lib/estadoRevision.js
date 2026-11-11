// ============================================================
// GEODAILY — Estado del flujo de revisión de un formulario
// ============================================================
// ÚNICA fuente de verdad del estado de revisión. La usan:
//   - GET /api/revisiones/resumen  (badges de listados)
//   - GET /api/revisiones/:id      (detalle)
//   - POST /api/revisiones/:id     (jerarquía interventor + cierre duplicado)
//   - lib/correcciones.js          (a quién avisar cuando el técnico corrige)
// La app replica las reglas básicas en src/utils/revisiones.ts (con los
// MISMOS casos de prueba) solo para pintar el detalle sin esperar red.
//
// Por qué existe (nov-2026): la regla anterior daba un rol por "OK" si su
// ÚLTIMO clic era un visto bueno, aunque fuera de UNA sección. Además el
// botón final «Todo OK» se deshabilitaba con ese mismo criterio («✔ Ya
// aprobado por ti»), así que el coordinador NO PODÍA cerrar la revisión:
// 1 solo formulario con cierre en todo el sistema, interventoría bloqueada
// y técnicos viendo "Todo OK — en interventoría" sin que fuera cierto.
//
// REGLAS
//   • Novedad ABIERTA: no hay un visto bueno del MISMO rol, global
//     (seccion NULL) o de la MISMA sección, posterior o igual a ella.
//   • Rol CERRADO: tiene un visto bueno global (el «cierre») posterior o
//     igual a su última novedad. Aprobar secciones NO cierra.
//     Una novedad marcada después del cierre lo reabre.
//   • Flujo: coordinador → interventoría. Interventoría solo actúa sobre
//     formularios con la revisión del coordinador cerrada.
//   • CORRECCIÓN SIN VERIFICAR (nov-2026, caso Jonathan Molano / Segundo
//     Alfonso): una corrección del técnico (completar/corregir respuesta,
//     borrar evidencia, «ya corregí») posterior al último movimiento del
//     rol de la fase deja el formulario «por verificar» AUNQUE no hubiera
//     novedad registrada. Antes, si la corrección se pedía por fuera de la
//     app, quedaba en «sin revisar» sin ninguna señal y nadie la veía.
//   • Una corrección POSTERIOR al cierre de un rol lo reabre: lo aprobado
//     cambió, así que hay que volver a verificarlo y cerrar de nuevo.
// ============================================================

const ROLES = ['coordinador', 'interventor', 'gerente', 'admin'];

/** Rol que lleva cada fase del flujo jerárquico. */
const FASES = ['coordinador', 'interventor'];

const t = (fecha) => {
  const v = new Date(fecha).getTime();
  return Number.isFinite(v) ? v : 0;
};

/**
 * Estado de UN rol dentro del formulario.
 * @param {Array} revisiones filas de revisiones_formulario del formulario
 * @param {string} rol
 * @param {Array} correcciones [{ created_at }] correcciones del técnico
 */
function estadoDeRol(revisiones, rol, correcciones = []) {
  const propias = revisiones.filter(
    (r) => r.revisor_rol === rol && (r.tipo === 'novedad' || r.tipo === 'visto_bueno')
  );
  const novedades = propias.filter((r) => r.tipo === 'novedad');
  const vistos = propias.filter((r) => r.tipo === 'visto_bueno');

  const abiertas = novedades.filter(
    (n) =>
      !vistos.some(
        (vb) => (vb.seccion == null || vb.seccion === n.seccion) && t(vb.created_at) >= t(n.created_at)
      )
  );

  const ultimaNovedad = novedades.reduce((m, n) => Math.max(m, t(n.created_at)), 0);
  const cierres = vistos.filter((vb) => vb.seccion == null);
  const ultimoCierre = cierres.reduce((m, vb) => Math.max(m, t(vb.created_at)), 0);
  const ultimaCorreccion = correcciones.reduce((m, c) => Math.max(m, t(c.created_at)), 0);
  // Una corrección posterior al cierre lo reabre (estrictamente posterior:
  // si el revisor cerró en el mismo instante, ya la vio).
  // `cerradoSinCorreccion` es la regla anterior; calcularEstadoRevision la
  // usa para no reabrir un rol cuando una fase POSTERIOR cerró después de
  // la corrección (interventoría ya la verificó).
  const cerradoSinCorreccion = cierres.length > 0 && ultimoCierre >= ultimaNovedad;
  const cerrado = cerradoSinCorreccion && !(ultimaCorreccion > ultimoCierre);

  // Secciones cuyo ÚLTIMO movimiento de este rol es un visto bueno.
  const ultimoPorSeccion = new Map();
  for (const r of propias) {
    if (r.seccion == null) continue;
    const prev = ultimoPorSeccion.get(r.seccion);
    if (!prev || t(r.created_at) > t(prev.created_at) || (t(r.created_at) === t(prev.created_at) && r.id > prev.id)) {
      ultimoPorSeccion.set(r.seccion, r);
    }
  }
  const seccionesAprobadas = [...ultimoPorSeccion.values()]
    .filter((r) => r.tipo === 'visto_bueno')
    .map((r) => r.seccion);

  const corregidaDespues = (n) => correcciones.some((c) => t(c.created_at) > t(n.created_at));
  const porVerificar = abiertas.filter(corregidaDespues);

  return {
    rol,
    movimientos: propias.length,
    cerrado,
    cerradoSinCorreccion,
    ultimaCorreccion,
    ultimoCierre,
    abiertas,
    porVerificar,
    seccionesAprobadas,
    ultimoMovimiento: propias.reduce((m, r) => Math.max(m, t(r.created_at)), 0),
  };
}

/**
 * Estado completo del formulario.
 * Devuelve un objeto plano compatible con el formato histórico de
 * /resumen (coordinador/interventor/gerente/admin + novedades_total) más
 * los campos nuevos del flujo.
 */
function calcularEstadoRevision(revisiones = [], correcciones = []) {
  const porRol = {};
  for (const rol of ROLES) porRol[rol] = estadoDeRol(revisiones, rol, correcciones);

  // Un rol reabierto SOLO por una corrección vuelve a contar como cerrado
  // si una fase posterior cerró después de esa corrección: interventoría
  // ya verificó lo corregido y no tiene sentido devolvérselo al coordinador.
  FASES.forEach((rol, i) => {
    const e = porRol[rol];
    if (e.cerrado || !e.cerradoSinCorreccion) return;
    const verificadaDespues = FASES.slice(i + 1).some(
      (sig) => porRol[sig].cerradoSinCorreccion && porRol[sig].ultimoCierre >= e.ultimaCorreccion
    );
    if (verificadaDespues) e.cerrado = true;
  });

  // Compatibilidad: 'ok' ahora significa CERRADO (visto bueno final), no
  // "último clic fue un visto bueno". Las versiones viejas de la app leen
  // este campo, así que dejan de mostrar "Todo OK" falsos sin actualizarse.
  const estadoCompat = (e) => (e.cerrado ? 'ok' : e.movimientos > 0 ? 'novedades' : null);

  // Fase actual: la primera fase sin cerrar.
  let rolFlujo = null;
  for (const rol of FASES) {
    if (!porRol[rol].cerrado) {
      rolFlujo = rol;
      break;
    }
  }

  const ultimaCorreccion = correcciones.reduce((m, c) => Math.max(m, t(c.created_at)), 0);

  // ¿Hay una corrección que el rol de la fase aún no ha visto? Se compara
  // con lo último que ese rol hizo en el formulario y, desde la segunda
  // fase, con el cierre de la fase anterior (lo corregido antes de que el
  // coordinador cerrara ya lo verificó el coordinador).
  let correccionSinVerificar = false;
  if (rolFlujo !== null && ultimaCorreccion > 0) {
    const idx = FASES.indexOf(rolFlujo);
    const referencia = Math.max(
      porRol[rolFlujo].ultimoMovimiento,
      ...FASES.slice(0, idx).map((r) => porRol[r].ultimoCierre)
    );
    correccionSinVerificar = ultimaCorreccion > referencia;
  }

  let estadoFlujo;
  let turno; // 'tecnico' | rol revisor | null
  if (rolFlujo === null) {
    estadoFlujo = 'aprobado';
    turno = null;
  } else {
    const e = porRol[rolFlujo];
    if (e.movimientos === 0) {
      estadoFlujo = correccionSinVerificar
        ? 'por_verificar'
        : rolFlujo === 'coordinador'
          ? 'sin_revisar'
          : 'en_interventoria';
      turno = rolFlujo;
    } else if (e.abiertas.length > 0) {
      if (e.porVerificar.length === e.abiertas.length) {
        estadoFlujo = 'por_verificar';
        turno = rolFlujo;
      } else {
        estadoFlujo = 'por_corregir';
        turno = 'tecnico';
      }
    } else {
      // Sin novedades abiertas: si el técnico corrigió algo después de lo
      // último que vio el revisor, está por verificar; si no, falta cerrar.
      estadoFlujo = correccionSinVerificar ? 'por_verificar' : 'por_cerrar';
      turno = rolFlujo;
    }
  }

  const todasAbiertas = ROLES.flatMap((r) => porRol[r].abiertas);
  const todasPorVerificar = ROLES.flatMap((r) => porRol[r].porVerificar);
  const ultimoMovimiento = Math.max(
    ultimaCorreccion,
    ...ROLES.map((r) => porRol[r].ultimoMovimiento)
  );
  const fase = rolFlujo ? porRol[rolFlujo] : null;

  return {
    coordinador: estadoCompat(porRol.coordinador),
    interventor: estadoCompat(porRol.interventor),
    gerente: estadoCompat(porRol.gerente),
    admin: estadoCompat(porRol.admin),
    novedades_total: todasAbiertas.length,
    por_verificar: todasPorVerificar.length,
    ultima_correccion:
      (todasPorVerificar.length > 0 || correccionSinVerificar) && ultimaCorreccion
        ? new Date(ultimaCorreccion).toISOString()
        : null,
    /** Hay una corrección posterior a lo último que vio el rol de la fase (con o sin novedad). */
    correccion_sin_verificar: correccionSinVerificar,
    // ── Flujo ──
    estado_flujo: estadoFlujo,
    rol_flujo: rolFlujo,
    turno,
    /** Novedades abiertas / por verificar de la fase actual. */
    novedades_fase: fase ? fase.abiertas.length : 0,
    por_verificar_fase: fase ? fase.porVerificar.length : 0,
    /** Secciones aprobadas por el rol de la fase actual. */
    secciones_aprobadas: fase ? fase.seccionesAprobadas.length : 0,
    /** Último movimiento (revisión o corrección): para medir días atascado. */
    ultimo_movimiento: ultimoMovimiento ? new Date(ultimoMovimiento).toISOString() : null,
    /** Detalle interno (no se serializa en /resumen). */
    _porRol: porRol,
  };
}

/** Versión serializable (sin el detalle interno). */
function estadoPublico(estado, { conAbiertas = false } = {}) {
  const { _porRol, ...publico } = estado;
  if (conAbiertas) {
    publico.novedades_abiertas_ids = ROLES.flatMap((r) => _porRol[r].abiertas.map((n) => n.id));
    publico.secciones_aprobadas_por_rol = Object.fromEntries(
      ROLES.map((r) => [r, _porRol[r].seccionesAprobadas])
    );
    publico.cerrado_por_rol = Object.fromEntries(ROLES.map((r) => [r, _porRol[r].cerrado]));
  }
  return publico;
}

module.exports = { ROLES, FASES, estadoDeRol, calcularEstadoRevision, estadoPublico };
