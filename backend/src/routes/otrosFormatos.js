// ============================================================
// Otros Formatos Routes — Acta de Compromiso, Autorizaciones de Imagen,
// Consentimiento de Datos y Evaluación ECA diligenciados en campo
// ============================================================
// Antes estos formatos vivían SOLO en el AsyncStorage del celular del técnico
// y su único destino era el PDF entregado por el "Compartir" del sistema: no
// había tabla, no había subida y ningún rol superior podía verlos ni
// reimprimirlos.
//
// Aquí se guarda el JSON completo del formato (con las firmas como data URI)
// para que coordinación, interventoría, gerencia o admin puedan regenerar el
// PDF oficial con el mismo generador del técnico.
//
// El técnico escribe primero en SQLite (offline-first) y luego sube con
// POST /sync; el servidor hace UPSERT por la llave natural
// (beneficiario_cedula, tipo) para no duplicar si el técnico corrige y
// regenera.
// ============================================================

const express = require('express');
const multer = require('multer');
const storage = require('../storage');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];

const TIPOS_VALIDOS = [
  'acta_compromiso',
  'autorizacion_imagen',
  'autorizacion_imagen_menor',
  'consentimiento_datos',
  'evaluacion_eca',
  'acta_entrega_individual',
];

const esSuperior = (user) => ROLES_SUPERIORES.includes(user?.rol);

/** Solo el Acta de Entrega admite varias por beneficiario (una por `instancia`). */
const TIPO_MULTIPLE = 'acta_entrega_individual';

const limpiarInstancia = (tipo, valor) =>
  tipo === TIPO_MULTIPLE ? String(valor || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';

/** Arma el id estable de un formato: el mismo que usa el cliente en SQLite. */
const idFormato = (cedula, tipo, instancia = '') =>
  instancia ? `of-${tipo}-${cedula}-${instancia}` : `of-${tipo}-${cedula}`;

// ------------------------------------------------------------
// POST /api/otros-formatos/sync — Subir/actualizar formatos del técnico
// ------------------------------------------------------------
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { formatos } = req.body;
    if (!Array.isArray(formatos)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de formatos' });
    }

    let sincronizados = 0;
    const rechazados = [];

    for (const f of formatos) {
      const tipo = String(f.tipo || '').trim();
      const cedula = String(f.beneficiario_cedula || '').trim();

      if (!TIPOS_VALIDOS.includes(tipo)) {
        rechazados.push({ id: f.id, motivo: `Tipo no válido: ${tipo}` });
        continue;
      }
      if (!cedula) {
        rechazados.push({ id: f.id, motivo: 'Falta la cédula del beneficiario' });
        continue;
      }

      // `datos` puede llegar como objeto (lo normal) o como string JSON.
      let datos = f.datos;
      if (typeof datos === 'string') {
        try {
          datos = JSON.parse(datos);
        } catch {
          rechazados.push({ id: f.id, motivo: 'Los datos del formato no son JSON válido' });
          continue;
        }
      }
      if (!datos || typeof datos !== 'object') {
        rechazados.push({ id: f.id, motivo: 'El formato no trae datos' });
        continue;
      }

      // La interventoría firma DESPUÉS de que el técnico genera el acta. Si el
      // técnico corrige y vuelve a sincronizar, su copia no trae esa firma:
      // se conserva la que ya está en el servidor para no borrarla.
      const instancia = limpiarInstancia(tipo, f.instancia || datos.instancia);
      if (tipo === 'acta_entrega_individual') {
        const previo = await db.queryOne(
          'SELECT datos FROM otros_formatos WHERE beneficiario_cedula = $1 AND tipo = $2 AND instancia = $3',
          [cedula, tipo, instancia]
        );
        const dp = previo && (typeof previo.datos === 'string' ? JSON.parse(previo.datos) : previo.datos);
        if (dp?.firmaInterventoria && !datos.firmaInterventoria) {
          datos = {
            ...datos,
            firmaInterventoria: dp.firmaInterventoria,
            interventoriaNombre: dp.interventoriaNombre || datos.interventoriaNombre || '',
            interventoriaCargo: dp.interventoriaCargo || datos.interventoriaCargo || '',
          };
        }
      }

      // El autor SIEMPRE es quien sube (nunca se confía en el tecnico_id que
      // manda el cliente): así el registro queda atribuido a su dueño real.
      await db.query(
        `INSERT INTO otros_formatos (
          id, tecnico_id, tecnico_nombre, tecnico_usuario,
          beneficiario_cedula, beneficiario_nombre, tipo, datos, completo,
          instancia, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $11, $10, NOW())
         ON CONFLICT (beneficiario_cedula, tipo, instancia) DO UPDATE SET
           -- El PDF guardado solo sigue siendo válido si los datos no cambiaron.
           pdf_path = CASE WHEN otros_formatos.datos = EXCLUDED.datos THEN otros_formatos.pdf_path ELSE NULL END,
           tecnico_id = EXCLUDED.tecnico_id,
           tecnico_nombre = EXCLUDED.tecnico_nombre,
           tecnico_usuario = EXCLUDED.tecnico_usuario,
           beneficiario_nombre = EXCLUDED.beneficiario_nombre,
           datos = EXCLUDED.datos,
           completo = EXCLUDED.completo,
           updated_at = NOW()`,
        [
          idFormato(cedula, tipo, instancia),
          req.user.id,
          req.user.nombre || req.user.usuario,
          req.user.usuario,
          cedula,
          f.beneficiario_nombre || null,
          tipo,
          JSON.stringify(datos),
          f.completo === false ? false : true,
          f.created_at || new Date().toISOString(),
          instancia,
        ]
      );
      sincronizados++;
    }

    console.log(
      `[OtrosFormatos] ${sincronizados} formato(s) sincronizado(s) por ${req.user.usuario}` +
        (rechazados.length ? ` — ${rechazados.length} rechazado(s)` : '')
    );

    res.json({
      estado: 'ok',
      mensaje: `${sincronizados} formato(s) sincronizado(s)`,
      sincronizados,
      rechazados,
    });
  } catch (error) {
    console.error('[OtrosFormatos] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar otros formatos' });
  }
});

