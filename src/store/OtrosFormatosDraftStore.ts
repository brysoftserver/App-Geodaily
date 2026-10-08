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
import {
  externalizarFirma,
  hidratarFirma,
  eliminarFirmaExportada,
} from '../services/firmasStorage.service';

const PREFIX = 'geodaily.otros_formatos.';

/** Borrador de la planilla "Ingreso de Beneficiarios" — NO tiene firmas y no se toca. */
const CLAVE_INGRESO_BENEFICIARIOS = 'geodaily.otros_formatos.ingreso_beneficiarios_draft';

export type TipoOtroFormato =
  | 'acta_compromiso'
  | 'autorizacion_imagen'
  | 'autorizacion_imagen_menor'
  | 'consentimiento_datos'
  | 'evaluacion_eca';

/**
 * Campos de `datos` que pueden traer una firma en base64.
 * Las firmas NO se guardan en AsyncStorage: se escriben como archivo y aquí
 * solo queda la URI (ver `firmasStorage.service`).
 */
const CAMPOS_FIRMA = ['firma', 'firmaBeneficiario', 'firmaTecnico'] as const;

const claveStorage = (tipo: TipoOtroFormato, cedulaBeneficiario: string): string =>
  `${PREFIX}${tipo}.${cedulaBeneficiario}`;

const sanear = (valor: string): string => valor.replace(/[^A-Za-z0-9_.-]/g, '_');

/** Nombre base del archivo de una firma (sin carpeta ni extensión). */
const baseArchivoFirma = (
  tipo: TipoOtroFormato,
  cedulaBeneficiario: string,
  campo: string
): string => `${sanear(tipo)}_${sanear(cedulaBeneficiario)}_${campo}`;

/** Guardar (o sobrescribir) los datos actuales de un formato para un beneficiario. */
export const guardarDatosOtroFormato = async (
  tipo: TipoOtroFormato,
  cedulaBeneficiario: string | undefined | null,
  datos: Record<string, any>
): Promise<void> => {
  if (!cedulaBeneficiario) return;
  try {
    // Las firmas (base64 de 40–140 KB) se sacan de AsyncStorage: se escriben
    // como archivo y aquí solo queda la URI. Sin esto, cada beneficiario
    // dejaba ~100 KB permanentes y se terminaba reventando el tope de 6 MB
    // de AsyncStorage en Android (ahí empezó el "No se pudo guardar").
    const datosLigeros: Record<string, any> = { ...datos };
    for (const campo of CAMPOS_FIRMA) {
      const valor = datosLigeros[campo];
      if (typeof valor === 'string' && valor) {
        datosLigeros[campo] = await externalizarFirma(
          valor,
          baseArchivoFirma(tipo, cedulaBeneficiario, campo)
        );
      }
    }

    await AsyncStorage.setItem(
      claveStorage(tipo, cedulaBeneficiario),
      JSON.stringify({ datos: datosLigeros, updated_at: new Date().toISOString() })
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
    const datos = parsed?.datos ?? null;
    if (!datos || typeof datos !== 'object') return null;

    // Las firmas guardadas como archivo se devuelven como data URI, para que
    // las pantallas y el generador de PDF sigan recibiendo exactamente lo
    // mismo que antes (el base64).
    const hidratado: Record<string, any> = { ...datos };
    for (const campo of CAMPOS_FIRMA) {
      const valor = hidratado[campo];
      if (typeof valor === 'string' && valor && !valor.startsWith('data:image')) {
        hidratado[campo] = await hidratarFirma(valor);
      }
    }
    return hidratado as T;
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
    for (const campo of CAMPOS_FIRMA) {
      await eliminarFirmaExportada(baseArchivoFirma(tipo, cedulaBeneficiario, campo));
    }
  } catch (e) {
    console.warn(`[OtrosFormatos] Error al eliminar "${tipo}":`, e);
  }
};

/**
 * Compacta los datos ya guardados de "Otros Formatos".
 *
 * Antes de este cambio cada formato guardaba su firma en base64 dentro de
 * AsyncStorage. Con decenas de beneficiarios eso superaba el tope de 6 MB de
 * Android y las escrituras empezaban a fallar (el técnico veía sus
 * borradores, pero no podía guardar). Esta función recorre las claves ya
 * existentes, escribe las firmas como archivo y reescribe la clave con solo
 * la URI — SIN perder nada de lo que el técnico ya había escrito.
 *
 * Corre al iniciar la app y como auto-reparación cuando un guardado falla.
 *
 * @returns cuántas claves logró compactar
 */
export const compactarDatosOtrosFormatos = async (): Promise<number> => {
  let compactadas = 0;
  try {
    const claves = (await AsyncStorage.getAllKeys()).filter(
      (clave) => clave.startsWith(PREFIX) && clave !== CLAVE_INGRESO_BENEFICIARIOS
    );
    if (claves.length === 0) return 0;

    const pares = await AsyncStorage.multiGet(claves);
    const candidatas: Array<[string, string]> = [];
    for (const [clave, valor] of pares) {
      if (!valor) continue;
      // Filtro barato antes de parsear: ¿tiene una firma inline en base64?
      if (!/"(firma|firmaBeneficiario|firmaTecnico)"\s*:\s*"data:image/i.test(valor)) continue;
      candidatas.push([clave, valor]);
    }
    // Las más pesadas primero: así se libera espacio cuanto antes.
    candidatas.sort((a, b) => b[1].length - a[1].length);

    for (const [clave, valor] of candidatas) {
      try {
        const parsed = JSON.parse(valor);
        const datos = parsed?.datos;
        if (!datos || typeof datos !== 'object') continue;

        const cedula = clave.slice(clave.lastIndexOf('.') + 1);
        const tipo = clave.slice(PREFIX.length, clave.lastIndexOf('.')) as TipoOtroFormato;

        const ligero: Record<string, any> = { ...datos };
        let algunaExternalizada = false;
        for (const campo of CAMPOS_FIRMA) {
          const firma = ligero[campo];
          if (typeof firma === 'string' && firma) {
            const resultado = await externalizarFirma(firma, baseArchivoFirma(tipo, cedula, campo));
            ligero[campo] = resultado;
            if (resultado !== firma) algunaExternalizada = true;
          }
        }
        // Si no se pudo externalizar ni una firma, se deja la clave intacta.
        if (!algunaExternalizada) continue;

        const nuevo = JSON.stringify({ datos: ligero, updated_at: parsed?.updated_at });
        if (nuevo.length >= valor.length) continue;

        try {
          await AsyncStorage.setItem(clave, nuevo);
        } catch {
          // Con la base llena el reemplazo puede fallar: se libera la clave
          // vieja (ya hay copia en memoria) y se reintenta con la compacta.
          await AsyncStorage.removeItem(clave);
          await AsyncStorage.setItem(clave, nuevo);
        }
        compactadas += 1;
      } catch (e) {
        console.warn('[OtrosFormatos] No se pudo compactar una clave:', e);
      }
    }

    if (compactadas > 0) {
      console.log(
        `[OtrosFormatos] ${compactadas} formato(s) compactado(s): firmas movidas a archivo`
      );
    }
  } catch (e) {
    console.warn('[OtrosFormatos] Error al compactar datos guardados:', e);
  }
  return compactadas;
};
