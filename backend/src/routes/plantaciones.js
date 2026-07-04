// ============================================================
// Plantaciones Routes — Sync + CRUD de plantaciones en mapa
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { createPersistentStore } = require('../persistence');
const router = express.Router();

// Almacenamiento persistente en JSON
const store = createPersistentStore('plantaciones');

// Cache de usuarios para enriquecer respuestas
let usuariosCache = null;
function getUsuarios() {
  if (usuariosCache) return usuariosCache;
  try {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'usuarios.json'), 'utf8');
    usuariosCache = JSON.parse(raw);
    return usuariosCache;
  } catch { return []; }
}
function enriquecerConNombre(items) {
  const usuarios = getUsuarios();
  const map = new Map(usuarios.map(u => [u.id, u.nombre || u.usuario]));
  return items.map(item => ({ ...item, usuario_nombre: map.get(item.usuario_id) || item.usuario_id }));
}

// POST /api/plantaciones/sync — Recibir plantaciones del técnico
router.post('/sync', authenticateToken, (req, res) => {
  try {
    const { plantaciones } = req.body;
    if (!Array.isArray(plantaciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de plantaciones' });
    }

    const enriched = plantaciones.map(p => ({
      ...p,
      sincronizado: true,
      server_timestamp: new Date().toISOString(),
    }));

    store.setMany(enriched);

    console.log(`[Plantaciones] ${enriched.length} plantaciones sincronizadas (${store.getAll().length} totales)`);
    res.json({
      estado: 'ok',
      mensaje: `${enriched.length} plantaciones sincronizadas`,
      sincronizadas: enriched.length,
    });
  } catch (error) {
    console.error('[Plantaciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar plantaciones' });
  }
});

// GET /api/plantaciones — Obtener todas las plantaciones (supervisor/gerente/admin)
router.get('/', authenticateToken, (req, res) => {
  try {
    const { rol, usuario_id } = req.user;
    let lista = store.getAll();

    // Técnicos solo ven sus propias plantaciones
    if (rol === 'tecnico') {
      lista = lista.filter(p => p.usuario_id === usuario_id);
    }

    res.json({
      estado: 'ok',
      total: lista.length,
      plantaciones: enriquecerConNombre(lista),
    });
  } catch (error) {
    console.error('[Plantaciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener plantaciones' });
  }
});

// DELETE /api/plantaciones/:id — Solo admin puede eliminar
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar plantaciones' });
    }

    const { id } = req.params;
    if (!store.get(id)) {
      return res.status(404).json({ estado: 'error', mensaje: 'Plantación no encontrada' });
    }

    store.delete(id);
    console.log(`[Plantaciones] Eliminada: ${id} por admin ${req.user.usuario_id}`);
    res.json({ estado: 'ok', mensaje: 'Plantación eliminada correctamente' });
  } catch (error) {
    console.error('[Plantaciones] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar plantación' });
  }
});

// GET /api/plantaciones/resumen — Resumen agrupado por especie
router.get('/resumen', authenticateToken, (req, res) => {
  try {
    const lista = store.getAll();
    const resumen = {};

    for (const p of lista) {
      if (!resumen[p.especie]) {
        resumen[p.especie] = { total: 0, conteo: 0 };
      }
      resumen[p.especie].total += p.cantidad || 1;
      resumen[p.especie].conteo += 1;
    }

    res.json({
      estado: 'ok',
      resumen: Object.entries(resumen).map(([especie, data]) => ({
        especie,
        total: data.total,
        conteo: data.conteo,
      })),
    });
  } catch (error) {
    console.error('[Plantaciones] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener resumen' });
  }
});

module.exports = router;