// ------------------------------------------------------------
// GET /api/otros-formatos — Listar formatos
//   ?cedula=...   filtrar por beneficiario
//   ?tecnico=...  (solo superiores) filtrar por técnico
// El técnico solo ve los suyos; los roles superiores ven los de cualquiera.
// ------------------------------------------------------------
router.get('/', authenticateToken, async (req, res) => {
  try {
    const condiciones = [];
    const valores = [];

    const cedula = (req.query.cedula || '').toString().trim();
    if (cedula) {
      valores.push(cedula);
      condiciones.push(`of.beneficiario_cedula = $${valores.length}`);
    }

    if (!esSuperior(req.user)) {
      valores.push(req.user.id);
      condiciones.push(`of.tecnico_id = $${valores.length}`);
    } else if (req.query.tecnico) {
      valores.push(String(req.query.tecnico).trim());
      condiciones.push(`of.tecnico_id = $${valores.length}`);
    }

    // Por defecto NO se devuelven borradores: un formato aparece en la
    // supervisión cuando el técnico lo dio por terminado (generó el PDF).
    if (req.query.incluir_borradores !== '1') {
      condiciones.push('of.completo = TRUE');
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const lista = await db.queryAll(
      `SELECT of.id, of.tecnico_id, of.tecnico_nombre, of.tecnico_usuario,
              of.beneficiario_cedula, of.beneficiario_nombre, of.tipo, of.datos,
              of.completo, of.instancia, (of.pdf_path IS NOT NULL) AS tiene_pdf,
              of.pdf_actualizado, of.created_at, of.updated_at
         FROM otros_formatos of
         ${where}
        ORDER BY of.updated_at DESC`,
      valores
    );

    res.json({ estado: 'ok', total: lista.length, formatos: lista });
  } catch (error) {
    console.error('[OtrosFormatos] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener otros formatos' });
  }
});

// ------------------------------------------------------------
// POST /api/otros-formatos/:id/firma-interventoria
// La interventoría firma el Acta de Entrega y Recibo ya generada por el
// técnico. Solo interventor y admin. Body: { firma (data URI), nombre, cargo }
// ------------------------------------------------------------
router.post('/:id/firma-interventoria', authenticateToken, async (req, res) => {
  try {
    if (!['interventor', 'admin'].includes(req.user?.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo la interventoría puede firmar esta acta' });
    }
    const { firma, nombre, cargo } = req.body || {};
    if (typeof firma !== 'string' || !firma.startsWith('data:image')) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere la firma como imagen' });
    }

    const existente = await db.queryOne('SELECT tipo FROM otros_formatos WHERE id = $1', [req.params.id]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    }
    if (existente.tipo !== 'acta_entrega_individual') {
      return res.status(400).json({ estado: 'error', mensaje: 'Este formato no lleva firma de interventoría' });
    }

    const parche = {
      firmaInterventoria: firma,
      interventoriaNombre: String(nombre || req.user.nombre || '').trim(),
      interventoriaCargo: String(cargo || '').trim(),
    };
    await db.query(
      `UPDATE otros_formatos SET datos = datos || $2::jsonb, pdf_path = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id, JSON.stringify(parche)]
    );

    console.log(`[OtrosFormatos] Firma de interventoría en ${req.params.id} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Firma registrada', datos: parche });
  } catch (error) {
    console.error('[OtrosFormatos] Error al firmar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la firma' });
  }
});

