// ============================================================
// Expediente PDF de un grupo de una ECA — generado en el SERVIDOR
// ============================================================
// Recopila en un solo PDF todo lo subido a un grupo de veredas:
//   Portada (ECA, grupo, veredas, índice) →
//   1. Protocolo            (PDFs, páginas tal cual)
//   2. Informes             (PDFs, páginas tal cual)
//   3. Listado de Asistencia (PDFs y/o fotos, una foto por página)
//   4. Registro Fotográfico (fotos, dos por página)
// Cada sección abre con una página separadora. Un PDF dañado o protegido no
// tumba el expediente: se deja una página que lo indica. Al final se estampa
// "Página X de Y" en el pie de todas las páginas.
// ============================================================

const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const storage = require('../storage');
const { GRUPOS_VEREDAS } = require('./fortalecimiento');

// Carta en puntos.
const ANCHO = 612;
const ALTO = 792;
const MARGEN = 50;
const VERDE = rgb(0x1b / 255, 0x5e / 255, 0x20 / 255);
const GRIS = rgb(0.35, 0.35, 0.35);

const SECCIONES_EXPEDIENTE = [
  { id: 'protocolo', titulo: 'Protocolo' },
  { id: 'informes', titulo: 'Informes' },
  { id: 'listado_asistencia', titulo: 'Listado de Asistencia' },
  { id: 'registro_fotografico', titulo: 'Registro Fotográfico' },
];

/** Las fuentes estándar solo codifican WinAnsi: se descarta lo que no cabe (emojis, etc.). */
const seguro = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

const fechaLarga = (d) =>
  new Date(d).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
const fechaCorta = (d) => new Date(d).toLocaleDateString('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

async function leerArchivo(key) {
  const stream = await storage.getFileStream(key);
  if (!stream) throw new Error(`Archivo no disponible: ${key}`);
  const partes = [];
  for await (const c of stream) partes.push(c);
  return Buffer.concat(partes);
}

/** Parte un texto en líneas que quepan en `ancho` con la fuente dada. */
function envolver(texto, fuente, tam, ancho) {
  const lineas = [];
  for (const parrafo of seguro(texto).split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(prueba, tam) <= ancho || !actual) actual = prueba;
      else {
        lineas.push(actual);
        actual = palabra;
      }
    }
    lineas.push(actual);
  }
  return lineas;
}

/** Dibuja un bloque de texto envuelto; devuelve la nueva coordenada y. */
function bloque(pagina, texto, { x = MARGEN, y, fuente, tam, color = rgb(0, 0, 0), ancho = ANCHO - 2 * MARGEN, interlinea = 1.35, centrado = false }) {
  for (const linea of envolver(texto, fuente, tam, ancho)) {
    const w = fuente.widthOfTextAtSize(linea, tam);
    pagina.drawText(linea, { x: centrado ? (ANCHO - w) / 2 : x, y, size: tam, font: fuente, color });
    y -= tam * interlinea;
  }
  return y;
}

/** Foto orientada por EXIF, ≤1600 px, JPEG liviano. */
async function prepararFoto(buffer) {
  const img = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true });
  return img.toBuffer();
}

/** Escala (w, h) para caber en (maxW, maxH) sin deformar. */
function encajar(w, h, maxW, maxH) {
  const k = Math.min(maxW / w, maxH / h, 1.5);
  return { w: w * k, h: h * k };
}

/**
 * Genera el expediente del grupo.
 * @param {{ eca:number, grupo:number, filas:Array<{seccion,nombre_archivo,mime,storage_key,created_at,subido_por_nombre}>, generadoPor?:string }} p
 * @returns {Promise<{ pdf: Buffer, paginas: number }>}
 */
