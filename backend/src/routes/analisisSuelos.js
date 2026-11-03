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

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const deepseek = require('../lib/deepseek');
const { sqlNoEsPrueba } = require('../lib/usuariosPrueba');
const { sqlCteCaracterizacion, sqlCedulaNormalizada } = require('../lib/visitas');

const router = express.Router();

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
/** Meta del proyecto: un análisis por predio, 300 predios. */
const META_ANALISIS = 300;
/** Texto máximo de cada PDF que se le pasa a la IA. */
const MAX_CHARS_POR_PDF = 2500;
/** PDF que se leen con la IA en una sola petición. */
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

    // resumen_ia = NULL: el PDF cambió, la lectura anterior ya no vale.
    await db.query(
      `INSERT INTO analisis_suelos (beneficiario_item, tecnico_id, storage_key, nombre_archivo, tamano, subido_por)
       VALUES ($1, $2, $3, $4, $5, $2)
       ON CONFLICT (beneficiario_item) DO UPDATE SET
         tecnico_id = EXCLUDED.tecnico_id, storage_key = EXCLUDED.storage_key,
         nombre_archivo = EXCLUDED.nombre_archivo, tamano = EXCLUDED.tamano,
         resumen_ia = NULL, updated_at = NOW()`,
      [b.item, req.user.id, key, String(req.file.originalname || 'analisis.pdf').slice(0, 255), req.file.size]
    );
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

// ─── Informe con IA ─────────────────────────────────────────

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch {
  console.warn('[AnalisisSuelos] pdf-parse no instalado: la IA no podrá leer el contenido de los PDF');
}

async function textoDelPdf(storageKey) {
  if (!pdfParse) return '';
  try {
    const stream = await storage.getFileStream(storageKey);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const { text } = await pdfParse(Buffer.concat(chunks));
    return String(text || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_CHARS_POR_PDF);
  } catch (err) {
    console.warn('[AnalisisSuelos] No se pudo leer el PDF', storageKey, err.message);
    return '';
  }
}

const SISTEMA_BENEFICIARIOS = `Eres un ingeniero agrónomo que revisa resultados de laboratorio de análisis de suelos de predios cacaoteros (proyecto de extensión rural, Puerto Rico, Caquetá). Recibirás el texto extraído de cada PDF de laboratorio, identificado por "item".
Responde SOLO un JSON: {"general": string, "beneficiarios": [{"item": number, "resultado": string}]}.
- "resultado": 1 a 2 frases con los valores clave (pH, materia orgánica, fósforo, potasio, aluminio, etc., los que aparezcan) y su interpretación para cacao (adecuado / bajo / alto / ácido…). Si el texto no trae datos legibles, escribe exactamente "Sin datos legibles en el PDF".
- Si se te dan "LECTURAS YA HECHAS", son resultados ya interpretados: inclúyelos en el panorama general pero NO los repitas en "beneficiarios" (ahí solo van los "PDF POR LEER").
- "general": 2 a 3 párrafos cortos (separados por \\n\\n) con el panorama del conjunto: tendencias, problemas comunes y recomendaciones generales.
No inventes valores que no estén en el texto. Sin markdown ni viñetas.`;

const SISTEMA_TECNICOS = `Eres un ingeniero agrónomo que redacta el análisis gerencial del avance de los análisis de suelos de un proyecto cacaotero (meta: un análisis por predio, 300 predios). Recibirás el avance por técnico y, cuando existan, lecturas breves de los resultados de sus beneficiarios.
Escribe de 2 a 4 párrafos cortos en español, separados por una línea en blanco: avance global frente a la meta, comparación entre técnicos (quién va adelantado o rezagado), y hallazgos agronómicos comunes si hay lecturas. No inventes datos, no repitas la tabla, sin markdown ni viñetas.`;

const interpretarJson = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

