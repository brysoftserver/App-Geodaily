// ============================================================
// GEODAILY — Impresión de documentos en el navegador (solo web)
// ============================================================
// expo-print no genera un PDF real en web — su implementación ahí es
// literalmente `window.print()` sobre lo que esté abierto en ese momento
// (ver node_modules/expo-print/src/ExponentPrint.web.ts), así que ignora
// por completo el HTML institucional (membrete, fotos, firmas) y termina
// imprimiendo la pantalla de la app en vez del documento.
//
// Este módulo reemplaza ese flujo en web: abre una pestaña nueva con el
// HTML real del documento y dispara el diálogo de impresión sobre ESE
// contenido — desde ahí el usuario puede elegir "Guardar como PDF" para
// descargarlo. No cambia nada del flujo nativo (iOS/Android), que sigue
// usando expo-print normalmente.
// ============================================================

/**
 * Abre una pestaña en blanco con un aviso de carga.
 *
 * Debe llamarse de forma SÍNCRONA, como primera línea del manejador del
 * clic (antes de cualquier `await`): los navegadores solo permiten
 * `window.open()` como respuesta directa a un gesto del usuario — si se
 * llama después de esperar una promesa, la bloquean como pop-up.
 */
export const abrirVentanaDeCarga = (): Window | null => {
  const ventana = window.open('', '_blank');
  if (ventana) {
    ventana.document.write(
      '<p style="font-family: sans-serif; padding: 24px; color: #555;">Generando documento…</p>'
    );
    ventana.document.title = 'GEODAILY';
  }
  return ventana;
};

/**
 * Escribe el HTML del documento en una ventana ya abierta (ver
 * `abrirVentanaDeCarga`) y dispara la impresión una vez que las fotos y
 * firmas embebidas terminaron de cargar — imprimir antes de tiempo deja
 * el documento sin evidencias.
 */
export const imprimirHtmlEnVentana = (ventana: Window | null, html: string): void => {
  if (!ventana || ventana.closed) {
    throw new Error('No se pudo abrir la ventana de impresión (¿bloqueador de pop-ups?)');
  }

  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();

  const imprimir = () => {
    try {
      ventana.focus();
      ventana.print();
    } catch (e) {
      console.warn('[PrintWeb] No se pudo abrir el diálogo de impresión:', e);
    }
  };

  const imagenes = Array.from(ventana.document.images);
  if (imagenes.length === 0) {
    setTimeout(imprimir, 300);
    return;
  }
  let pendientes = imagenes.length;
  const marcarLista = () => {
    pendientes -= 1;
    if (pendientes <= 0) setTimeout(imprimir, 150);
  };
  imagenes.forEach((img) => {
    if (img.complete) marcarLista();
    else {
      img.addEventListener('load', marcarLista);
      img.addEventListener('error', marcarLista);
    }
  });
};
