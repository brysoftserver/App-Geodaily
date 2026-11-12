// ============================================================
// GEODAILY — Estado de la conexión con el servidor
// ============================================================
// Registro global y liviano de si el servidor está respondiendo. Lo alimenta
// el cliente Axios (api.ts): cualquier respuesta HTTP, aunque sea un error
// 4xx/5xx, significa que el servidor SÍ se alcanzó; solo un fallo de red o
// un timeout cuenta como "sin conexión".
//
// Sirve para avisar en pantalla "mostrando datos guardados" cuando la app
// no pudo consultar el servidor (antes caía a la copia local sin decir nada)
// y para mostrar a qué hora fue la última actualización.
//
// No guarda nada en disco ni toca datos: es solo un estado en memoria.
// ============================================================

export interface EstadoServidor {
  /** false si la última petición falló por red/timeout. */
  alcanzable: boolean;
  /** Última vez (ms) que el servidor respondió. */
  ultimaRespuesta: number | null;
}

let estado: EstadoServidor = { alcanzable: true, ultimaRespuesta: null };
const oyentes = new Set<() => void>();

const publicar = (nuevo: EstadoServidor) => {
  if (nuevo.alcanzable === estado.alcanzable && nuevo.ultimaRespuesta === estado.ultimaRespuesta) return;
  estado = nuevo;
  oyentes.forEach((fn) => {
    try {
      fn();
    } catch {
      // un oyente con error no debe afectar a los demás
    }
  });
};

/** El servidor respondió (con cualquier código HTTP). */
export const reportarRespuestaServidor = (): void => {
  // Se redondea al segundo para no re-renderizar en cada petición.
  const ahora = Math.floor(Date.now() / 1000) * 1000;
  publicar({ alcanzable: true, ultimaRespuesta: ahora });
};

/** Una petición no llegó al servidor (sin red o timeout). */
export const reportarFalloServidor = (): void => {
  publicar({ ...estado, alcanzable: false });
};

export const obtenerEstadoServidor = (): EstadoServidor => estado;

export const suscribirEstadoServidor = (fn: () => void): (() => void) => {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
};
