// ============================================================
// GEODAILY — Verificador de actualizaciones OTA (EAS Update)
// ============================================================
//
// Objetivo: al abrir la app, comprobar si hay una actualización OTA
// disponible y, si la hay, descargarla mostrando PROGRESO REAL al usuario
// (no una animación falsa).
//
// Reglas de diseño:
//  - OFFLINE-FIRST: si no hay red o la comprobación falla, la app arranca
//    normal. NUNCA se bloquea el trabajo de campo por una actualización.
//  - TIMEOUT: toda la operación tiene un límite de tiempo para que en campo
//    con señal mala no se quede colgada esperando.
//  - SILENCIOSO: cualquier error se registra y se continúa con la app.
//
// Nota: en Expo Go / web / builds de desarrollo `Updates.isEnabled` es
// false, así que este módulo no hace nada en esos entornos.

import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Estados posibles del proceso de actualización. */
export type EstadoActualizacion =
  | 'inactivo' // no se está comprobando nada
  | 'comprobando' // consultando si hay update
  | 'descargando' // descargando el update
  | 'instalando' // aplicando el update (reload)
  | 'actualizado' // esta apertura ya arrancó con un update recién instalado
  | 'sin-cambios' // no había update disponible
  | 'error'; // falló algo (la app sigue normal)

/** Información de progreso que se reporta a la UI. */
export interface ProgresoActualizacion {
  estado: EstadoActualizacion;
  /** 0..1 — solo tiene sentido en 'descargando'. */
  progreso: number;
  /** Mensaje legible para mostrar al usuario. */
  mensaje: string;
}

/** Callback que recibe cada cambio de estado/progreso. */
export type OnProgreso = (info: ProgresoActualizacion) => void;

/** Tiempo máximo (ms) para comprobar si hay update. */
const TIMEOUT_COMPROBACION_MS = 8000;

/** Tiempo máximo (ms) para descargar el update completo. */
const TIMEOUT_DESCARGA_MS = 120000;

/**
 * Envuelve una promesa con un límite de tiempo.
 * Si se excede, rechaza con un error identificable.
 */
const conTimeout = <T>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let terminado = false;
    const timer = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      reject(new Error(`[Updates] Timeout en ${etiqueta} (${ms} ms)`));
    }, ms);

    promesa.then(
      (valor) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timer);
        resolve(valor);
      },
      (error) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

/**
 * Comprueba si hay una actualización disponible y la descarga.
 *
 * Devuelve `true` si se descargó una actualización y la app debe
 * recargarse (el llamador decide cuándo llamar a `aplicarActualizacion`).
 * Devuelve `false` si no había nada que descargar o si algo falló.
 *
 * @param onProgreso Callback opcional para reflejar el avance en la UI.
 */
export const buscarYDescargarActualizacion = async (
  onProgreso?: OnProgreso
): Promise<boolean> => {
  const reportar = (estado: EstadoActualizacion, progreso: number, mensaje: string) => {
    try {
      onProgreso?.({ estado, progreso, mensaje });
    } catch {
      // Un fallo en la UI nunca debe romper el flujo de actualización.
    }
  };

  // En Expo Go, web o builds de desarrollo no hay OTA que aplicar.
  if (!Updates.isEnabled) {
    reportar('sin-cambios', 0, '');
    return false;
  }

  try {
    reportar('comprobando', 0, 'Buscando actualización…');

    const resultado = await conTimeout(
      Updates.checkForUpdateAsync(),
      TIMEOUT_COMPROBACION_MS,
      'checkForUpdateAsync'
    );

    if (!resultado.isAvailable) {
      reportar('sin-cambios', 0, '');
      return false;
    }

    reportar('descargando', 0, 'Descargando actualización…');

    // `fetchUpdateAsync` acepta un callback de progreso en expo-updates.
    // Se tipa de forma laxa porque la firma varía entre versiones del SDK.
    const fetchConProgreso = Updates.fetchUpdateAsync as unknown as (
      opciones?: { eventListener?: (evento: { downloadProgress?: number }) => void }
    ) => Promise<Updates.UpdateFetchResult>;

    const descarga = conTimeout(
      fetchConProgreso({
        eventListener: (evento) => {
          const p = typeof evento?.downloadProgress === 'number' ? evento.downloadProgress : 0;
          const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
          reportar('descargando', p, `Descargando actualización… ${pct}%`);
        },
      }),
      TIMEOUT_DESCARGA_MS,
      'fetchUpdateAsync'
    );

    const resultadoDescarga = await descarga;

    if (!resultadoDescarga.isNew) {
      // Ya estaba descargada (o no cambió nada).
      reportar('sin-cambios', 0, '');
      return false;
    }

    reportar('instalando', 1, 'Instalando actualización…');
    return true;
  } catch (error) {
    // Cualquier fallo (sin red, timeout, servidor caído) → la app sigue.
    console.warn('[Updates] No se pudo actualizar, se continúa con la versión actual:', error);
    reportar('error', 0, '');
    return false;
  }
};

const CLAVE_ULTIMO_UPDATE = 'geodaily:ultimo_update_id';

/**
 * Indica si ESTA apertura de la app arrancó con una actualización OTA que
 * no se había visto antes.
 *
 * expo-updates descarga el update de forma nativa ANTES de iniciar el JS
 * (ver `fallbackToCacheTimeout`), así que cuando el JS arranca el update ya
 * está aplicado y `checkForUpdateAsync` dice "no hay nada". Comparando el
 * `updateId` actual con el último guardado detectamos ese caso para poder
 * avisarle al usuario.
 */
export const actualizacionRecienAplicada = async (): Promise<boolean> => {
  if (!Updates.isEnabled) return false;
  try {
    const actual = Updates.updateId ?? 'embedded';
    const anterior = await AsyncStorage.getItem(CLAVE_ULTIMO_UPDATE);
    if (anterior === actual) return false;
    await AsyncStorage.setItem(CLAVE_ULTIMO_UPDATE, actual);
    // Primera ejecución tras instalar el APK: no hay "anterior" que comparar.
    return anterior !== null;
  } catch {
    return false;
  }
};

/**
 * Aplica la actualización descargada recargando la app.
 * Solo debe llamarse después de que `buscarYDescargarActualizacion`
 * haya devuelto `true`.
 */
export const aplicarActualizacion = async (): Promise<void> => {
  try {
    await Updates.reloadAsync();
  } catch (error) {
    console.warn('[Updates] No se pudo recargar la app:', error);
  }
};

/**
 * Devuelve información de diagnóstico de la actualización en curso.
 * Útil para mostrar la versión en pantallas de soporte.
 */
export const infoActualizacion = () => ({
  habilitado: Updates.isEnabled,
  canal: Updates.channel ?? null,
  runtimeVersion: Updates.runtimeVersion ?? null,
  updateId: Updates.updateId ?? null,
  creadoEn: Updates.createdAt ? Updates.createdAt.toISOString() : null,
  esEmbedded: Updates.isEmbeddedLaunch ?? null,
});
