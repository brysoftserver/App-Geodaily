// ============================================================
// Beneficiarios Routes — Base de datos compartida del proyecto
// (301 beneficiarios: los 300 verificados + 1 de pruebas + asignación a técnicos)
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
  return ['admin', 'coordinador', 'interventor', 'gerente'].includes(rol);
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

    // Se trae el técnico VIEJO (si tenía) antes del UPDATE de abajo, que lo
    // sobreescribe — se necesita para saber de dónde mover los archivos
    // físicos en MinIO. Sin filtro activo=TRUE: si lo desactivaron después
    // de asignarle este beneficiario, igual hace falta su usuario/rol para
    // calcular el prefijo de carpeta que hay que abandonar.
    const existente = await db.queryOne(
      `SELECT b.item, b.tecnico_asignado_id AS tecnico_viejo_id,
              u.usuario AS tecnico_viejo_usuario, u.rol AS tecnico_viejo_rol
       FROM beneficiarios b
       LEFT JOIN usuarios u ON u.id = b.tecnico_asignado_id
       WHERE b.item = $1`,
      [item]
    );
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    }

    let resumenArchivos = null;

    await db.query(
      `UPDATE beneficiarios
       SET tecnico_asignado_id = $1, tecnico_asignado_nombre = $2, updated_at = NOW()
       WHERE item = $3`,
      [tecnico_id || null, tecnico_nombre || null, item]
    );

    // ─── Si se asignó un técnico, crear carpetas del beneficiario en MinIO
    // y reetiquetar los formularios YA diligenciados de ese beneficiario ───
    if (tecnico_id && tecnico_nombre) {
      try {
        // Obtener datos del beneficiario (nombre_completo, cédula)
        const benefData = await db.queryOne(
          'SELECT nombre_completo, cedula FROM beneficiarios WHERE item = $1',
          [item]
        );

        if (benefData) {
          // Obtener datos del técnico (usuario, rol, nombre, cedula, telefono, email)
          const tecData = await db.queryOne(
            'SELECT usuario, rol, nombre, cedula, telefono, email FROM usuarios WHERE id = $1 AND activo = TRUE',
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

            // Reasignar el técnico también en los formularios ya diligenciados
            // de este beneficiario. El técnico dentro de "formularios" es un
            // snapshot (usuario_id + tecnico_json) tomado al momento de crear
            // el formulario en campo, no una referencia dinámica al
            // beneficiario — si no se reescribe aquí, la visita ya hecha se
            // queda "a nombre" del técnico anterior aunque el beneficiario
            // se reasigne. El vínculo formulario→beneficiario se hace por
            // cédula (igual que en forms.js), porque no hay FK real.
            if (benefData.cedula) {
              const nuevoTecnicoJson = JSON.stringify({
                usuario_id: tecnico_id,
                nombre: tecData.nombre,
                cedula: tecData.cedula || '',
                telefono: tecData.telefono || '',
                email: tecData.email || '',
              });
              // TRIM en ambos lados: forms.js guarda beneficiario_json tal
              // cual llega del dispositivo (sin recortar espacios), mientras
              // que beneficiarios.cedula sí viene limpia — sin el TRIM del
              // lado del JSON, una cédula con un espacio de más en el
              // formulario original nunca hace match y ese formulario queda
              // sin reasignar, sin ningún aviso.
              const actualizados = await db.query(
                `UPDATE formularios
                 SET usuario_id = $1, tecnico_json = $2::jsonb, updated_at = NOW()
                 WHERE TRIM(beneficiario_json->>'cedula') = $3
                 RETURNING id`,
                [tecnico_id, nuevoTecnicoJson, benefData.cedula.trim()]
              );
              const formIds = actualizados.rows.map((r) => r.id);
              if (actualizados.rowCount > 0) {
                console.log(`[Beneficiarios] 📝 ${actualizados.rowCount} formulario(s) reasignado(s) a ${tecnico_nombre} (item ${item})`);
              }

              // Los formularios de Caracterización guardan una TERCERA copia
              // del técnico y la cédula del beneficiario, dentro de
              // caracterizacion_nueva_json (las respuestas literales del
              // formulario, no el snapshot de metadata) — independiente de
              // tecnico_json/beneficiario_json ya reasignados arriba. Sin
              // esto, "Datos Generales" seguía mostrando al técnico y/o la
              // cédula viejos aunque el resto de la pantalla ya mostrara al
              // nuevo técnico.
              await db.query(
                `UPDATE formularios
                 SET caracterizacion_nueva_json = jsonb_set(
                       jsonb_set(
                         jsonb_set(caracterizacion_nueva_json, '{tecnico_responsable}', to_jsonb($1::text)),
                         '{tecnico_cedula}', to_jsonb($2::text)
                       ),
                       '{documento}', to_jsonb($3::text)
                     ),
                     updated_at = NOW()
                 WHERE TRIM(beneficiario_json->>'cedula') = $3
                   AND tipo = 'caracterizacion'
                   AND caracterizacion_nueva_json IS NOT NULL`,
                [tecData.nombre, tecData.cedula || '', benefData.cedula.trim()]
              );

              // ─── Mover los archivos físicos (fotos, videos, PDFs, firmas,
              // documentos) del beneficiario de la carpeta del técnico viejo
              // a la del nuevo en MinIO. El subpath del beneficiario
              // ({item}_{nombre}) no depende del técnico — mover es solo
              // cambiar el prefijo {rol}/{usuario}. La vinculación
              // archivo→formulario es inconsistente entre rutas (pdfs.js
              // solo la guarda en metadata_json.formulario_id, el resto usa
              // la columna archivos.formulario_id o metadata_json.beneficiario_item),
              // de ahí el OR de 3 condiciones.
              resumenArchivos = { total: 0, movidos: 0, fallidos: 0, pendientesRevision: 0 };
              if (
                existente.tecnico_viejo_id &&
                existente.tecnico_viejo_id !== tecnico_id &&
                existente.tecnico_viejo_usuario &&
                existente.tecnico_viejo_rol
              ) {
                try {
                  const oldPrefix = storage.getUserBasePath(existente.tecnico_viejo_rol, existente.tecnico_viejo_usuario);
                  const newPrefix = storage.getUserBasePath(tecData.rol, tecData.usuario);

                  const archivosAMover = await db.queryAll(
                    `SELECT id, minio_path FROM archivos
                     WHERE usuario_id = $1
                       AND (
                         formulario_id = ANY($2::text[])
                         OR (metadata_json->>'beneficiario_item')::int = $3
                         OR metadata_json->>'formulario_id' = ANY($2::text[])
                       )`,
                    [existente.tecnico_viejo_id, formIds, item]
                  );

                  resumenArchivos.total = archivosAMover.length;

                  for (const archivo of archivosAMover) {
                    try {
                      // No adivinar: si el path físico no arranca EXACTO con
                      // el prefijo esperado, se deja intacto y se marca para
                      // revisión manual en vez de mover a ciegas.
                      if (!archivo.minio_path.startsWith(`${oldPrefix}/`)) {
                        resumenArchivos.pendientesRevision++;
                        console.warn(`[Beneficiarios] ⚠️ Archivo ${archivo.id} no tiene el prefijo esperado (${oldPrefix}); se deja intacto: ${archivo.minio_path}`);
                        continue;
                      }

                      const newPath = newPrefix + archivo.minio_path.slice(oldPrefix.length);

                      await storage.moveFile(archivo.minio_path, newPath);

                      await db.query(
                        `UPDATE archivos SET minio_path = $1, usuario_id = $2 WHERE id = $3`,
                        [newPath, tecnico_id, archivo.id]
                      );

                      // pdf_url/firma_beneficiario/firma_tecnico: actualizar
                      // solo si su valor era EXACTAMENTE la ruta vieja
                      // (comparación de igualdad, no LIKE — evita tocar rutas
                      // de otros archivos que coincidan parcialmente).
                      await db.query(
                        `UPDATE formularios SET
                           pdf_url = CASE WHEN pdf_url = $1 THEN $2 ELSE pdf_url END,
                           firma_beneficiario = CASE WHEN firma_beneficiario = $1 THEN $2 ELSE firma_beneficiario END,
                           firma_tecnico = CASE WHEN firma_tecnico = $1 THEN $2 ELSE firma_tecnico END
                         WHERE pdf_url = $1 OR firma_beneficiario = $1 OR firma_tecnico = $1`,
                        [archivo.minio_path, newPath]
                      );

                      resumenArchivos.movidos++;
                    } catch (moveErr) {
                      resumenArchivos.fallidos++;
                      console.warn(`[Beneficiarios] ⚠️ No se pudo mover archivo ${archivo.id} (${archivo.minio_path}):`, moveErr.message);
                    }
                  }

                  console.log(`[Beneficiarios] 🔀 Archivos: ${resumenArchivos.movidos}/${resumenArchivos.total} movidos, ${resumenArchivos.fallidos} fallidos, ${resumenArchivos.pendientesRevision} pendientes de revisión (item ${item})`);
                } catch (moveBlockErr) {
                  console.warn(`[Beneficiarios] ⚠️ Error moviendo archivos del item ${item}:`, moveBlockErr.message);
                }
              }
            }
          } else {
            console.warn(`[Beneficiarios] ⚠️ Técnico ${tecnico_id} no encontrado en usuarios — no se crearon carpetas MinIO ni se reasignaron formularios`);
          }
        }
      } catch (folderErr) {
        // No bloquear la asignación si falla la creación de carpetas o el reetiquetado
        console.warn(`[Beneficiarios] ⚠️ Error creando carpetas en MinIO o reasignando formularios:`, folderErr.message);
      }
    }

    console.log(`[Beneficiarios] Item ${item} ${tecnico_id ? `asignado a ${tecnico_nombre}` : 'desasignado'} por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: tecnico_id ? 'Técnico asignado' : 'Técnico desasignado',
      archivos: resumenArchivos,
    });
  } catch (error) {
    console.error('[Beneficiarios] Error asignando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al asignar técnico' });
  }
});

// PUT /api/beneficiarios/:item — Editar datos del beneficiario
// body: { corregimiento, vereda, nombre_completo } — la cédula NO se puede
// editar por este endpoint: se usa como llave de búsqueda en documentos,
// fotos, firmas y videos ya generados en MinIO.
router.put('/:item', authenticateToken, async (req, res) => {
  try {
    if (!puedeModificar(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para editar beneficiarios' });
    }
    const item = parseInt(req.params.item, 10);
    const { corregimiento, vereda, nombre_completo } = req.body;
    if (!corregimiento || !vereda || !nombre_completo) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Campos requeridos: corregimiento, vereda, nombre_completo',
      });
    }

    const existente = await db.queryOne('SELECT item FROM beneficiarios WHERE item = $1', [item]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    }

    await db.query(
      `UPDATE beneficiarios
       SET corregimiento = $1, vereda = $2, nombre_completo = $3, updated_at = NOW()
       WHERE item = $4`,
      [corregimiento, vereda, nombre_completo, item]
    );

    console.log(`[Beneficiarios] Item ${item} editado por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Beneficiario actualizado' });
  } catch (error) {
    console.error('[Beneficiarios] Error editando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al editar beneficiario' });
  }
});