// POST /api/analisis-suelos/informe  body: { tecnico?: usuario }
//  · tecnico (rol técnico): su propio informe — ignora el body.
//  · superior con `tecnico`: informe de los beneficiarios de ese técnico.
//  · superior sin `tecnico`: informe comparativo de todos los técnicos.
// Devuelve los datos + el texto de la IA (analisis = null si la IA no está
// disponible: el cliente genera el PDF igual).
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

    // ── Informe de UN técnico: lee los PDF de sus beneficiarios ──
    if (tecnico) {
      const filas = await beneficiariosDeTecnico(tecnico.id);
      const conPdf = filas.filter((f) => f.tiene_archivo);
      // Por la asignación ACTUAL del beneficiario, no por quién subió el PDF:
      // si se reasignó, el PDF sigue siendo de este predio.
      const claves = await db.queryAll(
        `SELECT a.beneficiario_item, a.storage_key FROM analisis_suelos a
         JOIN beneficiarios b ON b.item = a.beneficiario_item
         WHERE b.tecnico_asignado_id = $1`,
        [tecnico.id]
      );
      const llave = new Map(claves.map((c) => [c.beneficiario_item, c.storage_key]));

      // Las lecturas ya guardadas (resumen_ia) se reutilizan: solo se lee con la
      // IA lo que aún no tiene lectura, y a lo sumo MAX_LECTURAS_POR_INFORME por
      // vez (el túnel corta las peticiones de más de ~100 s). Lo que quede se
      // lee al generar el informe otra vez.
      const lecturas = {};
      const previas = [];
      const textos = [];
      let sinLeer = 0;
      for (const f of conPdf) {
        if (f.resumen_ia) {
          lecturas[f.item] = f.resumen_ia;
          previas.push({ item: f.item, nombre: f.nombre_completo, resultado: f.resumen_ia });
          continue;
        }
        if (textos.length >= MAX_LECTURAS_POR_INFORME) {
          sinLeer += 1;
          continue;
        }
        const t = await textoDelPdf(llave.get(f.item));
        if (t) textos.push({ item: f.item, nombre: f.nombre_completo, vereda: f.vereda, texto: t });
        else lecturas[f.item] = 'Sin datos legibles en el PDF';
      }

      let analisis = null;
      if (textos.length > 0 || previas.length > 0) {
        const nuevos = textos
          .map((t) => `--- item ${t.item} · ${t.nombre} (${t.vereda}) ---\n${t.texto}`)
          .join('\n\n');
        const leidos = previas
          .map((p) => `- item ${p.item} · ${p.nombre}: ${p.resultado}`)
          .join('\n');
        const respuesta = await deepseek.preguntar({
          sistema: SISTEMA_BENEFICIARIOS,
          usuario:
            `Técnico: ${tecnico.nombre}\nBeneficiarios con PDF: ${conPdf.length} de ${filas.length}\n\n` +
            (leidos ? `LECTURAS YA HECHAS (no las repitas en "beneficiarios", úsalas para el panorama general):\n${leidos}\n\n` : '') +
            (nuevos ? `PDF POR LEER:\n${nuevos}` : ''),
          json: true,
          maxTokens: 3000,
          timeoutMs: 85000,
        });
        const json = respuesta && interpretarJson(respuesta);
        if (json) {
          analisis = typeof json.general === 'string' ? json.general : null;
          for (const r of Array.isArray(json.beneficiarios) ? json.beneficiarios : []) {
            if (r && textos.some((t) => t.item === r.item) && typeof r.resultado === 'string') {
              lecturas[r.item] = r.resultado;
              await db.query('UPDATE analisis_suelos SET resumen_ia = $1 WHERE beneficiario_item = $2', [r.resultado, r.item]);
            }
          }
        }
      }

      return res.json({
        estado: 'ok',
        alcance: 'tecnico',
        tecnico: { usuario: tecnico.usuario, nombre: tecnico.nombre },
        meta: META_ANALISIS,
        asignados: filas.length,
        subidos: conPdf.length,
        analisis,
        sinLeer,
        beneficiarios: filas.map((f) => ({ ...aBeneficiarioDto(f), resultado: lecturas[f.item] || f.resumen_ia || null })),
      });
    }

    // ── Informe de TODOS los técnicos: avance + lecturas ya cacheadas ──
    const tecnicos = await db.queryAll(
      `SELECT u.usuario, u.nombre,
              COUNT(b.item)::int AS asignados,
              COUNT(a.beneficiario_item)::int AS subidos
       FROM usuarios u
       LEFT JOIN beneficiarios b ON b.tecnico_asignado_id = u.id
       LEFT JOIN analisis_suelos a ON a.beneficiario_item = b.item
       WHERE u.rol = 'tecnico' AND u.activo = TRUE AND ${sqlNoEsPrueba('u.usuario')}
       GROUP BY u.usuario, u.nombre ORDER BY u.nombre`
    );
    const total = tecnicos.reduce((s, t) => s + t.subidos, 0);
    const cacheadas = await db.queryAll(
      `SELECT u.usuario, a.resumen_ia FROM analisis_suelos a
       JOIN beneficiarios b ON b.item = a.beneficiario_item
       JOIN usuarios u ON u.id = b.tecnico_asignado_id WHERE a.resumen_ia IS NOT NULL`
    );
    const lecturasPorTecnico = new Map();
    for (const c of cacheadas) {
      if (!lecturasPorTecnico.has(c.usuario)) lecturasPorTecnico.set(c.usuario, []);
      lecturasPorTecnico.get(c.usuario).push(c.resumen_ia);
    }
    const entrada = tecnicos
      .map((t) => {
        const l = (lecturasPorTecnico.get(t.usuario) || []).slice(0, 8).map((x) => `  · ${x.slice(0, 220)}`);
        return `${t.nombre}: ${t.subidos}/${t.asignados} análisis subidos${l.length ? `\n${l.join('\n')}` : ''}`;
      })
      .join('\n');
    const analisis = await deepseek.preguntar({
      sistema: SISTEMA_TECNICOS,
      usuario: `Meta: ${META_ANALISIS}. Subidos en total: ${total}.\n\n${entrada}`,
      maxTokens: 900,
      timeoutMs: 60000,
    });

    res.json({ estado: 'ok', alcance: 'tecnicos', meta: META_ANALISIS, total, tecnicos, analisis });
  } catch (error) {
    console.error('[AnalisisSuelos] Error en informe:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al generar el informe' });
  }
});

module.exports = router;
