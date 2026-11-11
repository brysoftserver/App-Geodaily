// ============================================================
// Evidencia de una actividad por beneficiario
// ============================================================
// Cada beneficiario, dentro de una actividad (ej. preparación del terreno),
// tiene 4 segmentos:
//   1. Actas individuales de entrega y recibo hechas EN ESA actividad
//      (formato `acta_entrega_individual` con datos.actividadId = actividad).
//   2-4. Fotos del antes / durante / después (máx. 3 por momento), subidas
//      desde el almacenamiento del dispositivo.
// Las fotos quedan en MinIO dentro de la carpeta del beneficiario:
//   tecnicos/{usuario}/{item}_{nombre}/{actividad}/{momento}/{archivo}
// El técnico dueño del beneficiario escribe; el admin también puede subir,
// quitar y reemplazar fotos y actas. Los demás roles superiores solo leen.
// ============================================================

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const { quitarRevision } = require('../lib/revisionInterventoria');
const storage = require('../storage');

const router = express.Router();

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];
const esSuperior = (user) => ROLES_SUPERIORES.includes(user?.rol);

/** Actividades con panel de evidencia (ids de src/data/actividades.ts del cliente). */
const ACTIVIDADES = new Set([
  'preparacion_terreno',
  'siembra_cacao',
  'siembra_platano',
  'siembra_forestales',
  'fertilizacion',
  'control_sanitario',
]);
const MOMENTOS = ['antes', 'durante', 'despues'];
const MAX_FOTOS_POR_MOMENTO = 3;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** Tipo de imagen por su cabecera (no se confía en el mimetype del cliente). */
function detectarImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

/** Valida :actividad y :item. Responde y devuelve null si algo falla. */
async function resolverBeneficiario(req, res) {
  if (!ACTIVIDADES.has(req.params.actividad)) {
    res.status(404).json({ estado: 'error', mensaje: 'Actividad no encontrada' });
    return null;
  }
  const item = parseInt(req.params.item, 10);
  if (!Number.isInteger(item)) {
    res.status(400).json({ estado: 'error', mensaje: 'Beneficiario inválido' });
    return null;
  }
  const b = await db.queryOne(
    `SELECT b.item, b.nombre_completo, b.cedula, b.tecnico_asignado_id, u.usuario AS tecnico_usuario
     FROM beneficiarios b
     LEFT JOIN usuarios u ON u.id = b.tecnico_asignado_id
     WHERE b.item = $1`,
    [item]
  );
  if (!b) {
    res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    return null;
  }
  return b;
}

const esDuenoTecnico = (user, b) => user?.rol === 'tecnico' && b.tecnico_asignado_id === user.id;
const esAdmin = (user) => user?.rol === 'admin';

const TIPO_ACTA = 'acta_entrega_individual';
const esPdf = (buf) => buf && buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF';

// Las rutas /foto/:id van ANTES de /:actividad/:item: si no, GET /foto/5 se leería
// como actividad='foto', item=5 y respondería 404.
/** Carga una foto por id y verifica el permiso. Responde y devuelve null si no procede. */
async function fotoConPermiso(req, res, { soloEscritura }) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ estado: 'error', mensaje: 'Foto inválida' });
    return null;
  }
  const foto = await db.queryOne(
    `SELECT e.id, e.storage_key, e.nombre_archivo, e.actividad, e.beneficiario_item, b.tecnico_asignado_id
     FROM actividad_evidencias e
     LEFT JOIN beneficiarios b ON b.item = e.beneficiario_item
     WHERE e.id = $1`,
    [id]
  );
  if (!foto) {
    res.status(404).json({ estado: 'error', mensaje: 'Foto no encontrada' });
    return null;
  }
  const esDueno = req.user.rol === 'tecnico' && foto.tecnico_asignado_id === req.user.id;
  const permitido = soloEscritura ? esDueno || req.user.rol === 'admin' : esDueno || esSuperior(req.user);
  if (!permitido) {
    res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    return null;
  }
  return foto;
}

