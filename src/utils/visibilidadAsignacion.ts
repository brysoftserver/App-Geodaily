// ============================================================
// GEODAILY — Visibilidad por asignación vigente (solo rol técnico)
//
// REGLA
// Un técnico solo ve los beneficiarios que tiene asignados HOY, junto con
// sus formularios y borradores. Si al beneficiario se le quita el técnico
// (queda sin asignar) o se le pasa a otro, al técnico anterior se le OCULTA:
// no se borra nada, ni en el teléfono ni en el servidor. Los formularios
// pendientes de subir se siguen sincronizando en segundo plano.
//
// Se oculta SOLO lo que se puede decidir sin ambigüedad: la cédula existe en
// el padrón y ninguna de sus filas está asignada a este técnico. Lo demás se
// sigue mostrando como antes:
//   - visitas sin cédula, o de cédulas que no están en el padrón (un
//     beneficiario que salió de la base no debe "desaparecer" de su historial);
//   - padrón local vacío (el teléfono aún no lo ha descargado): ocultar con
//     base en nada dejaría al técnico sin sus visitas.
// ============================================================

import { normalizarCedula } from './llaveVisita';

type FilaPadron = { cedula?: string | null; tecnico_asignado_id?: string | null };

export type FiltroAsignacion = (cedula?: string | null) => boolean;

/** Filtro que deja pasar todo (roles distintos a técnico, o sin datos). */
export const SIN_FILTRO: FiltroAsignacion = () => true;

/**
 * Construye el filtro "¿este técnico puede ver a este beneficiario?" a partir
 * del padrón. Lógica pura: se prueba sin base de datos.
 */
export const crearFiltroAsignacion = (
  padron: FilaPadron[] | null | undefined,
  usuarioId: string | null | undefined
): FiltroAsignacion => {
  if (!usuarioId || !padron || padron.length === 0) return SIN_FILTRO;

  // cédula normalizada → ¿alguna de sus filas está asignada a este técnico?
  const asignadaAMi = new Map<string, boolean>();
  for (const fila of padron) {
    const ced = normalizarCedula(fila?.cedula);
    if (!ced) continue;
    const mia = fila.tecnico_asignado_id === usuarioId;
    asignadaAMi.set(ced, (asignadaAMi.get(ced) || false) || mia);
  }

  return (cedula) => {
    const ced = normalizarCedula(cedula);
    if (!ced) return true;
    const mia = asignadaAMi.get(ced);
    return mia === undefined ? true : mia;
  };
};

/**
 * Filtro para el usuario de la sesión, leyendo el padrón local (espejo
 * SQLite). Solo aplica al rol técnico: coordinación, interventoría y admin
 * siguen viendo todo.
 */
export const cargarFiltroAsignacion = async (
  user: { id?: string | null; rol?: string | null } | null | undefined
): Promise<FiltroAsignacion> => {
  if (!user?.id || user.rol !== 'tecnico') return SIN_FILTRO;
  try {
    // Import diferido: el servicio arrastra expo-sqlite y este módulo se
    // prueba en Jest sin él.
    const { getBeneficiarios } = await import('../services/beneficiariosDB.service');
    const padron = await getBeneficiarios();
    return crearFiltroAsignacion(padron, user.id);
  } catch (error) {
    console.warn('[Asignacion] No se pudo leer el padrón local; se muestra todo:', error);
    return SIN_FILTRO;
  }
};