// ------------------------------------------------------------
// POST /api/otros-formatos/:id/pdf — Guardar el PDF generado (multipart, campo
// `archivo`). Lo sube el técnico autor o un rol superior (la interventoría lo
// re-sube tras firmar). Queda en la carpeta del beneficiario del TÉCNICO dueño.
// ------------------------------------------------------------
router.post('/:id/pdf', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    }
    if (req.file.mimetype !== 'application/pdf' || req.file.buffer.slice(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ estado: 'error', mensaje: 'El archivo no es un PDF' });
    }

    const fmt = await db.queryOne(
      `SELECT id, tecnico_id, tecnico_usuario, beneficiario_cedula, beneficiario_nombre, tipo, instancia
         FROM otros_formatos WHERE id = $1`,
      [req.params.id]
    );
    if (!fmt) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    }
    if (!esSuperior(req.user) && fmt.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    let benefItem = null;
    let benefNombre = fmt.beneficiario_nombre;
    const benef = await db.queryOne(
      'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
      [fmt.beneficiario_cedula]
    );
    if (benef) {
      benefItem = benef.item;
      benefNombre = benefNombre || benef.nombre_completo;
    }

    // Nombre determinista: re-subir el mismo formato reemplaza su PDF.
    const filename = `${fmt.tipo}_${fmt.beneficiario_cedula}${fmt.instancia ? `_${fmt.instancia}` : ''}.pdf`;
    const dueno = fmt.tecnico_usuario || req.user.usuario;
    const objeto = await storage.uploadFile('tecnico', dueno, 'otros_formatos', filename, req.file.buffer, {
      contentType: 'application/pdf',
      beneficiarioItem: benefItem,
      beneficiarioNombre: benefItem ? benefNombre : null,
    });

    await db.query(
      'UPDATE otros_formatos SET pdf_path = $2, pdf_size = $3, pdf_actualizado = NOW() WHERE id = $1',
      [fmt.id, objeto.path, req.file.size]
    );

    console.log(`[OtrosFormatos] PDF guardado: ${objeto.path} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'PDF guardado', size: req.file.size });
  } catch (error) {
    console.error('[OtrosFormatos] Error al guardar PDF:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar el PDF' });
  }
});

// ------------------------------------------------------------
// GET /api/otros-formatos/:id/pdf — Descargar el PDF guardado
// ------------------------------------------------------------
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const fmt = await db.queryOne(
      'SELECT tecnico_id, tipo, beneficiario_cedula, instancia, pdf_path FROM otros_formatos WHERE id = $1',
      [req.params.id]
    );
    if (!fmt) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    }
    if (!esSuperior(req.user) && fmt.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    if (!fmt.pdf_path) {
      return res.status(404).json({ estado: 'error', mensaje: 'Este formato aún no tiene PDF guardado' });
    }

    const stream = await storage.getFileStream(fmt.pdf_path);
    if (!stream) {
      return res.status(404).json({ estado: 'error', mensaje: 'PDF no disponible' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${fmt.tipo}_${fmt.beneficiario_cedula}${fmt.instancia ? `_${fmt.instancia}` : ''}.pdf"`
    );
    stream.pipe(res);
  } catch (error) {
    console.error('[OtrosFormatos] Error al descargar PDF:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el PDF' });
  }
});

// ------------------------------------------------------------
// DELETE /api/otros-formatos/:id — El autor o un admin
// ------------------------------------------------------------
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const existente = await db.queryOne(
      'SELECT tecnico_id FROM otros_formatos WHERE id = $1',
      [req.params.id]
    );
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    }
    if (req.user.rol !== 'admin' && existente.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    await db.remove('otros_formatos', 'id', req.params.id);
    console.log(`[OtrosFormatos] Eliminado: ${req.params.id} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Formato eliminado correctamente' });
  } catch (error) {
    console.error('[OtrosFormatos] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el formato' });
  }
});

module.exports = router;
