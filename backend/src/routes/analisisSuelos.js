// ============================================================
// Análisis de suelos por predio — resultado de laboratorio (PDF)
// ============================================================
// Cada beneficiario tiene a lo sumo UN PDF con el resultado del laboratorio;
// subir otro lo reemplaza. El PDF vive en MinIO bajo
//   {rol}s/{usuario}/AnalisisSuelos/{item}.pdf
// y la tabla analisis_suelos lleva el registro y la lectura cacheada de la IA.
//
// Permisos:
//   · tecnico  → sube / ve / quita SOLO los de sus beneficiarios asignados.
//   · coordinador, interventor, gerente, admin → solo lectura de todos
//     (el admin además puede quitar, por si hay que corregir un error).
// ============================================================

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const deepseek = require('../lib/deepseek');
const { sqlNoEsPrueba } = require('../lib/usuariosPrueba');
const { sqlCteCaracterizacion, sqlCedulaNormalizada } = require('../lib/visitas');
const { quitarRevision } = require('../lib/revisionInterventoria');
const { extraerDatosSuelos, VARIABLES } = require('../lib/suelosPdf');
const { generarPdfInforme } = require('../lib/informeSuelosPdf');

const router = express.Router();

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
/** Meta del proyecto: un análisis por predio, 300 predios. */
const META_ANALISIS = 300;
/** PDF sin hoja de resumen que se leen con la IA en una sola petición. */
const MAX_LECTURAS_POR_INFORME = 25;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const esSuperior = (user) => ROLES_SUPERIORES.includes(user?.rol);

const llaveStorage = (tecnico, item) =>
  `${storage.getUserBasePath('tecnico', tecnico.usuario)}/AnalisisSuelos/${item}.pdf`;

const tecnicoPorUsuario = (usuario) =>
  db.queryOne(
    "SELECT id, usuario, nombre, cedula FROM usuarios WHERE usuario = $1 AND rol = 'tecnico'",
    [String(usuario || '')]
  );

/** Beneficiarios de un técnico con el estado de su análisis. */
const beneficiariosDeTecnico = (tecnicoId) =>
  db.queryAll(
    `${sqlCteCaracterizacion()}
     SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
            (a.beneficiario_item IS NOT NULL) AS tiene_archivo,
            a.nombre_archivo, a.updated_at AS subido_en, a.resumen_ia,
            v.id AS formulario_id
     FROM beneficiarios b
     LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item
     LEFT JOIN v ON v.ced = ${sqlCedulaNormalizada('b.cedula')}
     WHERE b.tecnico_asignado_id = $1
     ORDER BY b.nombre_completo ASC`,
    [tecnicoId]
  );

const aBeneficiarioDto = (r) => ({
  item: r.item,
  nombre: r.nombre_completo,
  cedula: r.cedula,
  corregimiento: r.corregimiento,
  vereda: r.vereda,
  tieneArchivo: !!r.tiene_archivo,
  nombreArchivo: r.nombre_archivo || null,
  subidoEn: r.subido_en || null,
  /** Visita 1 (caracterización) del beneficiario, si ya la diligenciaron. */
  formularioId: r.formulario_id ?? null,
});

/** Verifica que el beneficiario sea del técnico logueado. Responde y devuelve null si no. */
async function beneficiarioPropio(req, res) {
  const item = parseInt(req.params.item, 10);
  if (!Number.isInteger(item)) {
    res.status(400).json({ estado: 'error', mensaje: 'Beneficiario inválido' });
    return null;
  }
  const b = await db.queryOne(
    'SELECT item, tecnico_asignado_id FROM beneficiarios WHERE item = $1',
    [item]
  );
  if (!b) {
    res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    return null;
  }
  return b;
}

