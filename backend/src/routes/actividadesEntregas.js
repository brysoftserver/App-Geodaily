// ============================================================
// Entregas de una actividad (técnico)
// ============================================================
// Ej.: Siembra de Plátano → Entrega de Colinos → Entrega 1, Entrega 2…
// Cada entrega guarda el lugar, el beneficiario, la instancia de su acta
// (formato acta_entrega_individual en otros_formatos, con actividadId) y sus
// fotos. Offline-first: el teléfono sube primero las fotos y luego el registro.
//   POST /:id/fotos   foto (multipart `archivo`)
//   POST /sync        UPSERT de entregas del técnico
//   GET  /            entregas (técnico: las suyas; roles superiores: todas)
//   GET  /fotos/:id   descarga de una foto
// MinIO: tecnicos/{usuario}/{item}_{Nombre}/{actividad}/entregas/entrega_{n}/fotos/
//        (sin beneficiario aún: tecnicos/{usuario}/{actividad}/entregas/entrega_{n}/fotos/)
// ============================================================

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

// Actividades con entregas (cada una con su Acta de Entrega). Ver SUBACTIVIDADES en src/data/actividades.ts.
const ACTIVIDADES = new Set(['siembra_platano', 'siembra_forestales', 'siembra_cacao']);
const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
const esSuperior = (u) => ROLES_SUPERIORES.includes(u?.rol);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const idValido = (id) => /^[A-Za-z0-9_-]{6,100}$/.test(String(id || ''));
const limpio = (t, max = 100) => String(t || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);

function detectarImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

const soloTecnico = (req, res, next) => {
  if (req.user?.rol !== 'tecnico') return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico registra entregas' });
  next();
};

// POST /api/actividades-entregas/:id/fotos — { actividad, numero, beneficiario_item?, cliente_id } + archivo
router.post('/:id/fotos', authenticateToken, soloTecnico, upload.single('archivo'), async (req, res) => {
  try {
    const id = req.params.id;
    const actividad = String(req.body?.actividad || '');
    const numero = parseInt(req.body?.numero, 10);
    const clienteId = limpio(req.body?.cliente_id);
    if (!idValido(id) || !ACTIVIDADES.has(actividad) || !Number.isInteger(numero) || numero < 1 || !clienteId) {
      return res.status(400).json({ estado: 'error', mensaje: 'Datos de la entrega inválidos' });
    }
    const existente = await db.queryOne('SELECT tecnico_id FROM actividad_entregas WHERE id = $1', [id]);
    if (existente && existente.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'Esta entrega pertenece a otro técnico' });
    }
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    const img = detectarImagen(req.file.buffer);
    if (!img) return res.status(400).json({ estado: 'error', mensaje: 'El archivo debe ser una imagen (JPG, PNG o WEBP)' });

    // Carpeta del beneficiario si es uno de los asignados al técnico; si no, la del técnico.
    let base = `${storage.getUserBasePath('tecnico', req.user.usuario)}`;
    const item = parseInt(req.body?.beneficiario_item, 10);
    if (Number.isInteger(item)) {
      const b = await db.queryOne('SELECT item, nombre_completo, tecnico_asignado_id FROM beneficiarios WHERE item = $1', [item]);
      if (b && b.tecnico_asignado_id === req.user.id) base += `/${storage.getBeneficiarySubpath(b.item, b.nombre_completo)}`;
    }
    const key = `${base}/${actividad}/entregas/entrega_${numero}/fotos/${clienteId}${img.ext}`;

    await storage.ensureBucket();
    await storage.minioClient.putObject(storage.CONFIG.bucket, key, req.file.buffer, null, { 'Content-Type': img.mime });
    const fila = await db.queryOne(
      `INSERT INTO actividad_entregas_fotos (entrega_id, cliente_id, storage_key, tecnico_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (entrega_id, cliente_id) DO UPDATE SET storage_key = EXCLUDED.storage_key
       RETURNING id`,
      [id, clienteId, key, req.user.id]
    );
    res.json({ estado: 'ok', id: fila.id });
  } catch (error) {
    console.error('[Entregas] Error al subir foto:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir la foto' });
  }
});