async function generarExpedienteGrupo({ eca, grupo, filas, generadoPor }) {
  const doc = await PDFDocument.create();
  doc.setTitle(seguro(`ECA ${eca} - Grupo ${grupo} - Expediente`));
  doc.setAuthor('GEODAILY');
  doc.setCreator('GEODAILY');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const cursiva = await doc.embedFont(StandardFonts.HelveticaOblique);

  const porSeccion = Object.fromEntries(SECCIONES_EXPEDIENTE.map((s) => [s.id, filas.filter((f) => f.seccion === s.id)]));
  const veredas = GRUPOS_VEREDAS[grupo - 1] || '';

  // ─── Portada ──────────────────────────────────────────────
  const portada = doc.addPage([ANCHO, ALTO]);
  portada.drawRectangle({ x: 0, y: ALTO - 140, width: ANCHO, height: 140, color: VERDE });
  let y = ALTO - 70;
  y = bloque(portada, 'Fortalecimiento de Capacidades en Cacao Sostenible', { y, fuente: negrita, tam: 18, color: rgb(1, 1, 1), centrado: true });
  bloque(portada, 'Escuelas de Campo para Agricultores (ECAS)', { y: y - 4, fuente: normal, tam: 12, color: rgb(1, 1, 1), centrado: true });

  y = ALTO - 210;
  y = bloque(portada, `ECA ${eca} · Grupo ${grupo}`, { y, fuente: negrita, tam: 28, color: VERDE, centrado: true });
  y -= 6;
  y = bloque(portada, veredas, { y, fuente: normal, tam: 13, color: GRIS, centrado: true, ancho: ANCHO - 2 * MARGEN - 40 });

  y -= 40;
  portada.drawText('Contenido', { x: MARGEN, y, size: 15, font: negrita, color: VERDE });
  y -= 10;
  portada.drawLine({ start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y }, thickness: 1, color: VERDE });
  y -= 26;
  SECCIONES_EXPEDIENTE.forEach((s, i) => {
    const n = porSeccion[s.id].length;
    portada.drawText(seguro(`${i + 1}. ${s.titulo}`), { x: MARGEN + 10, y, size: 13, font: negrita });
    const det = n === 0 ? 'Sin archivos' : `${n} archivo${n === 1 ? '' : 's'}`;
    const w = normal.widthOfTextAtSize(det, 12);
    portada.drawText(det, { x: ANCHO - MARGEN - 10 - w, y, size: 12, font: normal, color: n === 0 ? GRIS : rgb(0, 0, 0) });
    y -= 26;
  });

  y -= 30;
  bloque(portada, `Generado el ${fechaLarga(new Date())}${generadoPor ? ` por ${generadoPor}` : ''}.`, { y, fuente: cursiva, tam: 10, color: GRIS });

  // ─── Secciones ────────────────────────────────────────────
  const separador = (num, titulo, n) => {
    const p = doc.addPage([ANCHO, ALTO]);
    p.drawRectangle({ x: 0, y: ALTO / 2 - 60, width: ANCHO, height: 120, color: VERDE });
    bloque(p, `${num}. ${titulo}`, { y: ALTO / 2 + 6, fuente: negrita, tam: 26, color: rgb(1, 1, 1), centrado: true });
    bloque(p, `ECA ${eca} · Grupo ${grupo}`, { y: ALTO / 2 - 28, fuente: normal, tam: 12, color: rgb(1, 1, 1), centrado: true });
    if (n === 0) bloque(p, 'Esta sección no tiene archivos cargados.', { y: ALTO / 2 - 110, fuente: cursiva, tam: 13, color: GRIS, centrado: true });
  };

  const aviso = (titulo, texto) => {
    const p = doc.addPage([ANCHO, ALTO]);
    let yy = ALTO - 120;
    yy = bloque(p, titulo, { y: yy, fuente: negrita, tam: 14, color: VERDE });
    bloque(p, texto, { y: yy - 6, fuente: normal, tam: 11, color: GRIS });
  };

  const leyenda = (f) => [f.nombre_archivo, f.subido_por_nombre, fechaCorta(f.created_at)].filter(Boolean).join(' · ');

  const anexarPdf = async (f) => {
    try {
      const fuente = await PDFDocument.load(await leerArchivo(f.storage_key), { ignoreEncryption: true });
      const paginas = await doc.copyPages(fuente, fuente.getPageIndices());
      paginas.forEach((p) => doc.addPage(p));
    } catch (e) {
      console.warn(`[Expediente] No se pudo anexar ${f.storage_key}:`, e.message);
      aviso('Documento no incluido', `"${f.nombre_archivo || 'archivo'}" no se pudo incluir (archivo dañado o protegido). Ábrelo directamente desde la aplicación.`);
    }
  };

  const fotoEmbebida = async (f) => {
    try {
      return await doc.embedJpg(await prepararFoto(await leerArchivo(f.storage_key)));
    } catch (e) {
      console.warn(`[Expediente] Foto ilegible ${f.storage_key}:`, e.message);
      return null;
    }
  };

  // Una imagen por página (listado de asistencia escaneado o fotografiado).
  const fotoPaginaCompleta = async (f, titulo) => {
    const img = await fotoEmbebida(f);
    const p = doc.addPage([ANCHO, ALTO]);
    p.drawText(seguro(titulo), { x: MARGEN, y: ALTO - MARGEN, size: 12, font: negrita, color: VERDE });
    const zonaAlto = ALTO - 2 * MARGEN - 50;
    if (!img) {
      bloque(p, `No se pudo leer la imagen "${f.nombre_archivo || ''}".`, { y: ALTO / 2, fuente: cursiva, tam: 11, color: GRIS, centrado: true });
    } else {
      const { w, h } = encajar(img.width, img.height, ANCHO - 2 * MARGEN, zonaAlto);
      p.drawImage(img, { x: (ANCHO - w) / 2, y: MARGEN + 30 + (zonaAlto - h) / 2, width: w, height: h });
    }
    bloque(p, leyenda(f), { y: MARGEN + 12, fuente: normal, tam: 8, color: GRIS });
  };

  // Registro fotográfico: dos fotos por página con su pie.
  const fotosDosPorPagina = async (lista) => {
    const ranuraAlto = (ALTO - 2 * MARGEN - 40) / 2;
    for (let i = 0; i < lista.length; i += 2) {
      const p = doc.addPage([ANCHO, ALTO]);
      p.drawText(seguro(`Registro Fotográfico · ECA ${eca} · Grupo ${grupo}`), { x: MARGEN, y: ALTO - MARGEN, size: 12, font: negrita, color: VERDE });
      for (let k = 0; k < 2 && i + k < lista.length; k++) {
        const f = lista[i + k];
        const base = ALTO - MARGEN - 20 - (k + 1) * ranuraAlto; // borde inferior de la ranura
        const img = await fotoEmbebida(f);
        const zonaAlto = ranuraAlto - 30;
        if (img) {
          const { w, h } = encajar(img.width, img.height, ANCHO - 2 * MARGEN, zonaAlto);
          p.drawImage(img, { x: (ANCHO - w) / 2, y: base + 22 + (zonaAlto - h) / 2, width: w, height: h });
        } else {
          bloque(p, 'No se pudo leer esta imagen.', { y: base + ranuraAlto / 2, fuente: cursiva, tam: 11, color: GRIS, centrado: true });
        }
        bloque(p, `Foto ${i + k + 1}. ${leyenda(f)}`, { y: base + 8, fuente: normal, tam: 8, color: GRIS, centrado: true });
      }
    }
  };

  for (const [idx, s] of SECCIONES_EXPEDIENTE.entries()) {
    const lista = porSeccion[s.id];
    separador(idx + 1, s.titulo, lista.length);
    if (s.id === 'registro_fotografico') {
      await fotosDosPorPagina(lista);
      continue;
    }
    for (const [k, f] of lista.entries()) {
      if (f.mime === 'application/pdf') await anexarPdf(f);
      else await fotoPaginaCompleta(f, `${s.titulo} · Imagen ${k + 1}`);
    }
  }

  // ─── Numeración ───────────────────────────────────────────
  const paginas = doc.getPages();
  const total = paginas.length;
  paginas.forEach((p, i) => {
    const { width } = p.getSize();
    const texto = `ECA ${eca} · Grupo ${grupo}  —  Página ${i + 1} de ${total}`;
    const w = normal.widthOfTextAtSize(texto, 8);
    // Fondo blanco para que se lea sobre páginas escaneadas.
    p.drawRectangle({ x: width - w - 24, y: 8, width: w + 12, height: 14, color: rgb(1, 1, 1), opacity: 0.85 });
    p.drawText(texto, { x: width - w - 18, y: 12, size: 8, font: normal, color: GRIS });
  });

  const pdf = Buffer.from(await doc.save({ useObjectStreams: true }));
  return { pdf, paginas: total };
}

module.exports = { generarExpedienteGrupo, SECCIONES_EXPEDIENTE };
