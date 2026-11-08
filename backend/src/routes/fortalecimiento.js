// ============================================================
// GEODAILY — Fortalecimiento de Capacidades en Cacao Sostenible
// ============================================================
// Componente "ECAS": 7 ECAs × 7 grupos de veredas × 4 secciones:
//   protocolo            → PDF
//   informes             → PDF
//   listado_asistencia   → PDF o foto
//   registro_fotografico → foto
// Los archivos son compartidos por grupo (no por técnico ni por beneficiario)
// y viven en MinIO bajo actividades/Fortalecimiento_Capacidades/... (ver
// lib/fortalecimiento.js). Todos los roles ven; técnicos y admin suben; quien
// subió el archivo o un admin lo elimina.
// ============================================================

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const { SECCIONES, ecaValida, grupoValido, prefijoSeccion } = require('../lib/fortalecimiento');

const router = express.Router();

const ROLES_SUBEN = ['tecnico', 'admin'];
const MAX_MB = 50;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

/** Tipo real por la cabecera del archivo (no se confía en el mimetype del cliente). */
function detectarTipo(buf) {
  if (buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { clase: 'pdf', ext: '.pdf', mime: 'application/pdf' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { clase: 'imagen', ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { clase: 'imagen', ext: '.png', mime: 'image/png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { clase: 'imagen', ext: '.webp', mime: 'image/webp' };
  return null;
}

/** Nombre legible y seguro para MinIO, conservando la extensión real. */
function nombreObjeto(original, ext) {
  const base = String(original || 'archivo').replace(/\.[^.]*$/, '');
  const limpio = storage.sanitizeFolderName(base).slice(0, 60) || 'archivo';
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  return `${sello}_${Math.random().toString(36).slice(2, 6)}_${limpio}${ext}`;
}

/** Valida :eca y :grupo de la URL. Responde y devuelve null si algo falla. */
function ubicacion(req, res) {
  const eca = ecaValida(req.params.eca);
  const grupo = grupoValido(req.params.grupo);
  if (!eca || !grupo) {
    res.status(404).json({ estado: 'error', mensaje: 'ECA o grupo no encontrado' });
    return null;
  }
  return { eca, grupo };
}

const aArchivo = (f) => ({
  id: f.id,
  nombre: f.nombre_archivo,
  tipo: f.mime === 'application/pdf' ? 'pdf' : 'imagen',
  tamano: f.tamano,
  subidoPor: f.subido_por_nombre || f.subido_por_usuario,
  fecha: f.created_at,
});

// GET /api/fortalecimiento/ecas/resumen → { conteos: { "1": { "2": 5 } } } (archivos por ECA y grupo)
router.get('/ecas/resumen', authenticateToken, async (_req, res) => {
  try {
    const filas = await db.queryAll(
      `SELECT eca, grupo, COUNT(*)::int AS n FROM fortalecimiento_archivos
       WHERE componente = 'ecas' GROUP BY eca, grupo`
    );
    const conteos = {};
    for (const f of filas) {
      conteos[f.eca] = conteos[f.eca] || {};
      conteos[f.eca][f.grupo] = f.n;
    }
    res.json({ estado: 'ok', conteos });
  } catch (error) {
    console.error('[Fortalecimiento] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cargar el resumen' });
  }
});

// GET /api/fortalecimiento/archivo/:id — cualquier rol (acepta ?token= para web)
router.get('/archivo/:id', authenticateTokenOrQuery, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Archivo inválido' });
    const f = await db.queryOne('SELECT storage_key, nombre_archivo, mime FROM fortalecimiento_archivos WHERE id = $1', [id]);
    if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no encontrado' });
    const stat = await storage.statFile(f.storage_key);
    const stream = stat && (await storage.getFileStream(f.storage_key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });

    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.nombre_archivo || 'archivo')}"`);
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[Fortalecimiento] Error al descargar:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
  }
});

// DELETE /api/fortalecimiento/archivo/:id — quien lo subió o admin
router.delete('/archivo/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Archivo inválido' });
    const f = await db.queryOne('SELECT id, storage_key, subido_por FROM fortalecimiento_archivos WHERE id = $1', [id]);
    if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no encontrado' });
    if (f.subido_por !== req.user.id && req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo quien subió el archivo o un administrador puede eliminarlo' });
    }
    await storage.deleteFile(f.storage_key);
    await db.query('DELETE FROM fortalecimiento_archivos WHERE id = $1', [f.id]);
    res.json({ estado: 'ok', mensaje: 'Archivo eliminado' });
  } catch (error) {
    console.error('[Fortalecimiento] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el archivo' });
  }
});

