// ============================================================
// GEODAILY — Descarga de archivos en el navegador (solo web)
// ============================================================

/**
 * Dispara la descarga de un Blob en el navegador simulando el clic en un
 * <a download>. No aplica en nativo — ahí se usa expo-sharing/expo-file-system.
 */
export const descargarBlobEnNavegador = (blob: Blob, nombreArchivo: string): void => {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  // Se libera con un pequeño retraso — revocar de inmediato puede cancelar
  // la descarga en algunos navegadores si aún no la iniciaron del todo.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