// GET /api/analisis-suelos/mis-beneficiarios — técnico
router.get('/mis-beneficiarios', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo para técnicos' });
    }
    const filas = await beneficiariosDeTecnico(req.user.id);
    res.json({ estado: 'ok', beneficiarios: filas.map(aBeneficiarioDto) });
  } catch (error) {
    console.error('[AnalisisSuelos] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// GET /api/analisis-suelos/avance — cualquier rol: avance global del proyecto
// (para la tarjeta de la lista de actividades).
router.get('/avance', authenticateToken, async (_req, res) => {
  try {
    const fila = await db.queryOne(
      `SELECT COUNT(*)::int AS total
       FROM analisis_suelos a
       JOIN beneficiarios b ON b.item = a.beneficiario_item
       JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}`
    );
    res.json({ estado: 'ok', meta: META_ANALISIS, total: fila?.total ?? 0 });
  } catch (error) {
    console.error('[AnalisisSuelos] Error en avance:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al calcular el avance' });
  }
});

// GET /api/analisis-suelos/resumen — superiores: avance por técnico
router.get('/resumen', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnicos = await db.queryAll(
      `SELECT u.usuario, u.nombre,
              COUNT(b.item)::int AS asignados,
              COUNT(a.beneficiario_item)::int AS subidos
       FROM usuarios u
       LEFT JOIN beneficiarios b ON b.tecnico_asignado_id = u.id
       LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item
       WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
       GROUP BY u.usuario, u.nombre
       ORDER BY u.nombre`
    );
    const total = tecnicos.reduce((s, t) => s + t.subidos, 0);
    res.json({ estado: 'ok', meta: META_ANALISIS, total, tecnicos });
  } catch (error) {
    console.error('[AnalisisSuelos] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al calcular el resumen' });
  }
});

// GET /api/analisis-suelos/con-analisis — superiores: TODOS los beneficiarios
// que ya tienen el PDF subido (sin filtrar por técnico).
router.get('/con-analisis', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const filas = await db.queryAll(
      `SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
              TRUE AS tiene_archivo, a.nombre_archivo, a.updated_at AS subido_en,
              u.nombre AS tecnico_nombre
       FROM analisis_suelos a
       JOIN beneficiarios b ON b.item = a.beneficiario_item
       LEFT JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE u.id IS NULL OR ${sqlNoEsPrueba('u.usuario')}
       ORDER BY b.nombre_completo ASC`
    );
    res.json({
      estado: 'ok',
      meta: META_ANALISIS,
      beneficiarios: filas.map((r) => ({ ...aBeneficiarioDto(r), tecnico: r.tecnico_nombre || null })),
    });
  } catch (error) {
    console.error('[AnalisisSuelos] Error listando con análisis:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// GET /api/analisis-suelos/matriz-excel — superiores: descarga la matriz
// consolidada de resultados de laboratorio (Excel). El archivo vive en disco,
// en resultado_estudio_suelos/; se toma el .xlsx más reciente de las carpetas
// conocidas, así basta con dejar ahí una versión nueva para actualizarla.
const CARPETAS_MATRIZ = ['matriz_excel_estudio_suelos', 'Resultado_Matriz'].map((c) =>
  path.join(__dirname, '..', '..', '..', 'resultado_estudio_suelos', c)
);

function archivoMatrizExcel() {
  let elegido = null;
  for (const dir of CARPETAS_MATRIZ) {
    let nombres = [];
    try { nombres = fs.readdirSync(dir); } catch { continue; }
    for (const n of nombres) {
      if (!/\.xlsx$/i.test(n) || n.startsWith('~$')) continue;
      const ruta = path.join(dir, n);
      const st = fs.statSync(ruta);
      if (!elegido || st.mtimeMs > elegido.mtimeMs) elegido = { ruta, nombre: n, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
  return elegido;
}

router.get('/matriz-excel', authenticateTokenOrQuery, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const archivo = archivoMatrizExcel();
    if (!archivo) return res.status(404).json({ estado: 'error', mensaje: 'La matriz aún no está disponible' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', archivo.size);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="matriz_resultados_suelos.xlsx"; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`
    );
    const stream = fs.createReadStream(archivo.ruta);
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[AnalisisSuelos] Error al descargar la matriz Excel:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar la matriz' });
  }
});

// GET /api/analisis-suelos/tecnico/:usuario — superiores: beneficiarios de un técnico
router.get('/tecnico/:usuario', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnico = await tecnicoPorUsuario(req.params.usuario);
    if (!tecnico) return res.status(404).json({ estado: 'error', mensaje: 'Técnico no encontrado' });
    const filas = await beneficiariosDeTecnico(tecnico.id);
    res.json({ estado: 'ok', tecnico, beneficiarios: filas.map(aBeneficiarioDto) });
  } catch (error) {
    console.error('[AnalisisSuelos] Error listando técnico:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// POST /api/analisis-suelos/:item/pdf — técnico dueño (multipart: archivo)
router.post('/:item/pdf', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico puede subir el PDF' });
    }
    const b = await beneficiarioPropio(req, res);
    if (!b) return;
    if (b.tecnico_asignado_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'Este beneficiario no está asignado a ti' });
    }
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    // Los PDF llevan "%PDF-" en su cabecera: no se confía en el mimetype del cliente.
    if (!req.file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
      return res.status(400).json({ estado: 'error', mensaje: 'El archivo debe ser un PDF' });
    }

    await storage.ensureBucket();
    const key = llaveStorage(req.user, b.item);
    await storage.minioClient.putObject(storage.CONFIG.bucket, key, req.file.buffer, null, {
      'Content-Type': 'application/pdf',
    });

    // Valores, interpretación, encalado y observaciones leídos del PDF (sin IA).
    const datos = await extraerDatosSuelos(req.file.buffer);
    // resumen_ia = NULL: el PDF cambió, la lectura anterior ya no vale.
    await db.query(
      `INSERT INTO analisis_suelos (beneficiario_item, tecnico_id, storage_key, nombre_archivo, tamano, subido_por, datos)
       VALUES ($1, $2, $3, $4, $5, $2, $6)
       ON CONFLICT (beneficiario_item) DO UPDATE SET
         tecnico_id = EXCLUDED.tecnico_id, storage_key = EXCLUDED.storage_key,
         nombre_archivo = EXCLUDED.nombre_archivo, tamano = EXCLUDED.tamano,
         datos = EXCLUDED.datos, resumen_ia = NULL, updated_at = NOW()`,
      [b.item, req.user.id, key, String(req.file.originalname || 'analisis.pdf').slice(0, 255), req.file.size, JSON.stringify(datos)]
    );
    // PDF nuevo: la revisión de la interventoría era del anterior.
    await quitarRevision('analisis_suelos', b.item);
    res.json({ estado: 'ok', mensaje: 'PDF subido' });
  } catch (error) {
    console.error('[AnalisisSuelos] Error al subir:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir el PDF' });
  }
});

