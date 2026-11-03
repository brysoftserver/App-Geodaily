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

// ─── Descarga directa como PDF (solo web) ────────────────────

const URL_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const URL_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const cargasScript = new Map<string, Promise<void>>();

/** Carga un script externo una sola vez (solo en el navegador y solo cuando se necesita). */
const cargarScript = (url: string, global: string): Promise<void> => {
  if ((window as any)[global]) return Promise.resolve();
  let carga = cargasScript.get(url);
  if (!carga) {
    carga = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        cargasScript.delete(url); // permite reintentar
        reject(new Error('No se pudo cargar el generador de PDF'));
      };
      document.head.appendChild(script);
    });
    cargasScript.set(url, carga);
  }
  return carga;
};

// Hoja carta en puntos y márgenes del membrete (@page: 1.3cm 2.5cm 1.0cm 2.5cm).
const PAG_ANCHO_PT = 612;
const PAG_ALTO_PT = 792;
const MARGEN_IZQ_PT = 70.87;
const MARGEN_DER_PT = 70.87;
const MARGEN_SUP_PT = 36.85;
const MARGEN_INF_PT = 28.35;
const PT_POR_PX = 0.75; // 96 dpi → 72 dpi

/**
 * Convierte un documento HTML completo en PDF y lo DESCARGA directamente
 * (sin diálogo de impresión).
 *
 * El HTML se renderiza en un iframe oculto (así conserva sus propios estilos
 * y no afecta a la app) con el ancho útil de la hoja; se captura con
 * html2canvas y se reparte en páginas carta con jsPDF. Las páginas se cortan
 * entre filas/bloques, nunca por la mitad de uno. Los márgenes de `@page` no
 * existen en pantalla, por eso se aplican aquí al colocar la imagen.
 */
export const descargarHtmlComoPdfWeb = async (html: string, nombreArchivo: string): Promise<void> => {
  await Promise.all([cargarScript(URL_HTML2CANVAS, 'html2canvas'), cargarScript(URL_JSPDF, 'jspdf')]);

  const anchoPx = Math.round((PAG_ANCHO_PT - MARGEN_IZQ_PT - MARGEN_DER_PT) / PT_POR_PX);
  const altoPaginaPx = (PAG_ALTO_PT - MARGEN_SUP_PT - MARGEN_INF_PT) / PT_POR_PX;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${anchoPx}px;height:1200px;border:0;visibility:hidden;`;
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('No se pudo preparar el documento');
    doc.open();
    doc.write(html);
    doc.close();

    // Sin esperar a las imágenes embebidas ni a las fuentes, el PDF saldría incompleto.
    await Promise.all([
      ...Array.from(doc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve());
              img.addEventListener('error', () => resolve());
            })
      ),
      (doc as any).fonts?.ready ?? Promise.resolve(),
    ]);

    const cuerpo = doc.body;
    const altoTotalPx = Math.ceil(cuerpo.scrollHeight);
    const origen = cuerpo.getBoundingClientRect().top;

    // Bloques que no deben partirse entre dos páginas. Las filas del membrete
    // (tabla exterior y encabezado) quedan fuera: son enormes y no se cortan.
    const bloques = Array.from(
      cuerpo.querySelectorAll('tr, .analisis-ia, .torta, h2, .doc-titulo')
    )
      .filter((el) => !el.closest('table.mb-doc > thead, table.mb-doc > tfoot') && !(el.tagName === 'TR' && el.parentElement?.parentElement?.classList.contains('mb-doc')))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - origen, bottom: r.bottom - origen };
      });

    const lienzo: HTMLCanvasElement = await (window as any).html2canvas(cuerpo, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: anchoPx,
      windowHeight: altoTotalPx,
    });
    const escala = lienzo.width / anchoPx;

    const { jsPDF } = (window as any).jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const anchoImgPt = PAG_ANCHO_PT - MARGEN_IZQ_PT - MARGEN_DER_PT;

    let y = 0;
    let primera = true;
    while (y < altoTotalPx - 1) {
      let fin = y + altoPaginaPx;
      if (fin >= altoTotalPx) {
        fin = altoTotalPx;
      } else {
        // Si un bloque queda cortado por el fin de página, la página termina antes de él.
        const cortados = bloques.filter((b) => b.top < fin && b.bottom > fin && b.top > y + 40);
        if (cortados.length > 0) fin = Math.min(...cortados.map((b) => b.top));
      }

      const pedazo = document.createElement('canvas');
      pedazo.width = lienzo.width;
      pedazo.height = Math.max(1, Math.round((fin - y) * escala));
      const ctx = pedazo.getContext('2d');
      if (!ctx) throw new Error('No se pudo componer la página');
      ctx.drawImage(lienzo, 0, Math.round(y * escala), lienzo.width, pedazo.height, 0, 0, lienzo.width, pedazo.height);

      if (!primera) pdf.addPage();
      primera = false;
      pdf.addImage(pedazo.toDataURL('image/jpeg', 0.95), 'JPEG', MARGEN_IZQ_PT, MARGEN_SUP_PT, anchoImgPt, (fin - y) * PT_POR_PX);
      y = fin;
    }

    pdf.save(nombreArchivo);
  } finally {
    iframe.remove();
  }
};
