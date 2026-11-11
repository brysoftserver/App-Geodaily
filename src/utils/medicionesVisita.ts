// ============================================================
// GEODAILY — Polígonos (mediciones) adjuntos a una Visita Técnica 2
// ============================================================
// Una visita puede tener VARIOS polígonos (p. ej. un lote de 1 ha y otro de
// 1,5 ha = 2,5 ha). El campo canónico es `mediciones_historial` (lista).
// Formatos anteriores, que se siguen leyendo sin migrar datos:
//   · `medicion_historial`   → un solo polígono (el del técnico).
//   · `medicion_historial_2` → segundo polígono que cargaba un admin.
// Al guardar, `medicion_historial` se mantiene = primer polígono para que
// las versiones anteriores de la app sigan viendo al menos uno.
// ============================================================

import type { ActividadRealizada, MedicionAdjunta } from '../types';

/** Tope de polígonos por visita (evita payloads gigantes). */
export const MAX_POLIGONOS_VISITA = 10;

type Punto = { latitud: number; longitud: number };

const puntosLimpios = (lista: unknown): Punto[] =>
  (Array.isArray(lista) ? lista : [])
    .map((p: any) => ({ latitud: Number(p?.latitud), longitud: Number(p?.longitud) }))
    .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud));

const esMedicion = (m: unknown): m is MedicionAdjunta =>
  !!m && typeof m === 'object' && Array.isArray((m as MedicionAdjunta).puntos);

/** Normaliza una lista: solo mediciones con puntos válidos y sin ids repetidos. */
export const normalizarMediciones = (lista: unknown[]): MedicionAdjunta[] => {
  const vistos = new Set<string>();
  const out: MedicionAdjunta[] = [];
  for (const m of lista) {
    if (!esMedicion(m)) continue;
    const puntos = puntosLimpios(m.puntos);
    if (puntos.length === 0) continue;
    const id = String(m.id ?? '');
    if (id && vistos.has(id)) continue;
    if (id) vistos.add(id);
    out.push({ ...m, puntos });
  }
  return out;
};

/** Lista de polígonos de un objeto que tenga los campos (actividad o visita_datos). */
export const medicionesDeObjeto = (obj: Record<string, unknown> | null | undefined): MedicionAdjunta[] => {
  if (!obj || typeof obj !== 'object') return [];
  const lista = obj.mediciones_historial;
  if (Array.isArray(lista) && lista.length > 0) return normalizarMediciones(lista);
  return normalizarMediciones([obj.medicion_historial, obj.medicion_historial_2]);
};

/**
 * Polígonos de una visita. Si la copia de la actividad llegó "adelgazada"
 * (sin los campos legibles), se recurre al estado completo `visita_datos`.
 */
export const medicionesDeVisita = (actividad?: ActividadRealizada | null): MedicionAdjunta[] => {
  if (!actividad) return [];
  const directas = medicionesDeObjeto(actividad as unknown as Record<string, unknown>);
  if (directas.length > 0) return directas;
  return medicionesDeObjeto(actividad.visita_datos as Record<string, unknown> | undefined);
};

/** Suma de hectáreas, redondeada a 2 decimales. */
export const sumaHectareas = (lista: MedicionAdjunta[]): number =>
  Math.round(lista.reduce((acc, m) => acc + (Number(m.area_hectareas) || 0), 0) * 100) / 100;

// ─── Historial filtrado por beneficiario ──────────────────────
// Mismo criterio que backend/src/lib/poligonosVisita.js.

/** Distancia máxima (m) para ofrecer una medición sin cédula como "cercana". */
export const RADIO_CERCANIA_M = 500;

const normalizarCedula = (c: unknown) => String(c ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const distanciaMetros = (a: Punto, b: Punto) => {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLon = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const puntoDentro = (p: Punto, pol: Punto[]) => {
  let dentro = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i];
    const b = pol[j];
    if ((a.latitud > p.latitud) !== (b.latitud > p.latitud) &&
        p.longitud < ((b.longitud - a.longitud) * (p.latitud - a.latitud)) / (b.latitud - a.latitud) + a.longitud) {
      dentro = !dentro;
    }
  }
  return dentro;
};

/** Distancia (m) del punto al polígono: 0 si está dentro; si no, al vértice más cercano. */
export const distanciaAPoligono = (punto: Punto, puntos: unknown): number => {
  const pts = puntosLimpios(puntos);
  if (pts.length === 0) return Infinity;
  if (pts.length >= 3 && puntoDentro(punto, pts)) return 0;
  return Math.min(...pts.map((p) => distanciaMetros(punto, p)));
};

export type MedicionFiltrada<T> = T & { delBeneficiario: boolean; cercana: boolean; distancia_m?: number };

/**
 * Historial del técnico limitado al beneficiario de la visita: mediciones con
 * su cédula o, si la medición no tiene cédula (antiguas/restauradas), las que
 * quedan a ≤ RADIO_CERCANIA_M del punto de la visita. Las demás no se ofrecen.
 */
export const filtrarParaBeneficiario = <T extends { beneficiario_cedula?: unknown; puntos?: unknown }>(
  mediciones: T[],
  { cedula, punto }: { cedula?: string | null; punto?: Punto | null }
): MedicionFiltrada<T>[] => {
  const ced = normalizarCedula(cedula);
  const out: MedicionFiltrada<T>[] = [];
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
  return out.sort(
    (a, b) => Number(b.delBeneficiario) - Number(a.delBeneficiario) || (a.distancia_m ?? 0) - (b.distancia_m ?? 0)
  );
};
