// ============================================================
// GEODAILY — Recarga automática segura de pantallas de consulta
// ============================================================
// Problema que resuelve: las pantallas pedían los datos al servidor solo al
// abrirse. Si el supervisor dejaba la pantalla abierta, mandaba la app al
// fondo o cambiaba de pestaña en el navegador, no veía lo que los técnicos
// iban subiendo hasta cerrar la app o pulsar F5.
//
// Este hook vuelve a llamar la función de carga QUE LA PANTALLA YA TIENE
// (no hace peticiones propias ni toca la base local) en estos momentos:
//   • al volver la app del segundo plano / la pestaña del navegador;
//   • al recuperar la conexión;
//   • cada cierto tiempo mientras la pantalla está visible.
// La carga al ENTRAR a la pantalla sigue siendo responsabilidad de la
// pantalla (useFocusEffect), porque esa sí debe correr sin red para mostrar
// la copia local; este hook se salta las recargas cuando no hay conexión.
//
// Reglas para el trabajo en campo (sin internet):
//   • Sin conexión NO se intenta: no gasta batería ni espera timeouts. Lo
//     que la pantalla ya muestra (copia local) se queda tal cual.
//   • Solo corre con la pantalla enfocada y la app en primer plano.
//   • Nunca dos cargas a la vez, y un mínimo de tiempo entre cargas.
//   • `pausado` permite detenerla mientras el usuario edita algo.
//   • Úsese SOLO en pantallas de consulta, nunca en formularios donde se
//     escribe: la recarga reemplaza lo que muestra la pantalla.
// ============================================================

import { useCallback, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';

/**
 * Intervalo por defecto. En el celular más espaciado para no gastar datos
 * móviles; en el navegador (oficina) más frecuente.
 */
export const INTERVALO_AUTO_REFRESH_MS = Platform.OS === 'web' ? 60_000 : 120_000;

/** Tiempo mínimo entre dos cargas automáticas (evita ráfagas). */
const MIN_ENTRE_CARGAS_MS = 15_000;

/** Tiempo máximo esperando a NetInfo antes de asumir que hay red. */
const TIMEOUT_NETINFO_MS = 2_500;

export interface OpcionesAutoRefresh {
  /** Recarga periódica mientras la pantalla está visible. `null` = desactivada. */
  intervaloMs?: number | null;
  /** Detiene la recarga automática (p. ej. mientras se edita un campo). */
  pausado?: boolean;
}

/**
 * true solo si se sabe con certeza que no hay conexión.
 *
 * En el navegador se usa `navigator.onLine`: NetInfo en Chromium solo
 * escucha `connection.change` y, si la red vuelve sin ese evento, deja
 * `isInternetReachable` en false para siempre (probado: la recarga quedaba
 * apagada tras un corte). En el celular NetInfo usa el sistema operativo y
 * sí es confiable.
 */
export const sinConexionConfirmada = async (): Promise<boolean> => {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }
  try {
    const estado = await Promise.race([
      NetInfo.fetch(),
      new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_NETINFO_MS)),
    ]);
    if (!estado) return false;
    return estado.isConnected === false || estado.isInternetReachable === false;
  } catch {
    return false;
  }
};

const appEnPrimerPlano = (): boolean => {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return document.visibilityState !== 'hidden';
  }
  return AppState.currentState === 'active' || AppState.currentState == null;
};

export function useAutoRefresh(
  recargar: () => unknown | Promise<unknown>,
  opciones: OpcionesAutoRefresh = {}
): void {
  const { intervaloMs = INTERVALO_AUTO_REFRESH_MS, pausado = false } = opciones;

  // Refs: la función y la pausa más recientes sin re-suscribir los eventos.
  const recargarRef = useRef(recargar);
  recargarRef.current = recargar;
  const pausadoRef = useRef(pausado);
  pausadoRef.current = pausado;

  const enFocoRef = useRef(false);
  const enCursoRef = useRef(false);
  const ultimaRef = useRef(0);

  const ejecutar = useCallback(async (forzar: boolean) => {
    if (!enFocoRef.current || pausadoRef.current || enCursoRef.current) return;
    if (!appEnPrimerPlano()) return;
    if (!forzar && Date.now() - ultimaRef.current < MIN_ENTRE_CARGAS_MS) return;
    enCursoRef.current = true;
    try {
      if (await sinConexionConfirmada()) return;
      if (!enFocoRef.current || pausadoRef.current) return;
      ultimaRef.current = Date.now();
      await recargarRef.current();
    } catch (e) {
      console.warn('[AutoRefresh] La recarga automática falló (se reintenta luego):', e);
    } finally {
      enCursoRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      enFocoRef.current = true;
      // La pantalla acaba de cargar por su cuenta al enfocarse.
      ultimaRef.current = Date.now();

      const intervalo = intervaloMs ? setInterval(() => void ejecutar(false), intervaloMs) : null;

      // App que vuelve del segundo plano (en web, react-native-web lo emite
      // al volver a la pestaña).
      const subApp = AppState.addEventListener('change', (e) => {
        if (e === 'active') void ejecutar(false);
      });

      // Conexión recuperada: recargar de inmediato. En el navegador se usa
      // el evento `online` (ver sinConexionConfirmada).
      let conectadoAntes: boolean | null = null;
      const quitarNet =
        Platform.OS === 'web'
          ? () => {}
          : NetInfo.addEventListener((s) => {
              const conectado = s.isConnected !== false && s.isInternetReachable !== false;
              if (conectadoAntes === false && conectado) void ejecutar(true);
              conectadoAntes = conectado;
            });

      // Navegador: volver a la ventana sin que la pestaña se haya ocultado.
      let quitarWeb = () => {};
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
        const alVolver = () => {
          if (document.visibilityState !== 'hidden') void ejecutar(false);
        };
        const alReconectar = () => void ejecutar(true);
        window.addEventListener('focus', alVolver);
        document.addEventListener('visibilitychange', alVolver);
        window.addEventListener('online', alReconectar);
        quitarWeb = () => {
          window.removeEventListener('focus', alVolver);
          document.removeEventListener('visibilitychange', alVolver);
          window.removeEventListener('online', alReconectar);
        };
      }

      return () => {
        enFocoRef.current = false;
        if (intervalo) clearInterval(intervalo);
        subApp.remove();
        quitarNet();
        quitarWeb();
      };
    }, [intervaloMs, ejecutar])
  );
}
