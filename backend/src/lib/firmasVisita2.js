// ============================================================
// Firmas de la Visita Técnica 2 de un beneficiario
// ============================================================
// El Acta de Entrega de "Preparación del Terreno" se llena con las firmas del
// técnico y del beneficiario que ya quedaron en la Visita 2 (formato 'v2').
// En `formularios` las firmas quedan como ruta de MinIO tras sincronizar (o
// como data URI si nunca se subieron): aquí se devuelven como data URI, que
// es como el acta guarda sus firmas.
// ============================================================

const db = require('../database');
const storage = require('../storage');
const { sqlCedulaNormalizada, normalizarCedula } = require('./visitas');

const MIME_POR_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const leerBuffer = async (stream) => {
  const partes = [];
  for await (const p of stream) partes.push(p);
  return Buffer.concat(partes);
};

/** Firma guardada en `formularios` → data URI, o null si no hay o no se puede leer. */
async function firmaComoDataUri(valor) {
  if (typeof valor !== 'string' || !valor) return null;
  if (valor.startsWith('data:image')) return valor;
  if (/^(https?|file):/i.test(valor)) return null;
  try {
    const ruta = await storage.resolveFilePath(valor);
    if (!ruta) return null;
    const stream = await storage.getFileStream(ruta);
    if (!stream) return null;
    const buffer = await leerBuffer(stream);
    if (!buffer.length) return null;
    const ext = (ruta.split('.').pop() || '').toLowerCase();
    return `data:${MIME_POR_EXT[ext] || 'image/png'};base64,${buffer.toString('base64')}`;
  } catch (e) {
    console.warn('[FirmasVisita2] No se pudo leer la firma:', valor, e.message);
    return null;
  }
}

/**
 * Firmas de la Visita 2 más reciente de la cédula:
 * { formularioId, firmaBeneficiario, firmaTecnico } (cada firma puede ser null),
 * o null si el beneficiario no tiene Visita 2.
 */
async function firmasVisita2(cedula) {
  const ced = normalizarCedula(cedula);
  if (!ced) return null;
  const f = await db.queryOne(
    `SELECT id, firma_beneficiario, firma_tecnico
       FROM formularios
      WHERE tipo = 'visita_tecnica'
        AND actividad_json->>'formato_visita' = 'v2'
        AND ${sqlCedulaNormalizada("beneficiario_json->>'cedula'")} = $1
      ORDER BY (COALESCE(firma_beneficiario, '') <> '' AND COALESCE(firma_tecnico, '') <> '') DESC,
               updated_at DESC NULLS LAST
      LIMIT 1`,
    [ced]
  );
  if (!f) return null;
  const [firmaBeneficiario, firmaTecnico] = await Promise.all([
    firmaComoDataUri(f.firma_beneficiario),
    firmaComoDataUri(f.firma_tecnico),
  ]);
  return { formularioId: f.id, firmaBeneficiario, firmaTecnico };
}

/** Actividades cuyas Actas de Entrega llevan las firmas de la Visita 2 (espejo de la app). */
const ACTIVIDADES_FIRMAS_VISITA_2 = ['preparacion_terreno'];

const esFirma = (v) => typeof v === 'string' && v.startsWith('data:image');

/**
 * Pone en `datos` (Acta de Entrega) las firmas de la Visita 2 que le falten:
 * solo actividades de ACTIVIDADES_FIRMAS_VISITA_2 y solo campos vacíos (una
 * firma ya puesta no se toca). Quita de `faltantes` las firmas que llenó.
 * Devuelve { datos, cambio } sin modificar el objeto recibido.
 */
function aplicarFirmasVisita2(datos, firmas) {
  if (!datos || typeof datos !== 'object' || !firmas) return { datos, cambio: false };
  if (!ACTIVIDADES_FIRMAS_VISITA_2.includes(datos.actividadId)) return { datos, cambio: false };
  const nuevo = { ...datos };
  let cambio = false;
  if (!esFirma(nuevo.firmaBeneficiario) && esFirma(firmas.firmaBeneficiario)) {
    nuevo.firmaBeneficiario = firmas.firmaBeneficiario;
    cambio = true;
  }
  if (!esFirma(nuevo.firmaTecnico) && esFirma(firmas.firmaTecnico)) {
    nuevo.firmaTecnico = firmas.firmaTecnico;
    cambio = true;
  }
  if (cambio && Array.isArray(nuevo.faltantes)) {
    nuevo.faltantes = nuevo.faltantes.filter(
      (x) =>
        !(x === 'Firma del beneficiario' && esFirma(nuevo.firmaBeneficiario)) &&
        !(x === 'Firma del contratista (técnico)' && esFirma(nuevo.firmaTecnico))
    );
  }
  return { datos: cambio ? nuevo : datos, cambio };
}

/** Como `aplicarFirmasVisita2`, buscando las firmas solo si al acta le hacen falta. */
async function completarConFirmasVisita2(datos, cedula) {
  if (!datos || typeof datos !== 'object' || !ACTIVIDADES_FIRMAS_VISITA_2.includes(datos.actividadId)) {
    return { datos, cambio: false };
  }
  if (esFirma(datos.firmaBeneficiario) && esFirma(datos.firmaTecnico)) return { datos, cambio: false };
  try {
    return aplicarFirmasVisita2(datos, await firmasVisita2(cedula));
  } catch (e) {
    console.warn('[FirmasVisita2] No se pudieron completar las firmas:', e.message);
    return { datos, cambio: false };
  }
}

module.exports = {
  ACTIVIDADES_FIRMAS_VISITA_2,
  firmasVisita2,
  firmaComoDataUri,
  aplicarFirmasVisita2,
  completarConFirmasVisita2,
};