// GET /api/actividades-evidencias/foto/:id — dueño o superiores (acepta ?token= para web)
router.get('/foto/:id', authenticateTokenOrQuery, async (req, res) => {
  try {
    const foto = await fotoConPermiso(req, res, { soloEscritura: false });
    if (!foto) return;
    const stat = await storage.statFile(foto.storage_key);
    const stream = stat && (await storage.getFileStream(foto.storage_key));
    if (!stream) return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });

    const ext = String(foto.storage_key).toLowerCase();
    res.setHeader('Content-Type', ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.on('error', () => (res.headersSent ? res.end() : res.status(500).end()));
    stream.pipe(res);
  } catch (error) {
    console.error('[ActividadEvidencias] Error al descargar:', error);
    if (!res.headersSent) res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
  }
});

// DELETE /api/actividades-evidencias/foto/:id — técnico dueño o admin
router.delete('/foto/:id', authenticateToken, async (req, res) => {
  try {
    const foto = await fotoConPermiso(req, res, { soloEscritura: true });
    if (!foto) return;
    await storage.deleteFile(foto.storage_key);
    await db.query('DELETE FROM actividad_evidencias WHERE id = $1', [foto.id]);
    // El registro cambió: vuelve a quedar pendiente de la interventoría.
    await quitarRevision(foto.actividad, foto.beneficiario_item);
    res.json({ estado: 'ok', mensaje: 'Foto eliminada' });
  } catch (error) {
    console.error('[ActividadEvidencias] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar la foto' });
  }
});

// GET /api/actividades-evidencias/:actividad/:item — dueño o superiores
// → { actas: [...], fotos: { antes: [...], durante: [...], despues: [...] } }
router.get('/:actividad/:item', authenticateToken, async (req, res) => {
  try {
    const b = await resolverBeneficiario(req, res);
    if (!b) return;
    if (!esDuenoTecnico(req.user, b) && !esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    const filasFotos = await db.queryAll(
      `SELECT id, momento, nombre_archivo, created_at
       FROM actividad_evidencias
       WHERE actividad = $1 AND beneficiario_item = $2
       ORDER BY created_at ASC, id ASC`,
      [req.params.actividad, b.item]
    );
    const fotos = { antes: [], durante: [], despues: [] };
    for (const f of filasFotos) {
      if (fotos[f.momento]) fotos[f.momento].push({ id: f.id, nombre: f.nombre_archivo, fecha: f.created_at });
    }

    // Solo las actas diligenciadas DENTRO de esta actividad (las de "Otros
    // formatos" no llevan actividadId y no se mezclan).
    const filasActas = await db.queryAll(
      `SELECT id, instancia, completo, (pdf_path IS NOT NULL) AS tiene_pdf,
              datos->>'fecha' AS fecha,
              (datos->>'firmaInterventoria') IS NOT NULL AND (datos->>'firmaInterventoria') <> '' AS firmada_interventoria,
              datos->'actividades' AS entregado,
              datos->'faltantes' AS faltantes,
              created_at, updated_at
       FROM otros_formatos
       WHERE tipo = 'acta_entrega_individual'
         AND beneficiario_cedula = $1
         AND datos->>'actividadId' = $2
         AND completo = TRUE
       ORDER BY updated_at DESC`,
      [b.cedula, req.params.actividad]
    );
    const filasObs = filasActas.length
      ? await db.queryAll(
          `SELECT id, formato_id, autor_id, autor_nombre, autor_rol, comentario, resuelta, created_at
           FROM otros_formatos_observaciones
           WHERE formato_id = ANY($1::varchar[])
           ORDER BY created_at ASC, id ASC`,
          [filasActas.map((a) => a.id)]
        )
      : [];
    const actas = filasActas.map((a) => {
      const entregado = typeof a.entregado === 'string' ? JSON.parse(a.entregado) : a.entregado;
      const faltantes = typeof a.faltantes === 'string' ? JSON.parse(a.faltantes) : a.faltantes;
      return {
        id: a.id,
        instancia: a.instancia,
        fecha: a.fecha || a.created_at,
        tienePdf: !!a.tiene_pdf,
        firmadaInterventoria: !!a.firmada_interventoria,
        /** Datos que el técnico dejó pendientes al completar el acta. */
        faltantes: Array.isArray(faltantes) ? faltantes : [],
        resumen: (Array.isArray(entregado) ? entregado : []).map((x) => x?.descripcion).filter(Boolean).join(', '),
        observaciones: filasObs
          .filter((o) => o.formato_id === a.id)
          .map((o) => ({
            id: o.id,
            autor: o.autor_nombre,
            rol: o.autor_rol,
            comentario: o.comentario,
            resuelta: o.resuelta,
            fecha: o.created_at,
            /** Quien la dejó (o un admin) puede cerrarla. */
            puedeResolver: !o.resuelta && (o.autor_id === req.user.id || req.user.rol === 'admin'),
          })),
      };
    });

    res.json({ estado: 'ok', maxPorMomento: MAX_FOTOS_POR_MOMENTO, actas, fotos });
  } catch (error) {
    console.error('[ActividadEvidencias] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cargar la evidencia' });
  }
});

