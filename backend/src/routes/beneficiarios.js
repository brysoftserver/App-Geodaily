// ============================================================
// Beneficiarios Routes — Base de datos compartida del proyecto
// (76 beneficiarios + asignación a técnicos)
// Persistencia: PostgreSQL — fuente de verdad compartida entre
// todos los dispositivos; la app mantiene un espejo en SQLite
// local para trabajo offline.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const router = express.Router();

// Solo roles de coordinación pueden modificar la base (el técnico la consulta)
function puedeModificar(rol) {
  return ['admin', 'supervisor', 'interventor', 'gerente'].includes(rol);
}

// GET /api/beneficiarios — Listado completo (cualquier usuario autenticado)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const beneficiarios = await db.queryAll(
      'SELECT * FROM beneficiarios ORDER BY item ASC'
    );
    res.json({ estado: 'ok', beneficiarios });
  } catch (error) {
    console.error('[Beneficiarios] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar beneficiarios' });
  }
});

// PUT /api/beneficiarios/:item/asignacion — Asignar o desasignar técnico
// body: { tecnico_id, tecnico_nombre } — ambos null/ausentes = desasignar
router.put('/:item/asignacion', authenticateToken, async (req, res) => {
  try {
    if (!puedeModificar(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para asignar beneficiarios' });
    }
    const item = parseInt(req.params.item, 10);
    const { tecnico_id, tecnico_nombre } = req.body;

    const existente = await db.queryOne('SELECT item FROM beneficiarios WHERE item = $1', [item]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    }

    await db.query(
      `UPDATE beneficiarios
       SET tecnico_asignado_id = $1, tecnico_asignado_nombre = $2, updated_at = NOW()
       WHERE item = $3`,
      [tecnico_id || null, tecnico_nombre || null, item]
    );

    // ─── Si se asignó un técnico, crear carpetas del beneficiario en MinIO ───
    if (tecnico_id && tecnico_nombre) {
      try {
        // Obtener datos del beneficiario (nombre_completo)
        const benefData = await db.queryOne(
          'SELECT nombre_completo FROM beneficiarios WHERE item = $1',
          [item]
        );

        if (benefData) {
          // Obtener datos del técnico (usuario, rol)
          const tecData = await db.queryOne(
            'SELECT usuario, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
            [tecnico_id]
          );

          if (tecData) {
            // Crear carpetas para ambos tipos de formulario
            for (const tipoForm of ['caracterizacion', 'visita_tecnica']) {
              await storage.createBeneficiaryFolders(
                tecData.rol,
                tecData.usuario,
                item,
                benefData.nombre_completo,
                tipoForm
              );
            }
            console.log(`[Beneficiarios] 📁 Carpetas MinIO creadas para item ${item} (${benefData.nombre_completo}) bajo ${tecData.usuario}`);
          } else {
            console.warn(`[Beneficiarios] ⚠️ Técnico ${tecnico_id} no encontrado en usuarios — no se crearon carpetas MinIO`);
          }
        }
      } catch (folderErr) {
        // No bloquear la asignación si falla la creación de carpetas
        console.warn(`[Beneficiarios] ⚠️ Error creando carpetas en MinIO:`, folderErr.message);
      }
    }

    console.log(`[Beneficiarios] Item ${item} ${tecnico_id ? `asignado a ${tecnico_nombre}` : 'desasignado'} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: tecnico_id ? 'Técnico asignado' : 'Técnico desasignado' });
  } catch (error) {
    console.error('[Beneficiarios] Error asignando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al asignar técnico' });
  }
});

// POST /api/beneficiarios — Crear beneficiario nuevo
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!puedeModificar(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para crear beneficiarios' });
    }
    const { item, corregimiento, vereda, nombre_completo, cedula } = req.body;
    if (!corregimiento || !vereda || !nombre_completo || !cedula) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Campos requeridos: corregimiento, vereda, nombre_completo, cedula',
      });
    }

    let itemFinal = parseInt(item, 10);
    if (!itemFinal || Number.isNaN(itemFinal)) {
      const { max } = await db.queryOne('SELECT COALESCE(MAX(item), 0)::int AS max FROM beneficiarios');
      itemFinal = max + 1;
    } else {
      const dup = await db.queryOne('SELECT item FROM beneficiarios WHERE item = $1', [itemFinal]);
      if (dup) {
        return res.status(409).json({ estado: 'error', mensaje: `Ya existe un beneficiario con el item ${itemFinal}` });
      }
    }

    await db.query(
      `INSERT INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemFinal, corregimiento, vereda, nombre_completo, cedula]
    );

    console.log(`[Beneficiarios] Item ${itemFinal} (${nombre_completo}) creado por ${req.user.usuario}`);
    res.status(201).json({ estado: 'ok', mensaje: 'Beneficiario creado', item: itemFinal });
  } catch (error) {
    console.error('[Beneficiarios] Error creando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al crear beneficiario' });
  }
});

// DELETE /api/beneficiarios/:item — Eliminar beneficiario
router.delete('/:item', authenticateToken, async (req, res) => {
  try {
    if (!puedeModificar(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para eliminar beneficiarios' });
    }
    const item = parseInt(req.params.item, 10);
    const existente = await db.queryOne('SELECT item FROM beneficiarios WHERE item = $1', [item]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    }

    await db.query('DELETE FROM beneficiarios WHERE item = $1', [item]);
    console.log(`[Beneficiarios] Item ${item} eliminado por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Beneficiario eliminado' });
  } catch (error) {
    console.error('[Beneficiarios] Error eliminando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar beneficiario' });
  }
});

// POST /api/beneficiarios/regenerar-carpetas — Recrear estructura MinIO
// para todos los beneficiarios que tienen técnico asignado.
// Útil después de migración o si falló la creación inicial.
router.post('/regenerar-carpetas', authenticateToken, async (req, res) => {
  try {
    if (!puedeModificar(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    // Obtener todos los beneficiarios con técnico asignado
    const asignados = await db.queryAll(
      `SELECT b.item, b.nombre_completo, b.tecnico_asignado_id, u.usuario, u.rol
       FROM beneficiarios b
       JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE b.tecnico_asignado_id IS NOT NULL AND u.activo = TRUE`
    );

    const resultados = [];
    for (const benef of asignados) {
      try {
        // Crear carpetas para ambos tipos de formulario
        for (const tipoForm of ['caracterizacion', 'visita_tecnica']) {
          await storage.createBeneficiaryFolders(
            benef.rol,
            benef.usuario,
            benef.item,
            benef.nombre_completo,
            tipoForm
          );
        }
        resultados.push({ item: benef.item, nombre: benef.nombre_completo, estado: 'ok' });
        console.log(`[Beneficiarios] 📁 Carpetas regeneradas: ${benef.item} (${benef.nombre_completo})`);
      } catch (err) {
        resultados.push({ item: benef.item, nombre: benef.nombre_completo, estado: 'error', mensaje: err.message });
        console.warn(`[Beneficiarios] ⚠️ Error regenerando ${benef.item}: ${err.message}`);
      }
    }

    res.json({
      estado: 'ok',
      mensaje: `Procesados ${asignados.length} beneficiarios`,
      total: asignados.length,
      exitosos: resultados.filter(r => r.estado === 'ok').length,
      fallidos: resultados.filter(r => r.estado !== 'ok').length,
      detalles: resultados,
    });
  } catch (error) {
    console.error('[Beneficiarios] Error regenerando carpetas:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al regenerar carpetas' });
  }
});

module.exports = router;
