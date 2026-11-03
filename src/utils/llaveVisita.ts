// ============================================================
// GEODAILY — Llave de visita: UNA visita por beneficiario y formulario
// ============================================================
// Regla de dominio: cada beneficiario tiene como máximo UNA visita de cada
// formulario (1 = caracterización, 2, 3, …). Para que el técnico no acumule
// borradores del mismo beneficiario y el mismo formulario, cada borrador
// lleva una LLAVE inmutable:
//
//     {id del técnico}|{cédula normalizada del beneficiario}|v{número}
//
// ⚠️ SEGURIDAD (el error que ya costó caro):
//   Una versión anterior de "reanudar" cargaba el formulario de un
//   beneficiario dentro del de otro. Por eso:
//   - La cédula de la llave sale SIEMPRE del beneficiario elegido en la
//     navegación (o del borrador que se retoma por su id), NUNCA del
//     contexto global ni de un campo editable del formulario.
//   - Un borrador solo se reanuda si su llave es EXACTAMENTE igual a la de
//     la entrada actual (igualdad de texto, sin "parecidos").
//   - La cédula es la única identidad: el número de ítem NO se usa porque
//     puede cambiar en la base de datos.
//   - Sin cédula no hay llave y no se abre el formulario.
// ============================================================

import type { FormDraft } from '../store/FormDraftStore';
import type { Formulario } from '../types';

/** Cédula comparable: solo letras y dígitos, en mayúsculas ("1.234 567" → "1234567"). */
export const normalizarCedula = (cedula?: string | null): string =>
  String(cedula ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();

/**
 * Número de visita de un formulario:
 *   - caracterización → 1 (siempre)
 *   - visita técnica  → `actividad.visita_numero`
 *   - cualquier otro caso → undefined
 */
export const numeroVisitaDe = (
  tipo?: string | null,
  visitaNumero?: number | string | null
): number | undefined => {
  if (tipo === 'caracterizacion') return 1;
  if (tipo === 'visita_tecnica') {
    const n = Number(visitaNumero);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
  }
  return undefined;
};

/** Llave de una visita, o `null` si falta técnico, cédula o número válido. */
export const construirLlave = (
  tecnicoId?: string | null,
  cedula?: string | null,
  numeroVisita?: number | null
): string | null => {
  const tecnico = String(tecnicoId ?? '').trim();
  const ced = normalizarCedula(cedula);
  if (!tecnico || !ced) return null;
  if (!Number.isInteger(numeroVisita) || (numeroVisita as number) < 1) return null;
  return `${tecnico}|${ced}|v${numeroVisita}`;
};

/** ¿La llave pertenece a esa cédula? (compara el segmento de cédula, normalizado). */
export const llaveCorrespondeACedula = (llave?: string | null, cedula?: string | null): boolean => {
  const ced = normalizarCedula(cedula);
  if (!llave || !ced) return false;
  return llave.split('|')[1] === ced;
};

/**
 * Visita YA COMPLETADA de ese beneficiario y número. No filtra por técnico:
 * si el beneficiario cambió de técnico, la visita sigue siendo una sola.
 * Si hubiera varias (datos antiguos), devuelve la más reciente.
 */
export const buscarVisitaCompletada = (
  formularios: Formulario[],
  cedula?: string | null,
  numeroVisita?: number | null
): Formulario | undefined => {
  const ced = normalizarCedula(cedula);
  if (!ced || !numeroVisita) return undefined;
  return formularios
    .filter(
      (f) =>
        normalizarCedula(f.beneficiario?.cedula) === ced &&
        numeroVisitaDe(f.tipo, f.actividad?.visita_numero) === numeroVisita
    )
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
};

/**
 * Borrador con EXACTAMENTE esa llave (el más reciente si hay varios). Los
 * borradores antiguos no tienen llave y nunca coinciden: se quedan como están
 * en "Formularios Incompletos".
 */
export const buscarBorradorPorLlave = (
  borradores: FormDraft[],
  llave: string
): FormDraft | undefined => {
  if (!llave) return undefined;
  return borradores
    .filter((d) => typeof d.llave === 'string' && d.llave === llave)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
};

export type DecisionEntrada =
  /** Falta técnico, cédula o número: no se puede abrir el formulario. */
  | { estado: 'sin_datos' }
  /** Ya existe la visita completada: no se abre uno nuevo. */
  | { estado: 'bloqueada'; llave: string; formulario: Formulario }
  /** Se puede abrir; si hay borrador de esta misma llave, se reanuda. */
  | { estado: 'ok'; llave: string; borrador?: FormDraft };

/**
 * Decide qué hacer al entrar a un formulario desde un beneficiario. Es una
 * función PURA (recibe los datos ya leídos) para poder probarla a fondo.
 */
export const decidirEntrada = (params: {
  usuarioId?: string | null;
  cedula?: string | null;
  numeroVisita: number;
  formularios: Formulario[];
  borradores: FormDraft[];
}): DecisionEntrada => {
  const llave = construirLlave(params.usuarioId, params.cedula, params.numeroVisita);
  if (!llave) return { estado: 'sin_datos' };

  const completada = buscarVisitaCompletada(params.formularios, params.cedula, params.numeroVisita);
  if (completada) return { estado: 'bloqueada', llave, formulario: completada };

  const borrador = buscarBorradorPorLlave(params.borradores, llave);
  return { estado: 'ok', llave, borrador };
};
