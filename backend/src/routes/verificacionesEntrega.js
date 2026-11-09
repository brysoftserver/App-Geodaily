// ============================================================
// Verificación de Entregas (interventoría)
// ============================================================
// Recepción y verificación de material vegetal. El interventor diligencia el
// formulario en campo (offline-first): los borradores viven solo en su
// teléfono; al completar, la app sube primero fotos y firmas y luego el
// registro.
//   POST /:id/archivos   foto (multipart `archivo`), SIN marca de agua
//   POST /:id/firmas     firma como data URI
//   POST /sync           UPSERT de verificaciones completadas
//   GET  /               las verificaciones del usuario (admin: todas)
//   GET  /archivos/:id   descarga de una foto o firma
// MinIO: interventores/{usuario}/Verificaciones_Entrega/{Material}/{id}/{fotos|firmas}/
// ============================================================

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/** Material → subcarpeta en MinIO. */
const MATERIALES = {
  colinos_platano: 'Colinos_Platano',
  plantulas_cacao: 'Plantulas_Cacao',
  plantulas_maderables: 'Plantulas_Maderables',
};
const ROLES_ESCRIBEN = ['interventor'];
const ROLES_LEEN_TODO = ['admin'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const idValido = (id) => /^[A-Za-z0-9_-]{6,100}$/.test(String(id || ''));
const limpio = (t, max = 100) => String(t || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, max);

function detectarImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

const soloEscritores = (req, res, next) => {
  if (!ROLES_ESCRIBEN.includes(req.user?.rol)) {
    return res.status(403).json({ estado: 'error', mensaje: 'Solo interventoría registra verificaciones de entrega' });
  }
  next();
};

/** Valida id y material, y que la verificación (si ya existe) sea del usuario. Responde y devuelve null si no. */
async function prepararArchivo(req, res) {
  const id = req.params.id;
  if (!idValido(id)) {
    res.status(400).json({ estado: 'error', mensaje: 'Verificación inválida' });
    return null;
  }
  const material = String(req.body?.material || '');
  if (!MATERIALES[material]) {
    res.status(400).json({ estado: 'error', mensaje: 'Material inválido' });
    return null;
  }
  const existente = await db.queryOne('SELECT autor_id, material FROM verificaciones_entrega WHERE id = $1', [id]);
  if (existente && existente.autor_id !== req.user.id) {
    res.status(403).json({ estado: 'error', mensaje: 'Esta verificación pertenece a otro usuario' });
    return null;
  }
  const clienteId = limpio(req.body?.cliente_id);
  if (!clienteId) {
    res.status(400).json({ estado: 'error', mensaje: 'Falta el identificador del archivo' });
    return null;
  }
  const base = `${storage.getUserBasePath(req.user.rol, req.user.usuario)}/Verificaciones_Entrega/${MATERIALES[existente?.material || material]}/${id}`;
  return { id, clienteId, campo: limpio(req.body?.campo, 40) || 'general', base };
}

/** Guarda el objeto y su registro (idempotente por verificación + cliente_id). */
async function guardarArchivo({ id, clienteId, campo, key, buffer, mime, tipo, autorId }) {
  await storage.ensureBucket();
  await storage.minioClient.putObject(storage.CONFIG.bucket, key, buffer, null, { 'Content-Type': mime });
  const fila = await db.queryOne(
    `INSERT INTO verificaciones_entrega_archivos (verificacion_id, cliente_id, campo, tipo, storage_key, autor_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (verificacion_id, cliente_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, campo = EXCLUDED.campo
     RETURNING id`,
    [id, clienteId, campo, tipo, key, autorId]
  );
  return fila.id;
}

// POST /api/verificaciones-entrega/:id/archivos — foto (multipart), sin marca de agua
router.post('/:id/archivos', authenticateToken, soloEscritores, upload.single('archivo'), async (req, res) => {
  try {
    const p = await prepararArchivo(req, res);
    if (!p) return;
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    const img = detectarImagen(req.file.buffer);
    if (!img) return res.status(400).json({ estado: 'error', mensaje: 'El archivo debe ser una imagen (JPG, PNG o WEBP)' });
    const key = `${p.base}/fotos/${p.campo}_${p.clienteId}${img.ext}`;
    const archivoId = await guardarArchivo({ ...p, key, buffer: req.file.buffer, mime: img.mime, tipo: 'foto', autorId: req.user.id });
    res.json({ estado: 'ok', id: archivoId });
  } catch (error) {
    console.error('[VerifEntrega] Error al subir foto:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir la foto' });
  }
});

