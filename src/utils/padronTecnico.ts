// ============================================================
// GEODAILY — Padrón de un técnico y visitas heredadas (reasignación
// «solo pendientes»)
// ============================================================
// Cuando un técnico se retira (Miller) y sus beneficiarios pasan a otro
// (Suárez) conservando la autoría, el listado de técnicos debe mostrar:
//   - al técnico NUEVO, aunque todavía no tenga visitas propias, con el
//     avance real de sus beneficiarios (incluye lo que hizo el anterior);
//   - al técnico ANTERIOR como histórico, medido sobre los beneficiarios que
//     atendió (no sobre los que tiene hoy, que son 0).
// Lógica pura: se prueba sin pantalla (ver __tests__/padronTecnico.test.ts).
// ============================================================

import type { BeneficiarioDB, Formulario } from '../types';
import { normalizarCedula } from './llaveVisita';

/**
 * Beneficiarios contra los que se mide a un técnico: los que tiene asignados
 * hoy más los que tuvo y se trasladaron en modo «solo pendientes»
 * (tecnico_anterior_id). Sin repetir.
 */
export const padronDelTecnico = (
  padron: BeneficiarioDB[],
  usuarioId?: string | null
): BeneficiarioDB[] => {
  if (!usuarioId) return [];
  const vistos = new Set<number>();
  const resultado: BeneficiarioDB[] = [];
  for (const b of padron) {
    const esActual = b.tecnico_asignado_id === usuarioId;
    const esAnterior = b.tecnico_anterior_id === usuarioId && b.tecnico_asignado_id !== usuarioId;
    if ((esActual || esAnterior) && !vistos.has(b.item)) {
      vistos.add(b.item);
      resultado.push(b);
    }
  }
  return resultado;
};

/** Técnico al que se trasladaron los beneficiarios de `usuarioId`, si ya no tiene ninguno asignado. */
export const trasladadoA = (padron: BeneficiarioDB[], usuarioId?: string | null): string | null => {
  if (!usuarioId) return null;
  if (padron.some((b) => b.tecnico_asignado_id === usuarioId)) return null;
  const destinos = new Set(
    padron
      .filter((b) => b.tecnico_anterior_id === usuarioId && b.tecnico_asignado_id && b.tecnico_asignado_nombre)
      .map((b) => b.tecnico_asignado_nombre as string)
  );
  return destinos.size ? Array.from(destinos).join(', ') : null;
};

export interface VisitaHeredada {
  /** usuario_id del técnico que tiene HOY el beneficiario. */
  tecnicoActualId: string;
  tecnicoActualNombre: string;
  beneficiario: BeneficiarioDB;
  formulario: Formulario;
}

/**
 * Visitas que hizo el técnico ANTERIOR a beneficiarios que hoy tiene otro
 * técnico (reasignación «solo pendientes»). Siguen a nombre del anterior;
 * el listado las muestra también bajo el técnico actual, marcadas.
 */
export const visitasHeredadas = (
  padron: BeneficiarioDB[],
  formularios: Formulario[]
): VisitaHeredada[] => {
  const porCedula = new Map<string, Formulario[]>();
  for (const f of formularios) {
    const ced = normalizarCedula(f?.beneficiario?.cedula);
    if (!ced) continue;
    const lista = porCedula.get(ced);
    if (lista) lista.push(f);
    else porCedula.set(ced, [f]);
  }

  const resultado: VisitaHeredada[] = [];
  const yaIncluidas = new Set<string>();
  for (const b of padron) {
    const anterior = b.tecnico_anterior_id;
    const actual = b.tecnico_asignado_id;
    if (!anterior || !actual || anterior === actual) continue;
    for (const f of porCedula.get(normalizarCedula(b.cedula)) || []) {
      const autor = f.tecnico?.usuario_id || (f as any).usuario_id;
      if (autor !== anterior || yaIncluidas.has(f.id)) continue;
      yaIncluidas.add(f.id);
      resultado.push({
        tecnicoActualId: actual,
        tecnicoActualNombre: b.tecnico_asignado_nombre || 'Técnico',
        beneficiario: b,
        formulario: f,
      });
    }
  }
  return resultado;
};
