// ============================================================
// GEODAILY — Polígonos (mediciones) de la Visita Técnica 2
// ============================================================
// Lista canónica: `actividad.mediciones_historial`. Formatos anteriores que
// se siguen leyendo: `medicion_historial` (uno) y `medicion_historial_2`
// (segundo que cargaba el admin). Mismo criterio que la app en
// src/utils/medicionesVisita.ts.
//
// Reglas:
//  · Una visita COMPLETADA (fila en `formularios`) solo cambia sus polígonos
//    por /api/edicion-visitas (admin autorizado). Una resincronización del
//    teléfono (POST /formularios/guardar) conserva los del servidor.
//  · El historial que se ofrece para elegir es el del técnico de la visita,
//    limitado al beneficiario: mediciones con su cédula o, si la medición no
//    tiene cédula (restauradas/antiguas), las que quedan cerca del punto de
//    la visita.
// ============================================================

const { normalizarCedula } = require('./visitas');

const MAX_POLIGONOS = 10;
/** Distancia máxima (m) para ofrecer una medición sin cédula como "cercana". */
const RADIO_CERCANIA_M = 500;

const aObjeto = (v) => {
  if (!v) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v) || {}; } catch { return {}; }
  }
  return typeof v === 'object' ? v : {};
};

const numero = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

function medicionesDe(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const crudas = Array.isArray(obj.mediciones_historial) && obj.mediciones_historial.length > 0
    ? obj.mediciones_historial
    : [obj.medicion_historial, obj.medicion_historial_2];
  const vistos = new Set();
  return crudas.filter((m) => {
    if (!m || typeof m !== 'object' || !Array.isArray(m.puntos) || m.puntos.length === 0) return false;
    const id = String(m.id ?? '');
    if (id && vistos.has(id)) return false;
    if (id) vistos.add(id);
    return true;
  });
}

/** Polígonos de una actividad (con respaldo en visita_datos si llegó "adelgazada"). */
function leerPoligonos(actividad) {
  const directas = medicionesDe(actividad);
  return directas.length > 0 ? directas : medicionesDe(aObjeto(actividad && actividad.visita_datos));
}

/** Escribe la lista en la actividad y en visita_datos; `medicion_historial` = el primero (compatibilidad). */
function escribirPoligonos(actividad, lista) {
  const datos = actividad.visita_datos && typeof actividad.visita_datos === 'object' ? actividad.visita_datos : {};
  for (const obj of [actividad, datos]) {
    delete obj.medicion_historial_2;
    if (lista.length > 0) {
      obj.mediciones_historial = lista;
      obj.medicion_historial = lista[0];
    } else {
      delete obj.mediciones_historial;
      delete obj.medicion_historial;
    }
  }
  actividad.visita_datos = datos;
}

/**
 * Resincronización de una visita ya completada: los polígonos que manden
 * son los del servidor (los pudo haber cambiado un admin), no los de la
 * copia del teléfono. Modifica y devuelve `actividadNueva`.
 */
function conservarPoligonos(actividadNueva, actividadExistente) {
  if (!actividadNueva || typeof actividadNueva !== 'object') return actividadNueva;
  const existentes = leerPoligonos(aObjeto(actividadExistente));
  escribirPoligonos(actividadNueva, existentes);
  return actividadNueva;
}

// ─── Cercanía ────────────────────────────────────────────────

function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLon = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function puntoDentro(p, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i];
    const b = poligono[j];
    if ((a.latitud > p.latitud) !== (b.latitud > p.latitud) &&
        p.longitud < ((b.longitud - a.longitud) * (p.latitud - a.latitud)) / (b.latitud - a.latitud) + a.longitud) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/** Distancia (m) del punto al polígono: 0 si está dentro; si no, al vértice más cercano. */
