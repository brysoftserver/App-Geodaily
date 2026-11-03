// ============================================================
// GEODAILY — Puerta de entrada a los formularios de visita
// ============================================================
// Antes de abrir el formulario 1, 2, 3… de un beneficiario se decide, con la
// llave de visita (utils/llaveVisita.ts):
//   - si YA existe la visita completada → se bloquea y se muestra el aviso;
//     al aceptar se abre el detalle de la visita existente.
//   - si hay un borrador con la MISMA llave → se reanuda ese (no se crea otro).
//   - si no hay nada → formulario nuevo.
// La lógica de decisión es pura y está probada (decidirEntrada); aquí solo se
// leen los datos locales y se muestran los avisos.
// ============================================================

import { Alert } from 'react-native';
import { cargarBorradores } from '../store/FormDraftStore';
import type { Formulario } from '../types';
import { buscarVisitaCompletada, decidirEntrada, DecisionEntrada } from '../utils/llaveVisita';
import { getFormulariosLocales } from './database';

type Navegacion = {
  replace: (nombre: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

/** Lee formularios y borradores locales y decide cómo entrar. */
export const resolverEntradaVisita = async (params: {
  usuarioId?: string | null;
  cedula?: string | null;
  numeroVisita: number;
}): Promise<DecisionEntrada> => {
  const [formularios, borradores] = await Promise.all([
    getFormulariosLocales().catch(() => [] as Formulario[]),
    cargarBorradores().catch(() => []),
  ]);
  return decidirEntrada({ ...params, formularios, borradores });
};

/**
 * Para borradores que se retoman por su id (desde "Formularios Incompletos"):
 * si la visita ya se completó, devuelve el formulario existente.
 */
export const buscarVisitaYaCompletada = async (
  cedula?: string | null,
  numeroVisita?: number | null
): Promise<Formulario | undefined> => {
  const formularios = await getFormulariosLocales().catch(() => [] as Formulario[]);
  return buscarVisitaCompletada(formularios, cedula, numeroVisita);
};

/** Aviso de bloqueo: al aceptar se abre el detalle de la visita ya registrada. */
export const avisarVisitaYaRegistrada = (
  navigation: Navegacion,
  formulario: Formulario,
  titulo: string
): void => {
  const fecha = formulario.created_at
    ? new Date(formulario.created_at).toLocaleDateString('es-CO')
    : 'una fecha anterior';
  Alert.alert(
    'Visita ya registrada',
    `${titulo} de ${formulario.beneficiario?.nombre || 'este beneficiario'}` +
      `${formulario.beneficiario?.cedula ? ` (C.C. ${formulario.beneficiario.cedula})` : ''}` +
      ` ya fue diligenciada el ${fecha}.\n\n` +
      'Solo se permite una visita de cada formulario por beneficiario. ' +
      'Pulsa Aceptar para ver la visita registrada.',
    // `replace`: al volver atrás no se regresa al formulario bloqueado.
    [{ text: 'Aceptar', onPress: () => navigation.replace('FormularioDetail', { formulario }) }],
    { cancelable: false }
  );
};

/** Aviso cuando no se puede identificar al beneficiario por su cédula. */
export const avisarSinCedula = (navigation: Navegacion): void => {
  Alert.alert(
    'No se puede abrir el formulario',
    'Falta la cédula del beneficiario o la sesión del técnico. ' +
      'Abre el formulario desde la ficha del beneficiario (todos deben tener cédula registrada).',
    [{ text: 'Volver', onPress: () => navigation.goBack() }],
    { cancelable: false }
  );
};