// DELETE /api/analisis-suelos/:item/pdf — técnico dueño o admin
router.delete('/:item/pdf', authenticateToken, async (req, res) => {
  try {
    const b = await beneficiarioPropio(req, res);
    if (!b) return;
    const esDueno = req.user.rol === 'tecnico' && b.tecnico_asignado_id === req.user.id;
    if (!esDueno && req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para quitar este PDF' });
    }
    const fila = await db.queryOne('SELECT storage_key FROM analisis_suelos WHERE beneficiario_item = $1', [b.item]);
    if (!fila) return res.status(404).json({ estado: 'error', mensaje: 'No hay PDF cargado' });
    await storage.deleteFile(fila.storage_key);
    await db.query('DELETE FROM analisis_suelos WHERE beneficiario_item = $1', [b.item]);
    await quitarRevision('analisis_suelos', b.item);
    res.json({ estado: 'ok', mensaje: 'PDF eliminado' });
  } catch (error) {
    console.error('[AnalisisSuelos] Error al quitar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al quitar el PDF' });
  }
});

// GET /api/analisis-suelos/:item/pdf — dueño o superiores (acepta ?token= para web)
router.get('/:item/pdf', authenticateTokenOrQuery, async (req, res) => {
  try {
    const b = await beneficiarioPropio(req, res);
    if (!b) return;
    const esDueno = req.user.rol === 'tecnico' && b.tecnico_asignado_id === req.user.id;
    if (!esDueno && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const fila = await db.queryOne('SELECT storage_key, nombre_archivo FROM analisis_suelos WHERE beneficiario_item = $1', [b.item]);
    if (!fila) return res.status(404).json({ estado: 'error', mensaje: 'No hay PDF cargado' });
    const stat = await storage.statFile(fila.storage_key);
    const stream = stat && (await storage.getFileStream(fila.storage_key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fila.nombre_archivo || 'analisis.pdf')}"`);
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[AnalisisSuelos] Error al descargar:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
  }
});

// ─── Datos del PDF (sin IA) ─────────────────────────────────

async function leerPdf(storageKey) {
  const stream = await storage.getFileStream(storageKey);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Lee (una sola vez) los datos del PDF de las filas que aún no los tienen y los guarda. */
async function completarDatos(filas) {
  for (const f of filas) {
    if (!f.tiene_archivo || f.datos || !f.storage_key) continue;
    try {
      f.datos = await extraerDatosSuelos(await leerPdf(f.storage_key));
    } catch (err) {
      console.warn('[AnalisisSuelos] No se pudo leer el PDF', f.storage_key, err.message);
      f.datos = { formato: 'desconocido', error: err.message };
    }
    await db.query('UPDATE analisis_suelos SET datos = $1 WHERE beneficiario_item = $2', [JSON.stringify(f.datos), f.item]);
  }
}

const fmt = (n) => (n == null ? '—' : String(n).replace('.', ','));
const variable = (datos, clave) => (datos?.variables || []).find((v) => v.clave === clave) || null;
const requiereEncalado = (datos) =>
  !!datos?.preparacion && /cal (dolomita|agr[ií]cola)|cal viva|encalar/i.test(datos.preparacion) && !/no requiere encalado/i.test(datos.preparacion);

/**
 * Diagnóstico de un predio a partir de la interpretación del laboratorio:
 * qué está bajo, qué está alto y cómo está la acidez. Sin IA: siempre igual.
 */
function diagnosticoPredio(datos) {
  if (!datos?.variables?.length) return null;
  const nombreCorto = (v) => v.etiqueta.replace(/\s*\(.*\)$/, '');
  const bajos = datos.variables.filter((v) => v.clave !== 'ph' && /^baj[oa]$/i.test(v.interpretacion)).map(nombreCorto);
  const altos = datos.variables.filter((v) => v.clave !== 'ph' && /^alt[oa]$/i.test(v.interpretacion)).map(nombreCorto);
  const ph = variable(datos, 'ph');
  const partes = [];
  if (ph) partes.push(`pH ${fmt(ph.valor)} (${ph.interpretacion.toLowerCase()})`);
  if (bajos.length) partes.push(`niveles bajos de ${bajos.join(', ')}`);
  if (altos.length) partes.push(`niveles altos de ${altos.join(', ')}`);
  partes.push(requiereEncalado(datos) ? 'requiere encalado' : 'no requiere encalado');
  const t = partes.join('; ');
  return (t.startsWith('pH') ? t : t.charAt(0).toUpperCase() + t.slice(1)) + '.';
}

/** Estadísticas del conjunto (sin IA): promedios, rangos, conteo por clase, encalado e insumos. */
function estadisticasConjunto(conDatos) {
  const variables = VARIABLES.map((v) => {
    const valores = [];
    const conteos = {};
    for (const b of conDatos) {
      const x = variable(b.datos, v.clave);
      if (!x) continue;
      if (x.valor != null) valores.push(x.valor);
      const clase = x.interpretacion || '—';
      conteos[clase] = (conteos[clase] || 0) + 1;
    }
    const n = valores.length;
    return {
      clave: v.clave,
      etiqueta: v.etiqueta,
      n,
      promedio: n ? Math.round((valores.reduce((s, x) => s + x, 0) / n) * 100) / 100 : null,
      min: n ? Math.min(...valores) : null,
      max: n ? Math.max(...valores) : null,
      conteos,
    };
  });
  const insumos = {};
  let areaHa = 0;
  let plantas = 0;
  for (const b of conDatos) {
    for (const [k, kg] of Object.entries(b.datos.insumos || {})) insumos[k] = Math.round(((insumos[k] || 0) + (kg || 0)) * 10) / 10;
    areaHa += b.datos.areaHa || 0;
    plantas += b.datos.plantas || 0;
  }
  return {
    predios: conDatos.length,
    areaHa: Math.round(areaHa * 100) / 100,
    plantas,
    requierenEncalado: conDatos.filter((b) => requiereEncalado(b.datos)).length,
    variables,
    insumos,
  };
}

const SISTEMA_LECTURA = `Eres un ingeniero agrónomo. Recibirás la tabla de resultados de laboratorio de análisis de suelos de varios predios cacaoteros, cada uno identificado por "item".
Responde SOLO un JSON: {"beneficiarios": [{"item": number, "resultado": string}]}. "resultado": 2 frases con los valores clave (pH, MO, P, K, Ca, Mg, Al…) y su interpretación para cacao. Si no hay datos legibles escribe exactamente "Sin datos legibles en el PDF". No inventes valores. Sin markdown.`;

const SISTEMA_GLOBAL = `Eres un ingeniero agrónomo que redacta el ANÁLISIS GLOBAL de los estudios de suelos de predios para el establecimiento de cacao en arreglo agroforestal (proyecto de extensión rural, Puerto Rico, Caquetá). Recibirás las estadísticas del conjunto y una línea por predio con sus resultados de laboratorio, la interpretación oficial del laboratorio y si requiere encalado.
Escribe en español, de 5 a 7 párrafos cortos separados por una línea en blanco, en este orden:
1) Panorama general de la fertilidad del conjunto, con cifras de las estadísticas (cuántos predios, promedios clave).
2) Principales limitantes (acidez y aluminio, materia orgánica, fósforo, potasio, calcio y magnesio, micronutrientes): cuántos predios y qué porcentaje presentan cada una.
3) Predios más críticos: nombra hasta 10 beneficiarios con los suelos más limitantes y explica por qué en una frase cada uno.
4) Predios en mejor condición: nombra hasta 5 y por qué.
5) Recomendaciones generales de manejo (encalado, abono orgánico, plan de fertilización) coherentes con los planes de cada estudio.
6) Prioridades para el equipo técnico en campo.
Si se incluye el avance por técnico, agrega un párrafo breve sobre el avance frente a la meta.
Usa SOLO los datos recibidos, no inventes valores ni nombres. Escribe todo en español, sin palabras de otros idiomas. Sin markdown, sin viñetas, sin títulos.`;

/** DeepSeek a veces mete caracteres chinos/japoneses sueltos ("fuerte限制"): se quitan. */
const limpiarTextoIa = (t) => (t ? t.replace(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+/g, '').replace(/[ \t]{2,}/g, ' ').trim() : t);

const interpretarJson = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

/** Lectura con IA SOLO para PDF sin hoja de resumen (formato distinto). Se guarda en resumen_ia. */
async function leerConIaSinResumen(filas) {
  const porLeer = filas.filter((f) => f.tiene_archivo && f.datos?.formato !== 'resumen' && !f.resumen_ia);
  const lote = porLeer.filter((f) => f.datos?.textoResultados).slice(0, MAX_LECTURAS_POR_INFORME);
  for (const f of porLeer) if (!f.datos?.textoResultados) f.resumen_ia = 'Sin datos legibles en el PDF';
  if (!lote.length) return porLeer.length - lote.length - porLeer.filter((f) => !f.datos?.textoResultados).length;
  const respuesta = await deepseek.preguntar({
    sistema: SISTEMA_LECTURA,
    usuario: lote.map((f) => `--- item ${f.item} · ${f.nombre_completo} ---\n${f.datos.textoResultados}`).join('\n\n'),
    json: true,
    maxTokens: 3000,
    timeoutMs: 60000,
  });
  const json = respuesta && interpretarJson(respuesta);
  for (const r of Array.isArray(json?.beneficiarios) ? json.beneficiarios : []) {
    const f = lote.find((x) => x.item === r?.item);
    if (f && typeof r.resultado === 'string') {
      f.resumen_ia = r.resultado;
      await db.query('UPDATE analisis_suelos SET resumen_ia = $1 WHERE beneficiario_item = $2', [r.resultado, f.item]);
    }
  }
  return porLeer.filter((f) => !f.resumen_ia).length;
}

/** Línea compacta de un predio para el análisis global de la IA. */
function lineaPredio(f, conTecnico) {
  const d = f.datos;
  const cab = `- ${f.nombre_completo} (${f.vereda || 'sin vereda'}${conTecnico ? `; técnico ${f.tecnico_nombre}` : ''})`;
  if (d?.formato !== 'resumen') return `${cab}: ${f.resumen_ia || 'sin datos legibles'}`;
  const vars = d.variables.map((v) => `${v.etiqueta.replace(/\s*\(.*\)$/, '')} ${fmt(v.valor)} ${v.interpretacion}`).join('; ');
  return `${cab}: ${vars}; ${requiereEncalado(d) ? 'requiere encalado' : 'no requiere encalado'}`;
}

/** Datos del predio que van al informe (sin el texto crudo del PDF). */
const datosParaInforme = (d) => {
  if (!d) return null;
  const { textoResultados, error, ...resto } = d;
  return resto;
};

const consultaFilasInforme = (porTecnico) =>
  `SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
          u.usuario AS tecnico_usuario, u.nombre AS tecnico_nombre,
          (a.beneficiario_item IS NOT NULL) AS tiene_archivo,
          a.storage_key, a.datos, a.resumen_ia
   FROM beneficiarios b
   JOIN usuarios u ON u.id = b.tecnico_asignado_id AND u.rol = 'tecnico'
   LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item
   WHERE ${porTecnico ? 'u.id = $1' : `u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}`}
   ORDER BY u.nombre ASC, b.nombre_completo ASC`;

// POST /api/analisis-suelos/informe  body: { tecnico?: usuario }
//  · tecnico (rol técnico): su propio informe — ignora el body.
//  · superior con `tecnico`: informe de los beneficiarios de ese técnico.
//  · superior sin `tecnico`: informe de TODOS los predios con análisis.
// Cada predio: valores e interpretación del laboratorio, diagnóstico,
// preparación del sitio y observaciones del estudio (leídos del PDF, sin IA).
// Al final: estadísticas del conjunto + análisis global con IA.
// El informe completo queda guardado en analisis_suelos_informes (historial).
router.post('/informe', authenticateToken, async (req, res) => {
  try {
    const rol = req.user.rol;
    if (rol !== 'tecnico' && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    let tecnico = null;
    if (rol === 'tecnico') {
      tecnico = { id: req.user.id, usuario: req.user.usuario, nombre: req.user.nombre };
    } else if (req.body?.tecnico) {
      tecnico = await tecnicoPorUsuario(req.body.tecnico);
      if (!tecnico) return res.status(404).json({ estado: 'error', mensaje: 'Técnico no encontrado' });
    }

    const filas = await db.queryAll(consultaFilasInforme(!!tecnico), tecnico ? [tecnico.id] : []);
    await completarDatos(filas);
    const sinLeer = await leerConIaSinResumen(filas);
    const conArchivo = filas.filter((f) => f.tiene_archivo);
    const conDatos = conArchivo.filter((f) => f.datos?.formato === 'resumen');
    const estadisticas = estadisticasConjunto(conDatos);

    // Avance por técnico (solo en el informe de todos).
    let tecnicos = null;
    if (!tecnico) {
      const mapa = new Map();
      for (const f of filas) {
        const t = mapa.get(f.tecnico_usuario) || { usuario: f.tecnico_usuario, nombre: f.tecnico_nombre, asignados: 0, subidos: 0 };
        t.asignados += 1;
        if (f.tiene_archivo) t.subidos += 1;
        mapa.set(f.tecnico_usuario, t);
      }
      tecnicos = [...mapa.values()];
    }

    // Análisis global con IA (una sola llamada, con todos los predios).
    let analisis = null;
    if (conArchivo.length > 0) {
      const resumenEst =
        `Predios con estudio: ${conArchivo.length} (con datos completos: ${conDatos.length}). Requieren encalado: ${estadisticas.requierenEncalado}.\n` +
        estadisticas.variables
          .filter((v) => v.n)
          .map((v) => `${v.etiqueta}: promedio ${fmt(v.promedio)}, rango ${fmt(v.min)}–${fmt(v.max)}; ${Object.entries(v.conteos).map(([c, n]) => `${c} ${n}`).join(', ')}`)
          .join('\n');
      const avance = tecnicos
        ? `\n\nAVANCE POR TÉCNICO (meta ${META_ANALISIS} predios):\n` + tecnicos.map((t) => `${t.nombre}: ${t.subidos}/${t.asignados}`).join('\n')
        : '';
      analisis = limpiarTextoIa(await deepseek.preguntar({
        sistema: SISTEMA_GLOBAL,
        usuario:
          `${tecnico ? `Técnico: ${tecnico.nombre}. Beneficiarios asignados: ${filas.length}.` : 'Informe de todos los técnicos.'}\n\n` +
          `ESTADÍSTICAS DEL CONJUNTO:\n${resumenEst}${avance}\n\nPREDIOS:\n` +
          conArchivo.map((f) => lineaPredio(f, !tecnico)).join('\n'),
        maxTokens: 2500,
        timeoutMs: 85000,
      }));
    }

    const beneficiarios = (tecnico ? filas : conArchivo).map((f) => ({
      item: f.item,
      nombre: f.nombre_completo,
      cedula: f.cedula,
      corregimiento: f.corregimiento,
      vereda: f.vereda,
      tecnico: f.tecnico_nombre,
      tieneArchivo: !!f.tiene_archivo,
      datos: f.tiene_archivo ? datosParaInforme(f.datos) : null,
      diagnostico: f.tiene_archivo ? diagnosticoPredio(f.datos) : null,
      lecturaIa: f.tiene_archivo && f.datos?.formato !== 'resumen' ? f.resumen_ia || null : null,
      // Compatibilidad con versiones anteriores de la app (columna "Resultado").
      resultado: f.tiene_archivo ? f.datos?.observaciones || diagnosticoPredio(f.datos) || f.resumen_ia || null : null,
    }));

    const informe = {
      version: 2,
      alcance: tecnico ? 'tecnico' : 'tecnicos',
      tecnico: tecnico ? { usuario: tecnico.usuario, nombre: tecnico.nombre } : null,
      meta: META_ANALISIS,
      asignados: filas.length,
      subidos: conArchivo.length,
      total: conArchivo.length,
      tecnicos,
      estadisticas,
      analisis,
      sinLeer,
      beneficiarios,
    };

    const guardado = await db.queryOne(
      `INSERT INTO analisis_suelos_informes
         (alcance, tecnico_usuario, tecnico_nombre, generado_por, generado_por_nombre, generado_por_rol, beneficiarios_con_analisis, datos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [informe.alcance, tecnico?.usuario || null, tecnico?.nombre || null, req.user.id, req.user.nombre || req.user.usuario, rol, conArchivo.length, JSON.stringify(informe)]
    );
    const meta = { id: guardado.id, creadoEn: guardado.created_at, generadoPor: req.user.nombre || req.user.usuario, generadoPorRol: rol };
    // El PDF se imprime aquí mismo y queda guardado: el historial devuelve ese archivo.
    await guardarPdfInforme(guardado.id, { ...informe, informe: meta });
    res.json({ estado: 'ok', ...informe, informe: meta });
  } catch (error) {
    console.error('[AnalisisSuelos] Error en informe:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al generar el informe' });
  }
});

/** Imprime el PDF del informe, lo sube a MinIO y anota la llave en el historial. */
async function guardarPdfInforme(id, informeCompleto) {
  const pdf = await generarPdfInforme(informeCompleto);
  await storage.ensureBucket();
  const key = `informes/AnalisisSuelos/informe_${id}.pdf`;
  await storage.minioClient.putObject(storage.CONFIG.bucket, key, pdf, null, { 'Content-Type': 'application/pdf' });
  await db.query('UPDATE analisis_suelos_informes SET pdf_key = $1, pdf_size = $2 WHERE id = $3', [key, pdf.length, id]);
  return key;
}

const nombrePdfInforme = (r) => {
  const base =
    r.alcance === 'tecnico' && r.tecnico_nombre
      ? `Analisis_Suelos_${r.tecnico_nombre.replace(/\s+/g, '_')}`
      : 'Analisis_Suelos_Todos';
  return `${base}_N${r.id}_${new Date(r.created_at).toISOString().slice(0, 10)}.pdf`;
};

// ─── Historial de informes ──────────────────────────────────
// Técnico: solo los informes de sus propios beneficiarios.
// Superiores: todos.

const filtroHistorial = (user) =>
  user.rol === 'tecnico'
    ? { sql: "alcance = 'tecnico' AND tecnico_usuario = $1", params: [user.usuario] }
    : { sql: 'TRUE', params: [] };

// GET /api/analisis-suelos/informes
router.get('/informes', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const f = filtroHistorial(req.user);
    const filas = await db.queryAll(
      `SELECT id, alcance, tecnico_nombre, generado_por_nombre, generado_por_rol, beneficiarios_con_analisis, created_at,
              (datos->>'analisis') IS NOT NULL AS con_ia
       FROM analisis_suelos_informes WHERE ${f.sql}
       ORDER BY created_at DESC LIMIT 200`,
      f.params
    );
    res.json({
      estado: 'ok',
      informes: filas.map((r) => ({
        id: r.id,
        alcance: r.alcance,
        tecnicoNombre: r.tecnico_nombre,
        generadoPor: r.generado_por_nombre,
        generadoPorRol: r.generado_por_rol,
        beneficiariosConAnalisis: r.beneficiarios_con_analisis,
        conIa: r.con_ia,
        creadoEn: r.created_at,
      })),
    });
  } catch (error) {
    console.error('[AnalisisSuelos] Error listando historial:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar el historial' });
  }
});

// GET /api/analisis-suelos/informes/:id/pdf — el PDF guardado (acepta ?token= para web).
// Un informe sin PDF guardado (anterior a este cambio) se imprime una vez y queda guardado.
router.get('/informes/:id/pdf', authenticateTokenOrQuery, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Informe inválido' });
    const f = filtroHistorial(req.user);
    const r = await db.queryOne(
      `SELECT * FROM analisis_suelos_informes WHERE id = $${f.params.length + 1} AND ${f.sql}`,
      [...f.params, id]
    );
    if (!r) return res.status(404).json({ estado: 'error', mensaje: 'Informe no encontrado' });
    let key = r.pdf_key;
    if (!key || !(await storage.statFile(key))) {
      key = await guardarPdfInforme(r.id, {
        ...r.datos,
        informe: { id: r.id, creadoEn: r.created_at, generadoPor: r.generado_por_nombre, generadoPorRol: r.generado_por_rol },
      });
    }
    const stat = await storage.statFile(key);
    const stream = stat && (await storage.getFileStream(key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="${nombrePdfInforme(r)}"`);
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[AnalisisSuelos] Error con el PDF del informe:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el PDF del informe' });
  }
});

// GET /api/analisis-suelos/informes/:id — el informe guardado, tal cual se generó
router.get('/informes/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Informe inválido' });
    const f = filtroHistorial(req.user);
    const r = await db.queryOne(
      `SELECT * FROM analisis_suelos_informes WHERE id = $${f.params.length + 1} AND ${f.sql}`,
      [...f.params, id]
    );
    if (!r) return res.status(404).json({ estado: 'error', mensaje: 'Informe no encontrado' });
    res.json({
      estado: 'ok',
      ...r.datos,
      informe: { id: r.id, creadoEn: r.created_at, generadoPor: r.generado_por_nombre, generadoPorRol: r.generado_por_rol },
    });
  } catch (error) {
    console.error('[AnalisisSuelos] Error abriendo informe:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al abrir el informe' });
  }
});

// DELETE /api/analisis-suelos/informes/:id — solo admin: borra un informe del historial
router.delete('/informes/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el administrador puede eliminar informes' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Informe inválido' });
    const r = await db.queryOne('DELETE FROM analisis_suelos_informes WHERE id = $1 RETURNING id, pdf_key', [id]);
    if (!r) return res.status(404).json({ estado: 'error', mensaje: 'Informe no encontrado' });
    // También el PDF guardado en MinIO, para no dejar archivos sueltos.
    if (r.pdf_key) await storage.deleteFile(r.pdf_key).catch(() => {});
    res.json({ estado: 'ok', id: r.id });
  } catch (error) {
    console.error('[AnalisisSuelos] Error eliminando informe:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el informe' });
  }
});

module.exports = router;
