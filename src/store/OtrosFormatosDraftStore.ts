// ============================================================
// GEODAILY — Persistencia de "Otros Formatos" por beneficiario
// ============================================================
// Acta de Compromiso, Autorizaciones de Imagen, Consentimiento de Datos
// y Evaluación ECA se diligencian desde la ficha de UN beneficiario
// específico. Cada uno guarda su propio estado local, ligado a la
// cédula de ese beneficiario, para que el técnico no pierda lo escrito
// si sale de la pantalla, y para que los datos de un beneficiario nunca
// se mezclen con los de otro.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'geodaily.otros_formatos.';

export type TipoOtroFormato =
  | 'acta_compromiso'
  | 'autorizacion_imagen'
  | 'autorizacion_imagen_menor'
  | 'consentimiento_datos'
  | 'evaluacion_eca';

const claveStorage = (tipo: TipoOtroFormato, cedulaBeneficiario: string): string =>
  `${PREFIX}${tipo}.${cedulaBeneficiario}`;

/** Guardar (o sobrescribir) los datos actuales de un formato para un beneficiario. */
export const guardarDatosOtroFormato = async (
  tipo: TipoOtroFormato,
  cedulaBeneficiario: string | undefined | null,
  datos: Record<string, any>
): Promise<void> => {
  if (!cedulaBeneficiario) return;
  try {
    await AsyncStorage.setItem(
      claveStorage(tipo, cedulaBeneficiario),
      JSON.stringify({ datos, updated_at: new Date().toISOString() })
    );
  } catch (e) {
    console.warn(`[OtrosFormatos] Error al guardar "${tipo}":`, e);
  }
};

/** Cargar los datos guardados de un formato para un beneficiario (null si no hay). */
export const cargarDatosOtroFormato = async <T = Record<string, any>>(
  tipo: TipoOtroFormato,
  cedulaBeneficiario: string | undefined | null
): Promise<T | null> => {
  if (!cedulaBeneficiario) return null;
  try {
    const str = await AsyncStorage.getItem(claveStorage(tipo, cedulaBeneficiario));
    if (!str) return null;
    const parsed = JSON.parse(str);
    return (parsed?.datos ?? null) as T | null;
  } catch (e) {
    console.warn(`[OtrosFormatos] Error al cargar "${tipo}":`, e);
    return null;
  }
};

/** Borrar los datos guardados de un formato para un beneficiario. */
export const eliminarDatosOtroFormato = async (
  tipo: TipoOtroFormato,
  cedulaBeneficiario: string | undefined | null
): Promise<void> => {
  if (!cedulaBeneficiario) return;
  try {
    await AsyncStorage.removeItem(claveStorage(tipo, cedulaBeneficiario));
  } catch (e) {
    console.warn(`[OtrosFormatos] Error al eliminar "${tipo}":`, e);
  }
};
