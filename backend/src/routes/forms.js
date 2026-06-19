// ============================================================
// Forms Routes — CRUD de formularios en PostGIS (mock)
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Almacenamiento en memoria para desarrollo
const formulariosDB = new Map();

// POST /api/formularios/guardar
router.post('/guardar', authenticateToken, (req, res) => {
  try {
    const formulario = req.body;

    if (!formulario || !formulario.id) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Formulario inválido: id requerido',
      });
    }

    formulariosDB.set(formulario.id, {
      ...formulario,
      sincronizado: true,
      updated_at: new Date().toISOString(),
      server_created_at: formulario.created_at,
    });

    console.log(`[Forms] Formulario guardado: ${formulario.id} (${formulario.tipo})`);

    res.json({
      estado: 'ok',
      mensaje: 'Formulario guardado correctamente',
      id: formulario.id,
    });
  } catch (error) {
    console.error('[Forms] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar formulario' });
  }
});

// GET /api/formularios — listar todos
router.get('/', authenticateToken, (req, res) => {
  const lista = Array.from(formulariosDB.values());
  res.json({
    estado: 'ok',
    total: lista.length,
    formularios: lista,
  });
});

// GET /api/formularios/:id
router.get('/:id', authenticateToken, (req, res) => {
  const form = formulariosDB.get(req.params.id);
  if (!form) {
    return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
  }
  res.json({ estado: 'ok', formulario: form });
});

// DELETE /api/formularios/:id
router.delete('/:id', authenticateToken, (req, res) => {
  const deleted = formulariosDB.delete(req.params.id);
  res.json({
    estado: deleted ? 'ok' : 'error',
    mensaje: deleted ? 'Formulario eliminado' : 'Formulario no encontrado',
  });
});

module.exports = router;