function distanciaAPoligono(punto, puntos) {
  const pts = (puntos || [])
    .map((p) => ({ latitud: numero(p && p.latitud), longitud: numero(p && p.longitud) }))
    .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud));
  if (pts.length === 0) return Infinity;
  if (pts.length >= 3 && puntoDentro(punto, pts)) return 0;
  return Math.min(...pts.map((p) => distanciaMetros(punto, p)));
}

/**
 * Punto de referencia de la visita: coordenadas del formulario → primer
 * vértice del ítem 4 → estado completo (visita_datos) → centro del primer
 * polígono ya adjunto. null si no hay ninguno.
 */
function puntoDeVisita(actividad, coordenadas) {
  const act = aObjeto(actividad);
  const coords = aObjeto(coordenadas);
  const datos = aObjeto(act.visita_datos);
  const candidatos = [
    coords,
    Array.isArray(act.poligono) ? act.poligono[0] : null,
    datos,
  ];
  for (const c of candidatos) {
    const lat = numero(c && c.latitud);
    const lon = numero(c && c.longitud);
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) return { latitud: lat, longitud: lon };
  }
  const primero = leerPoligonos(act)[0];
  if (primero) {
    const pts = primero.puntos.map((p) => ({ latitud: numero(p.latitud), longitud: numero(p.longitud) }))
      .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud));
    if (pts.length > 0) {
      return {
        latitud: pts.reduce((a, p) => a + p.latitud, 0) / pts.length,
        longitud: pts.reduce((a, p) => a + p.longitud, 0) / pts.length,
      };
    }
  }
  return null;
}

/**
 * Filtra el historial del técnico para el beneficiario de la visita.
 * Cada medición debe traer `beneficiario_cedula` y `puntos`. Devuelve las que
 * aplican, con `delBeneficiario` (misma cédula) o `cercana` + `distancia_m`
 * (sin cédula, a ≤ RADIO_CERCANIA_M del punto de la visita). Primero las del
 * beneficiario y luego las cercanas por distancia.
 */
function filtrarParaBeneficiario(mediciones, { cedula, punto }) {
  const ced = normalizarCedula(cedula);
  const out = [];
  for (const m of mediciones) {
    const cedM = normalizarCedula(m.beneficiario_cedula);
    if (cedM) {
      if (ced && cedM === ced) out.push({ ...m, delBeneficiario: true, cercana: false });
      continue;
    }
    if (!punto) continue;
    const d = distanciaAPoligono(punto, m.puntos);
    if (d <= RADIO_CERCANIA_M) out.push({ ...m, delBeneficiario: false, cercana: true, distancia_m: Math.round(d) });
  }
  return out.sort((a, b) =>
    Number(b.delBeneficiario) - Number(a.delBeneficiario) || (a.distancia_m ?? 0) - (b.distancia_m ?? 0));
}

/**
 * Aplica la selección múltiple del admin sobre los polígonos actuales.
 *  · `ofrecidas`: ids que el admin vio en la lista (con casilla).
 *  · `elegidas`: mediciones marcadas, en el orden en que se marcaron.
 * Se conservan los polígonos que NO estaban en la lista (KML, o mediciones
 * que el filtro no ofreció) y los marcados; los desmarcados se quitan; los
 * marcados nuevos se agregan al final.
 */
function aplicarSeleccion(existentes, ofrecidas, elegidas) {
  const ofrecidasSet = new Set(ofrecidas);
  const elegidasIds = new Set(elegidas.map((m) => m.id));
  const quedan = existentes.filter((e) => !ofrecidasSet.has(e.id) || elegidasIds.has(e.id));
  const yaEstan = new Set(quedan.map((e) => e.id));
  return [...quedan, ...elegidas.filter((m) => !yaEstan.has(m.id))];
}

module.exports = {
  MAX_POLIGONOS,
  aplicarSeleccion,
  RADIO_CERCANIA_M,
  medicionesDe,
  leerPoligonos,
  escribirPoligonos,
  conservarPoligonos,
  distanciaAPoligono,
  puntoDeVisita,
  filtrarParaBeneficiario,
};
