// ============================================================
// GEODAILY — Plantilla HTML del visor PDF (PDF.js)
// ============================================================
// Módulo puro (sin imports de React Native / Expo) para poder probarlo
// de forma aislada: recibe el código de PDF.js, el del worker y el PDF en
// base64, y devuelve el documento HTML completo que se carga en el WebView.
//
// El renderizado es perezoso: cada página vive en un contenedor con la
// altura ya calculada y sólo se dibuja cuando se acerca al viewport. Los
// canvas ya vistos se conservan hasta un máximo (LRU) para que documentos
// largos (30+ páginas) no agoten la memoria del dispositivo.

/** Evita que la cadena `</script>` dentro del código rompa el HTML. */
export function scriptSafe(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

const ESTILOS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #525659;
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: transparent;
  }
  #pages { padding: 8px; }
  .slot {
    width: 100%;
    margin: 0 auto 10px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .page {
    display: block;
    width: 100%;
    height: auto;
  }
  #overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #525659;
    color: #fff;
    font: 14px -apple-system, Roboto, Helvetica, Arial, sans-serif;
    text-align: center;
    padding: 24px;
    z-index: 10;
  }
  .spinner {
    width: 34px; height: 34px;
    margin: 0 auto 14px;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #status {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    padding: 7px 12px;
    display: none;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font: 12px -apple-system, Roboto, Helvetica, Arial, sans-serif;
    text-align: center;
  }
  .error-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
  .error-detail {
    font-size: 12px;
    opacity: 0.75;
    line-height: 1.45;
    word-break: break-word;
    white-space: pre-wrap;
  }