// POST /api/verificaciones-entrega/:id/firmas — { material, cliente_id, campo, dataUri }
router.post('/:id/firmas', authenticateToken, soloEscritores, async (req, res) => {
  try {
    const p = await prepararArchivo(req, res);
    if (!p) return;
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/s.exec(String(req.body?.dataUri || ''));
    if (!m) return res.status(400).json({ estado: 'error', mensaje: 'La firma debe llegar como imagen' });
    const buffer = Buffer.from(m[2], 'base64');
    const img = detectarImagen(buffer);
    if (!img) return res.status(400).json({ estado: 'error', mensaje: 'La firma no es una imagen válida' });
    const key = `${p.base}/firmas/firma_${p.campo}${img.ext}`;
    const archivoId = await guardarArchivo({ ...p, key, buffer, mime: img.mime, tipo: 'firma', autorId: req.user.id });
    res.json({ estado: 'ok', id: archivoId });
  } catch (error) {
    console.error('[VerifEntrega] Error al subir firma:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir la firma' });
  }
});

// POST /api/verificaciones-entrega/sync — { verificaciones: [{ id, material, datos, created_at }] }
router.post('/sync', authenticateToken, soloEscritores, async (req, res) => {
  try {
    const lista = Array.isArray(req.body?.verificaciones) ? req.body.verificaciones : null;
    if (!lista) return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de verificaciones' });
    let sincronizadas = 0;
    const rechazadas = [];
    for (const v of lista) {
      if (!idValido(v?.id) || !MATERIALES[v?.material] || !v?.datos || typeof v.datos !== 'object') {
        rechazadas.push({ id: v?.id, motivo: 'Datos inválidos' });
        continue;
      }
      const existente = await db.queryOne('SELECT autor_id FROM verificaciones_entrega WHERE id = $1', [v.id]);
      if (existente && existente.autor_id !== req.user.id) {
        rechazadas.push({ id: v.id, motivo: 'Pertenece a otro usuario' });
        continue;
      }
      await db.query(
        `INSERT INTO verificaciones_entrega (id, material, autor_id, autor_nombre, autor_usuario, datos, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos, updated_at = NOW()`,
        [v.id, v.material, req.user.id, req.user.nombre || req.user.usuario, req.user.usuario, JSON.stringify(v.datos), v.created_at || null]
      );
      sincronizadas++;
    }
    res.json({ estado: 'ok', sincronizadas, rechazadas });
  } catch (error) {
    console.error('[VerifEntrega] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar verificaciones' });
  }
});

// GET /api/verificaciones-entrega?material=colinos_platano
router.get('/', authenticateToken, async (req, res) => {
  try {
    const cond = [];
    const vals = [];
    if (req.query.material) {
      if (!MATERIALES[req.query.material]) return res.status(400).json({ estado: 'error', mensaje: 'Material inválido' });
      vals.push(req.query.material);
      cond.push(`material = $${vals.length}`);
    }
    if (!ROLES_LEEN_TODO.includes(req.user.rol)) {
      vals.push(req.user.id);
      cond.push(`autor_id = $${vals.length}`);
    }
    const filas = await db.queryAll(
      `SELECT id, material, autor_nombre, datos, created_at, updated_at
       FROM verificaciones_entrega ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY created_at DESC`,
      vals
    );
    res.json({ estado: 'ok', verificaciones: filas });
  } catch (error) {
    console.error('[VerifEntrega] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar verificaciones' });
  }
});

// GET /api/verificaciones-entrega/archivos/:archivoId — autor o admin (acepta ?token= para web)
router.get('/archivos/:archivoId', authenticateTokenOrQuery, async (req, res) => {
  try {
    const archivoId = parseInt(req.params.archivoId, 10);
    if (!Number.isInteger(archivoId)) return res.status(400).json({ estado: 'error', mensaje: 'Archivo inválido' });
    const a = await db.queryOne('SELECT storage_key, autor_id FROM verificaciones_entrega_archivos WHERE id = $1', [archivoId]);
    if (!a) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no encontrado' });
    if (a.autor_id !== req.user.id && !ROLES_LEEN_TODO.includes(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const stat = await storage.statFile(a.storage_key);
    const stream = stat && (await storage.getFileStream(a.storage_key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });
    const k = a.storage_key.toLowerCase();
    res.setHeader('Content-Type', k.endsWith('.png') ? 'image/png' : k.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[VerifEntrega] Error al descargar:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
  }
});

module.exports = router;
