// ============================================================
// GEODAILY — Visor PDF interno (PDF.js dentro de WebView)
// ============================================================
// Android WebView no trae visor de PDF nativo, por eso antes se delegaba
// a una app externa (IntentLauncher). Aquí se renderiza con PDF.js — que
// es JavaScript puro — para no depender de apps de terceros.
//
// Claves del enfoque:
//  · react-native-webview ya viene compilado en la APK → funciona por OTA.
//  · PDF.js y su worker se empaquetan como assets (offline).
//  · El worker se carga como <script> normal: así pdf.js detecta
//    globalThis.pdfjsWorker y usa su "fake worker" en el hilo principal,
//    evitando el bloqueo de Web Workers en documentos file:// / data:.
//  · El PDF viaja como base64 dentro del HTML (no hay fetch a file://).
//  · El HTML se escribe a caché y se carga por file://, para no enviar
//    varios MB a través del bridge en cada apertura.

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { construirHtmlVisorPdf } from './pdfViewerTemplate';

// `.js.txt` → Metro lo trata como asset (no como módulo JS).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFJS_MODULE = require('../../assets/pdfjs/pdf.min.js.txt');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFJS_WORKER_MODULE = require('../../assets/pdfjs/pdf.worker.min.js.txt');

// Subir al cambiar los PDFs o el HTML: invalida la caché en disco.
const VIEWER_VERSION = 'v1';

let pdfjsSourceCache: string | null = null;
let workerSourceCache: string | null = null;
const htmlPending = new Map<string, Promise<string>>();

function viewerDir(): string {
  const base = FileSystem.cacheDirectory;
  if (!base) {
    throw new Error('No hay directorio de caché disponible');
  }
  return `${base}pdf-viewer/`;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function readAssetText(moduleRef: number): Promise<string> {
  const asset = Asset.fromModule(moduleRef);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  if (!asset.localUri) {
    throw new Error('No se pudo resolver el recurso de PDF.js');
  }
  return FileSystem.readAsStringAsync(asset.localUri);
}

async function getPdfjsSources(): Promise<{ pdfjs: string; worker: string }> {
  if (!pdfjsSourceCache || !workerSourceCache) {
    const [pdfjs, worker] = await Promise.all([
      readAssetText(PDFJS_MODULE),
      readAssetText(PDFJS_WORKER_MODULE),
    ]);
    pdfjsSourceCache = pdfjs;
    workerSourceCache = worker;
  }
  return { pdfjs: pdfjsSourceCache, worker: workerSourceCache };
}

/**
 * Devuelve el URI file:// del HTML que renderiza el PDF con PDF.js.
 * El resultado se cachea en disco: reabrir el mismo documento es inmediato.
 */
export async function crearHtmlVisorPdf(
  moduleRef: number,
  cacheKey: string
): Promise<string> {
  const asset = Asset.fromModule(moduleRef);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  const pdfUri = asset.localUri;
  if (!pdfUri) {
    throw new Error('No se pudo resolver el archivo PDF');
  }

  const pdfInfo = await FileSystem.getInfoAsync(pdfUri);
  const size = pdfInfo.exists ? pdfInfo.size : 0;
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `visor-${safeKey}-${size}-${VIEWER_VERSION}.html`;
  const dir = viewerDir();
  const htmlUri = `${dir}${fileName}`;

  const pending = htmlPending.get(htmlUri);
  if (pending) return pending;

  const job = (async () => {
    const info = await FileSystem.getInfoAsync(htmlUri);
    if (info.exists) return htmlUri;

    const [{ pdfjs, worker }, pdfBase64] = await Promise.all([
      getPdfjsSources(),
      FileSystem.readAsStringAsync(pdfUri, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    ]);

    const html = construirHtmlVisorPdf(pdfjs, worker, pdfBase64);

    await ensureDir(dir);
    await FileSystem.writeAsStringAsync(htmlUri, html, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return htmlUri;
  })();

  htmlPending.set(htmlUri, job);
  try {
    return await job;
  } finally {
    htmlPending.delete(htmlUri);
  }
}

/** Borra el HTML cacheado del visor (útil al cambiar PDFs). */
export async function limpiarCacheVisorPdf(): Promise<void> {
  try {
    await FileSystem.deleteAsync(viewerDir(), { idempotent: true });
  } catch (e) {
    // sin caché no hay nada que limpiar
  }
  pdfjsSourceCache = null;
  workerSourceCache = null;
}
