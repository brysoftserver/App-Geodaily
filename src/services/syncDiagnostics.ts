// ============================================================
// GEODAILY — Diagnóstico de fallos de sincronización
// ============================================================
// Los servicios de subida (fotos, videos, firmas, documentos) devolvían
// `null` ante CUALQUIER error y solo lo escribían en la consola del
// dispositivo. La consecuencia: el usuario veía el mensaje genérico
// "N elemento(s) no se sincronizaron" sin saber por qué, y el soporte no
// podía diagnosticarlo desde el teléfono (el log del servidor no registra
// nada si la petición ni siquiera llegó a completarse).
//
// Este módulo es un registro EN MEMORIA (no persiste nada, no toca SQLite,
// no cambia ninguna firma de función). Los servicios anotan aquí el motivo
// real del fallo y el sincronizador lo incluye en el mensaje de la UI.

export interface SyncFailure {
  /** Qué se estaba subiendo: 'foto' | 'video' | 'firma' | 'documento' */
  tipo: string;
  /** Mensaje entendible para el usuario final */
  mensaje: string;
  /** Código HTTP cuando el servidor respondió */
  status?: number;
  /** Código de axios/red (ECONNABORTED, ERR_NETWORK, ...) */
  codigo?: string;
  at: string;
}

/** Se conservan los últimos fallos para no crecer sin límite en memoria */
const MAX_REGISTROS = 20;

let registros: SyncFailure[] = [];

/**
 * Traduce el error de axios a un mensaje corto y accionable.
 * No lanza nunca: siempre devuelve algo mostrable.
 */
export const describirErrorDeSubida = (
  error: unknown,
): { mensaje: string; status?: number; codigo?: string } => {
  const err = error as {
    response?: { status?: number; data?: { mensaje?: string; error?: string } };
    code?: string;
    message?: string;
  };

  const status = err?.response?.status;
  const codigo = err?.code;

  if (codigo === 'ECONNABORTED') {
    return { mensaje: 'el servidor tardó demasiado en responder (timeout)', status, codigo };
  }
  if (codigo === 'ERR_NETWORK') {
    return { mensaje: 'sin conexión con el servidor', status, codigo };
  }
  if (status === 401) {
    return { mensaje: 'la sesión expiró, hay que volver a iniciar sesión', status, codigo };
  }
  if (status === 403) {
    return { mensaje: 'el usuario no tiene permiso para subir esta evidencia', status, codigo };
  }
  if (status === 413) {
    return { mensaje: 'el archivo es demasiado grande para el servidor (413)', status, codigo };
  }
  if (status === 415) {
    return { mensaje: 'el servidor no aceptó el formato del archivo (415)', status, codigo };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { mensaje: `el servidor falló (HTTP ${status})`, status, codigo };
  }
  if (status) {
    const delServidor = err?.response?.data?.mensaje || err?.response?.data?.error;
    return { mensaje: delServidor || `el servidor respondió HTTP ${status}`, status, codigo };
  }
  return {
    mensaje: err?.message || 'error desconocido al subir el archivo',
    status,
    codigo,
  };
};

/** Anota un fallo de subida. Devuelve el registro creado. */
export const recordSyncFailure = (tipo: string, error: unknown): SyncFailure => {
  const { mensaje, status, codigo } = describirErrorDeSubida(error);
  const fallo: SyncFailure = {
    tipo,
    mensaje,
    status,
    codigo,
    at: new Date().toISOString(),
  };
  registros = [...registros, fallo].slice(-MAX_REGISTROS);
  console.warn(`[SyncDiag] Fallo subiendo ${tipo}: ${mensaje}`);
  return fallo;
};

/** Vaciar el registro al empezar un ciclo de sincronización */
export const clearSyncFailures = (): void => {
  registros = [];
};

export const getSyncFailures = (): SyncFailure[] => [...registros];

export const getLastSyncFailure = (): SyncFailure | null =>
  registros.length ? registros[registros.length - 1] : null;

/** Texto corto para la UI: "foto: el archivo es demasiado grande (413)" */
export const resumirUltimoFallo = (): string | null => {
  const ultimo = getLastSyncFailure();
  return ultimo ? `${ultimo.tipo}: ${ultimo.mensaje}` : null;
};