// POST /api/actividades-entregas/sync — { entregas: [{ id, actividad, numero, datos, created_at }] }
router.post('/sync', authenticateToken, soloTecnico, async (req, res) => {
  try {
    const lista = Array.isArray(req.body?.entregas) ? req.body.entregas : null;
    if (!lista) return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de entregas' });
    let sincronizadas = 0;
    const rechazadas = [];
    for (const e of lista) {
      const numero = parseInt(e?.numero, 10);
      if (!idValido(e?.id) || !ACTIVIDADES.has(e?.actividad) || !Number.isInteger(numero) || numero < 1 || !e?.datos || typeof e.datos !== 'object') {
        rechazadas.push({ id: e?.id, motivo: 'Datos inválidos' });
        continue;
      }
      const existente = await db.queryOne('SELECT tecnico_id FROM actividad_entregas WHERE id = $1', [e.id]);
      if (existente && existente.tecnico_id !== req.user.id) {
        rechazadas.push({ id: e.id, motivo: 'Pertenece a otro técnico' });
        continue;
      }
      const item = parseInt(e.datos?.beneficiario?.item, 10);
      await db.query(
        `INSERT INTO actividad_entregas (id, actividad, numero, tecnico_id, tecnico_usuario, beneficiario_item, datos, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, NOW()), NOW())
         ON CONFLICT (id) DO UPDATE SET numero = EXCLUDED.numero, beneficiario_item = EXCLUDED.beneficiario_item,
           datos = EXCLUDED.datos, updated_at = NOW()`,
        [e.id, e.actividad, numero, req.user.id, req.user.usuario, Number.isInteger(item) ? item : null, JSON.stringify(e.datos), e.created_at || null]
      );
      sincronizadas++;
    }
    res.json({ estado: 'ok', sincronizadas, rechazadas });
  } catch (error) {
    console.error('[Entregas] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar entregas' });
  }
});

// GET /api/actividades-entregas?actividad=siembra_platano
router.get('/', authenticateToken, async (req, res) => {
  try {
    const actividad = String(req.query.actividad || '');
    if (!ACTIVIDADES.has(actividad)) return res.status(400).json({ estado: 'error', mensaje: 'Actividad inválida' });
    const vals = [actividad];
    let filtro = '';
    if (req.user.rol === 'tecnico') {
      vals.push(req.user.id);
      filtro = 'AND tecnico_id = $2';
    } else if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const filas = await db.queryAll(
      `SELECT e.id, e.actividad, e.numero, e.tecnico_id, e.beneficiario_item, e.datos, e.created_at, e.updated_at,
              u.nombre AS tecnico_nombre
       FROM actividad_entregas e
       LEFT JOIN usuarios u ON u.id = e.tecnico_id
       WHERE e.actividad = $1 ${filtro.replace('tecnico_id', 'e.tecnico_id')} ORDER BY e.numero ASC`,
      vals
    );
    res.json({ estado: 'ok', entregas: filas });
  } catch (error) {
    console.error('[Entregas] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar entregas' });
  }
});

// GET /api/actividades-entregas/fotos/:fotoId — técnico dueño o roles superiores (acepta ?token=)
router.get('/fotos/:fotoId', authenticateTokenOrQuery, async (req, res) => {
  try {
    const fotoId = parseInt(req.params.fotoId, 10);
    if (!Number.isInteger(fotoId)) return res.status(400).json({ estado: 'error', mensaje: 'Foto inválida' });
    const f = await db.queryOne('SELECT storage_key, tecnico_id FROM actividad_entregas_fotos WHERE id = $1', [fotoId]);
    if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Foto no encontrada' });
    if (f.tecnico_id !== req.user.id && !esSuperior(req.user)) return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    const stat = await storage.statFile(f.storage_key);
    const stream = stat && (await storage.getFileStream(f.storage_key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });
    const k = f.storage_key.toLowerCase();
    res.setHeader('Content-Type', k.endsWith('.png') ? 'image/png' : k.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[Entregas] Error al descargar foto:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
  }
});

module.exports = router;