// ─── Actas (solo admin) ─────────────────────────────────────
// POST /api/actividades-evidencias/:actividad/:item/acta — admin (multipart: archivo PDF)
//   body.actaId (opcional): reemplaza el PDF de esa acta; sin él crea un acta nueva
//   de esta actividad, atribuida al técnico dueño del beneficiario.
// Va ANTES de /:actividad/:item/:momento para que 'acta' no se lea como momento.
router.post('/:actividad/:item/acta', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (!esAdmin(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo un administrador puede subir o reemplazar actas' });
    }
    const b = await resolverBeneficiario(req, res);
    if (!b) return;
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    if (!esPdf(req.file.buffer)) return res.status(400).json({ estado: 'error', mensaje: 'El archivo debe ser un PDF' });

    let acta;
    const actaId = String(req.body?.actaId || '').trim();
    if (actaId) {
      acta = await db.queryOne(
        `SELECT id, instancia, tecnico_usuario FROM otros_formatos
          WHERE id = $1 AND tipo = $2 AND beneficiario_cedula = $3 AND datos->>'actividadId' = $4`,
        [actaId, TIPO_ACTA, b.cedula, req.params.actividad]
      );
      if (!acta) return res.status(404).json({ estado: 'error', mensaje: 'Acta no encontrada' });
    } else {
      const tecnico = b.tecnico_asignado_id
        ? await db.queryOne('SELECT id, nombre, usuario FROM usuarios WHERE id = $1', [b.tecnico_asignado_id])
        : null;
      const instancia = `adm${Date.now().toString(36)}`;
      const id = `of-${TIPO_ACTA}-${b.cedula}-${instancia}`;
      const datos = {
        actividadId: req.params.actividad,
        instancia,
        fecha: new Date().toISOString(),
        nombre: b.nombre_completo,
        cedula: b.cedula,
        actividades: [],
        faltantes: [],
        cargadaPorAdmin: req.user.usuario,
      };
      await db.query(
        `INSERT INTO otros_formatos (id, tecnico_id, tecnico_nombre, tecnico_usuario, beneficiario_cedula,
           beneficiario_nombre, tipo, datos, completo, instancia, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, TRUE, $9, NOW(), NOW())`,
        [
          id,
          tecnico?.id || req.user.id,
          tecnico?.nombre || req.user.nombre || req.user.usuario,
          tecnico?.usuario || req.user.usuario,
          b.cedula,
          b.nombre_completo,
          TIPO_ACTA,
          JSON.stringify(datos),
          instancia,
        ]
      );
      acta = { id, instancia, tecnico_usuario: tecnico?.usuario || req.user.usuario };
    }

    const filename = `${TIPO_ACTA}_${b.cedula}${acta.instancia ? `_${acta.instancia}` : ''}.pdf`;
    const objeto = await storage.uploadFile('tecnico', acta.tecnico_usuario || b.tecnico_usuario || req.user.usuario, 'otros_formatos', filename, req.file.buffer, {
      contentType: 'application/pdf',
      beneficiarioItem: b.item,
      beneficiarioNombre: b.nombre_completo,
    });
    await db.query(
      'UPDATE otros_formatos SET pdf_path = $2, pdf_size = $3, pdf_actualizado = NOW(), updated_at = NOW() WHERE id = $1',
      [acta.id, objeto.path, req.file.size]
    );
    await quitarRevision(req.params.actividad, b.item);
    console.log(`[ActividadEvidencias] Acta ${acta.id} ${actaId ? 'reemplazada' : 'cargada'} por admin ${req.user.usuario}`);
    res.json({ estado: 'ok', id: acta.id });
  } catch (error) {
    console.error('[ActividadEvidencias] Error al subir acta:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir el acta' });
  }
});

