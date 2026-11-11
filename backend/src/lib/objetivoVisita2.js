// ============================================================
// Objetivo fijo de la Visita Técnica 2 (formato 'v2')
// ============================================================
// Todas las Visitas 2 llevan el mismo objetivo. Versiones anteriores de la
// app dejaban editarlo, así que el servidor lo fija al recibir formularios y
// borradores: cubre teléfonos sin actualizar y re-sincronizaciones de copias
// viejas. Debe coincidir con OBJETIVO_VISITA_DEFAULT de
// src/utils/visitaTecnica.ts (app).
// ============================================================

const OBJETIVO_VISITA_2 =
  'Asistir técnicamente las Unidades de Producción Agropecuaria en preparación de lote seleccionado para establecer el cultivo de cacao en arreglo agroforestal';

const esVisita2 = (actividad) =>
  !!actividad && typeof actividad === 'object' && actividad.formato_visita === 'v2';

/**
 * Fija el objetivo en la actividad (y en su espejo `visita_datos`) si es una
 * Visita 2. Modifica el objeto recibido y devuelve true si cambió algo.
 * Cualquier otra actividad se deja intacta.
 */
function fijarObjetivoVisita2(actividad) {
  if (!esVisita2(actividad)) return false;
  let cambio = false;
  if (actividad.objetivo !== OBJETIVO_VISITA_2) {
    actividad.objetivo = OBJETIVO_VISITA_2;
    cambio = true;
  }
  const vd = actividad.visita_datos;
  if (vd && typeof vd === 'object' && !Array.isArray(vd) && vd.objetivo !== OBJETIVO_VISITA_2) {
    vd.objetivo = OBJETIVO_VISITA_2;
    cambio = true;
  }
  return cambio;
}

module.exports = { OBJETIVO_VISITA_2, fijarObjetivoVisita2, esVisita2 };