// PUT /api/beneficiarios/:item/contacto — Completar datos de contacto y
// calidad del predio (correo, teléfono, calidad_predio). A diferencia de
// PUT /:item (solo coordinación), CUALQUIER usuario autenticado puede
// llamarlo — lo usa el técnico en terreno al diligenciar el Acta de
// Compromiso, donde se captura esta info por primera vez.
router.put('/:item/contacto', authenticateToken, async (req, res) => {
  try {
    const item = parseInt(req.params.item, 10);
    const { telefono, correo_electronico, calidad_predio } = req.body;

    if (calidad_predio && !['propietario', 'poseedor', 'otro'].includes(calidad_predio)) {
      return res.status(400).json({ estado: 'error', mensaje: 'calidad_predio inválida' });
    }

    const existente = await db.queryOne('SELECT item FROM beneficiarios WHERE item = $1', [item]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Beneficiario no encontrado' });
    }

    await db.query(
      `UPDATE beneficiarios
       SET telefono = COALESCE($1, telefono),
           correo_electronico = COALESCE($2, correo_electronico),
           calidad_predio = COALESCE($3, calidad_predio),
           updated_at = NOW()
       WHERE item = $4`,
      [telefono || null, correo_electronico || null, calidad_predio || null, item]
    );

    console.log(`[Beneficiarios] Item ${item} — datos de contacto actualizados por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Datos de contacto actualizados' });
  } catch (error) {
    console.error('[Beneficiarios] Error actualizando contacto:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar datos de contacto' });
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