// DELETE /api/actividades-evidencias/:actividad/:item/acta/:id — solo admin
router.delete('/:actividad/:item/acta/:id', authenticateToken, async (req, res) => {
  try {
    if (!esAdmin(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo un administrador puede eliminar actas' });
    }
    const b = await resolverBeneficiario(req, res);
    if (!b) return;
    const acta = await db.queryOne(
      `SELECT id, pdf_path FROM otros_formatos
        WHERE id = $1 AND tipo = $2 AND beneficiario_cedula = $3 AND datos->>'actividadId' = $4`,
      [req.params.id, TIPO_ACTA, b.cedula, req.params.actividad]
    );
    if (!acta) return res.status(404).json({ estado: 'error', mensaje: 'Acta no encontrada' });
    if (acta.pdf_path) await storage.deleteFile(acta.pdf_path).catch(() => {});
    await db.query('DELETE FROM otros_formatos_observaciones WHERE formato_id = $1', [acta.id]);
    await db.query('DELETE FROM otros_formatos WHERE id = $1', [acta.id]);
    await quitarRevision(req.params.actividad, b.item);
    console.log(`[ActividadEvidencias] Acta ${acta.id} eliminada por admin ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Acta eliminada' });
  } catch (error) {
    console.error('[ActividadEvidencias] Error al eliminar acta:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el acta' });
  }
});

// POST /api/actividades-evidencias/:actividad/:item/:momento — técnico dueño o admin (multipart: archivo)
router.post('/:actividad/:item/:momento', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    const b = await resolverBeneficiario(req, res);
    if (!b) return;
    if (!esDuenoTecnico(req.user, b) && !esAdmin(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico asignado o un administrador puede subir fotos' });
    }
    const momento = req.params.momento;
    if (!MOMENTOS.includes(momento)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Momento inválido' });
    }
    if (!req.file) return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    const imagen = detectarImagen(req.file.buffer);
    if (!imagen) {
      return res.status(400).json({ estado: 'error', mensaje: 'El archivo debe ser una imagen (JPG, PNG o WEBP)' });
    }

    const { n } = await db.queryOne(
      'SELECT COUNT(*)::int AS n FROM actividad_evidencias WHERE actividad = $1 AND beneficiario_item = $2 AND momento = $3',
      [req.params.actividad, b.item, momento]
    );
    if (n >= MAX_FOTOS_POR_MOMENTO) {
      return res.status(409).json({
        estado: 'error',
        mensaje: `Máximo ${MAX_FOTOS_POR_MOMENTO} fotos en este segmento. Elimina una para subir otra.`,
      });
    }

    const filename = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${imagen.ext}`;
    // tipo = "{actividad}/{momento}" → .../{item}_{nombre}/{actividad}/{momento}/{archivo}
    // Si sube el admin, la foto queda igual en la carpeta del técnico dueño.
    const objeto = await storage.uploadFile(
      'tecnico',
      b.tecnico_usuario || req.user.usuario,
      `${req.params.actividad}/${momento}`,
      filename,
      req.file.buffer,
      { contentType: imagen.mime, beneficiarioItem: b.item, beneficiarioNombre: b.nombre_completo }
    );

    const fila = await db.queryOne(
      `INSERT INTO actividad_evidencias (actividad, beneficiario_item, momento, storage_key, nombre_archivo, tamano, tecnico_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        req.params.actividad,
        b.item,
        momento,
        objeto.path,
        String(req.file.originalname || filename).slice(0, 255),
        req.file.size,
        b.tecnico_asignado_id || req.user.id,
      ]
    );
    if (esAdmin(req.user)) await quitarRevision(req.params.actividad, b.item);
    res.json({ estado: 'ok', id: fila.id });
  } catch (error) {
    console.error('[ActividadEvidencias] Error al subir:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir la foto' });
  }
});

module.exports = router;