// GET /api/fortalecimiento/ecas/:eca/:grupo → { secciones: { protocolo: [...], ... } }
router.get('/ecas/:eca/:grupo', authenticateToken, async (req, res) => {
  try {
    const u = ubicacion(req, res);
    if (!u) return;
    const filas = await db.queryAll(
      `SELECT f.id, f.seccion, f.nombre_archivo, f.mime, f.tamano, f.subido_por, f.created_at,
              us.nombre AS subido_por_nombre, us.usuario AS subido_por_usuario
       FROM fortalecimiento_archivos f
       LEFT JOIN usuarios us ON us.id = f.subido_por
       WHERE f.componente = 'ecas' AND f.eca = $1 AND f.grupo = $2
       ORDER BY f.created_at ASC, f.id ASC`,
      [u.eca, u.grupo]
    );
    const secciones = Object.fromEntries(Object.keys(SECCIONES).map((s) => [s, []]));
    for (const f of filas) {
      if (!secciones[f.seccion]) continue;
      secciones[f.seccion].push({ ...aArchivo(f), puedeEliminar: f.subido_por === req.user.id || req.user.rol === 'admin' });
    }
    res.json({ estado: 'ok', puedeSubir: ROLES_SUBEN.includes(req.user.rol), secciones });
  } catch (error) {
    console.error('[Fortalecimiento] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cargar los archivos' });
  }
});

// POST /api/fortalecimiento/ecas/:eca/:grupo/:seccion — técnico o admin (multipart: archivo)
router.post('/ecas/:eca/:grupo/:seccion', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    const u = ubicacion(req, res);
    if (!u) return;
    if (!ROLES_SUBEN.includes(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Tu rol no puede subir archivos aquí' });
    }
    const seccion = SECCIONES[req.params.seccion];
    if (!seccion) return res.status(400).json({ estado: 'error', mensaje: 'Sección inválida' });
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });

    const tipo = detectarTipo(req.file.buffer);
    if (!tipo || !seccion.admite.includes(tipo.clase)) {
      const esperado = seccion.admite.length === 2 ? 'un PDF o una foto (JPG, PNG o WEBP)' : seccion.admite[0] === 'pdf' ? 'un PDF' : 'una foto (JPG, PNG o WEBP)';
      return res.status(400).json({ estado: 'error', mensaje: `El archivo debe ser ${esperado}` });
    }

    await storage.ensureBucket();
    const key = `${prefijoSeccion(u.eca, u.grupo, req.params.seccion)}/${nombreObjeto(req.file.originalname, tipo.ext)}`;
    await storage.minioClient.putObject(storage.CONFIG.bucket, key, req.file.buffer, req.file.size, {
      'Content-Type': tipo.mime,
      // Sanitizado a ASCII: un valor con "ñ" rompe la firma V4 (SignatureDoesNotMatch).
      'X-Amz-Meta-Uploaded-By': storage.sanitizarMetadata(req.user.usuario),
      'X-Amz-Meta-Rol': storage.sanitizarMetadata(req.user.rol),
    });

    let fila;
    try {
      fila = await db.queryOne(
        `INSERT INTO fortalecimiento_archivos (componente, eca, grupo, seccion, storage_key, nombre_archivo, mime, tamano, subido_por)
         VALUES ('ecas', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [u.eca, u.grupo, req.params.seccion, key, String(req.file.originalname || 'archivo').slice(0, 255), tipo.mime, req.file.size, req.user.id]
      );
    } catch (e) {
      // Sin fila en la BD el objeto quedaría huérfano en MinIO.
      await storage.deleteFile(key).catch(() => {});
      throw e;
    }
    console.log(`[Fortalecimiento] ✅ ${req.user.usuario} subió ${key}`);
    res.json({ estado: 'ok', id: fila.id });
  } catch (error) {
    console.error('[Fortalecimiento] Error al subir:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir el archivo' });
  }
});

module.exports = router;