`;

const SCRIPT_VISOR = `
(function () {
  var B64 = __PDF_BASE64__;

  // Canvas que se conservan en memoria. Al superarlo se libera el más
  // antiguo; si el usuario vuelve a esa página, se redibuja.
  var MAX_CANVAS = 6;

  var pdf = null;
  var slots = [];
  var dibujadas = [];
  var enCurso = 0;
  var primeraLista = false;
  var observer = null;
  var dprActual = Math.min(window.devicePixelRatio || 1, 2);

  function notify(type, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
      }
    } catch (e) { /* no hay puente RN: modo navegador */ }
  }

  function overlayEl() { return document.getElementById('overlay'); }

  function fail(message) {
    var el = overlayEl();
    el.innerHTML =
      '<div><div class="error-title">No se pudo mostrar el documento</div>' +
      '<div class="error-detail">' + String(message || 'Error desconocido') + '</div></div>';
    el.style.display = 'flex';
    notify('error', String(message || 'Error desconocido'));
  }

  function decodeBase64(value) {
    var binary = atob(value);
    var length = binary.length;
    var bytes = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  var ocultarTimer = null;

  function mostrarEstado(texto) {
    var el = document.getElementById('status');
    if (ocultarTimer) { clearTimeout(ocultarTimer); ocultarTimer = null; }
    el.textContent = texto;
    el.style.display = 'block';
  }

  function estadoInactivo() {
    if (ocultarTimer) clearTimeout(ocultarTimer);
    ocultarTimer = setTimeout(function () {
      document.getElementById('status').style.display = 'none';
      ocultarTimer = null;
    }, 700);
  }

  function liberarSlot(slot) {
    if (!slot.dibujada) return;
    slot.el.innerHTML = '';
    slot.el.style.height = slot.height + 'px';
    slot.dibujada = false;
  }

  /**
   * Suelta canvas hasta volver al límite, pero nunca el de una página que
   * el usuario está viendo en ese momento (dejaría un hueco en blanco).
   */
  function depurar() {
    var i = 0;
    while (dibujadas.length > MAX_CANVAS && i < dibujadas.length) {
      var candidata = dibujadas[i];
      if (candidata.visible || candidata.enCurso) {
        i++;
        continue;
      }
      dibujadas.splice(i, 1);
      liberarSlot(candidata);
    }
  }

  function renderSlot(slot) {
    if (!pdf || slot.dibujada || slot.enCurso) return;

    slot.enCurso = true;
    enCurso++;
    mostrarEstado('Pagina ' + slot.page + ' de ' + slots.length);

    pdf
      .getPage(slot.page)
      .then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var ancho = Math.max(220, (window.innerWidth || 320) - 16);
        var viewport = page.getViewport({ scale: ancho / base.width });

        var canvas = document.createElement('canvas');
        canvas.className = 'page';
        canvas.width = Math.max(1, Math.floor(viewport.width * dprActual));
        canvas.height = Math.max(1, Math.floor(viewport.height * dprActual));

        slot.el.style.height = Math.floor(viewport.height) + 'px';
        slot.el.appendChild(canvas);

        var ctx = canvas.getContext('2d', { alpha: false });

        return page
          .render({
            canvasContext: ctx,
            viewport: viewport,
            transform: [dprActual, 0, 0, dprActual, 0, 0],
          })
          .promise
          .then(function () {
            page.cleanup();
            slot.dibujada = true;

            var repetida = dibujadas.indexOf(slot);
            if (repetida >= 0) dibujadas.splice(repetida, 1);
            dibujadas.push(slot);
            depurar();

            notify('progress', { page: slot.page, total: slots.length });
          });
      })
      .catch(function (error) {
        if (!primeraLista) {
          fail(error && error.message ? error.message : error);
        }
      })
      .then(function () {
        slot.enCurso = false;
        enCurso--;
        if (!primeraLista && slot.dibujada) {
          primeraLista = true;
          overlayEl().style.display = 'none';
          notify('ready', { total: slots.length });
        }
        if (enCurso <= 0) estadoInactivo();
      });
  }

  function observar(slot) {
    if (observer) {
      observer.observe(slot.el);
    } else {
      // Sin IntersectionObserver: render secuencial de todas las páginas.
      renderSlot(slot);
    }
  }

  function start() {
    if (!window.pdfjsLib) {
      fail('La libreria de PDF no se cargo.');
      return;
    }

    var bytes;
    try {
      bytes = decodeBase64(B64);
    } catch (e) {
      fail('El documento esta corrupto o incompleto.');
      return;
    }
    B64 = null;

    // Sin worker real: pdf.js detecta globalThis.pdfjsWorker y usa el
    // "fake worker" en el hilo principal. workerSrc solo evita el aviso.
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

    var pagesEl = document.getElementById('pages');

    window.pdfjsLib
      .getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 })
      .promise
      .then(function (documento) {
        pdf = documento;
        var total = pdf.numPages;
        if (!total) {
          fail('El documento no tiene paginas.');
          return;
        }

        if (typeof window.IntersectionObserver === 'function') {
          observer = new window.IntersectionObserver(
            function (entradas) {
              for (var i = 0; i < entradas.length; i++) {
                var entrada = entradas[i];
                var indice = parseInt(entrada.target.getAttribute('data-page'), 10);
                var slot = slots[indice];
                if (!slot) continue;
                slot.visible = entrada.isIntersecting;
                if (entrada.isIntersecting) renderSlot(slot);
              }
              depurar();
            },
            { root: null, rootMargin: '700px 0px', threshold: 0 }
          );
        }

        // Se necesita la proporción de página para reservar la altura y
        // evitar que el scroll salte mientras se dibuja.
        return pdf.getPage(1).then(function (page) {
          var vp = page.getViewport({ scale: 1 });
          var ancho = Math.max(220, (window.innerWidth || 320) - 16);
          var alto = Math.floor(ancho * (vp.height / vp.width));

          for (var n = 1; n <= total; n++) {
            var el = document.createElement('div');
            el.className = 'slot';
            el.style.height = alto + 'px';
            el.setAttribute('data-page', String(n - 1));
            pagesEl.appendChild(el);
            slots.push({
              page: n,
              el: el,
              height: alto,
              dibujada: false,
              enCurso: false,
              visible: false,
            });
          }

          // Se observan TODAS las páginas (incluida la primera) para que
          // ninguna quede en blanco si su canvas se libera por memoria.
          for (var k = 0; k < slots.length; k++) observar(slots[k]);
        });
      })
      .catch(function (error) {
        fail(error && error.message ? error.message : error);
      });
  }

  start();
})();
`;

export function construirHtmlVisorPdf(
  pdfjsSource: string,
  workerSource: string,
  pdfBase64: string
): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
<title>Visor PDF</title>
<style>${ESTILOS}</style>
</head>
<body>
<div id="overlay">
  <div>
    <div class="spinner"></div>
    <div id="overlay-text">Abriendo documento...</div>
  </div>
</div>
<div id="pages"></div>
<div id="status"></div>
<script>__PDFJS_SOURCE__</script>
<script>__WORKER_SOURCE__</script>
<script>${SCRIPT_VISOR}</script>
</body>
</html>`
    .replace('__PDFJS_SOURCE__', () => scriptSafe(pdfjsSource))
    .replace('__WORKER_SOURCE__', () => scriptSafe(workerSource))
    .replace('__PDF_BASE64__', () => JSON.stringify(pdfBase64));
}
