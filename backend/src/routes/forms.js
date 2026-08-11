// ============================================================
// Forms Routes — CRUD de formularios (PostgreSQL)
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const router = express.Router();

/**
 * Detectar si un string es base64 (data URI)
 */
function esBase64DataURI(val) {
  return typeof val === 'string' && /^data:image\/[a-zA-Z]+;base64,/.test(val);
}

/**
 * Subir una firma/foto base64 a MinIO y devolver la ruta.
 *
 * Además registra un archivo en la tabla `archivos` (igual que fotos y
 * videos) para que `/api/archivos/formulario/:id` pueda encontrarla y
 * servirla de forma autenticada. Antes solo se subía a MinIO y la ruta
 * INTERNA quedaba guardada en formularios.firma_* — esa ruta no es ni
 * base64 ni una URL, así que <Image> no podía cargarla: la firma se veía
 * bien justo al terminar el formulario (todavía en base64 en memoria) y
 * se ponía en blanco en cuanto sincronizaba, en cualquier dispositivo,
 * incluido el mismo que la capturó.
 */
async function subirBase64AMinIO(req, data, tipo, prefijo, tipoFormulario, benefItem, benefNombre, formularioId) {
  if (!esBase64DataURI(data)) return data; // ya es ruta o null

  const matches = data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  const buffer = Buffer.from(matches[2], 'base64');
  const mimetype = matches[1];
  const timestamp = Date.now();
  const filename = `${prefijo}_${timestamp}.png`;
  const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
  const formFolder = storage.getFormTypeFolder(tipoFormulario);

  await storage.uploadFile(
    req.user.rol, req.user.usuario, 'firmas', filename, buffer,
    {
      contentType: mimetype,
      tipoFormulario,
      beneficiarioItem: benefItem,
      beneficiarioNombre: benefNombre,
    }
  );

  // La rama "sin beneficiario" debe calcar exactamente storage.js#getFilePath
  // (sin formFolder) — antes incluía formFolder aquí y la ruta guardada en
  // BD no coincidía con la ruta real donde uploadFile() la dejó en MinIO,
  // dando 404 al intentar servirla. Solo se nota cuando la cédula del
  // beneficiario no matchea ningún registro (benefItem/benefNombre quedan
  // null) — poco común pero posible, y sin este ajuste la firma tampoco se
  // podría recuperar en ese caso.
  let minioPath;
  if (benefItem && benefNombre) {
    const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
    minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/firmas/${filename}` : `${basePath}/${subpath}/firmas/${filename}`;
  } else {
    minioPath = `${basePath}/firmas/${filename}`;
  }

  // Igual que en photos.js: el SELECT evita violar la FK si la firma llega
  // en el mismo request que crea el formulario por primera vez (formulario_id
  // aún no existe) — queda NULL y metadata_json.formulario_id permite
  // vincularla más abajo, en el bloque que ya reconcilia fotos/videos.
  try {
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    await db.query(
      `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.user.id,
        formularioId,
        'firma',
        filename,
        `firma_${tipo}.png`,
        mimetype,
        buffer.length,
        minioPath,
        bucket,
        JSON.stringify({ tipo_firma: tipo, formulario_id: formularioId }),
      ]
    );
  } catch (archivoErr) {
    console.warn('[Forms] No se pudo registrar la firma en archivos:', archivoErr.message);
  }

  return minioPath;
}

// POST /api/formularios/guardar
router.post('/guardar', authenticateToken, async (req, res) => {
  try {
    const formulario = req.body;

    if (!formulario || !formulario.id) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Formulario inválido: id requerido',
      });
    }

    // Extraer campos del formulario para mapear al esquema
    const tecnico = formulario.tecnico || {};
    const beneficiario = formulario.beneficiario || {};
    const actividad = formulario.actividad || {};
    const coordenadas = formulario.coordenadas || {};
    const fotos = formulario.fotos || [];

    // sociodemografico/caracterizacion_nueva/georeferencia/clima son
    // OPCIONALES de verdad: si el cliente no los manda, se guarda NULL, no
    // '{}'. Antes se guardaba '{}' y cualquier consumidor que hiciera
    // `if (formulario.georeferencia)` para decidir si mostrar esa sección
    // veía un objeto "verdadero" sin datos adentro — el PDF, por ejemplo,
    // intentaba leer `georeferencia.coordenadas.latitud` sobre un objeto
    // vacío y reventaba. En memoria, recién completado, el campo SÍ era
    // undefined (correcto); solo se corrompía a '{}' después de pasar por
    // aquí y volver — de ahí que el bug solo apareciera tras sincronizar.
    const sociodemografico = formulario.sociodemografico || null;
    const caracterizacion = formulario.caracterizacion_nueva || null;
    const georeferencia = formulario.georeferencia || null;
    const clima = formulario.clima || null;
    const jsonOrNull = (v) => (v ? JSON.stringify(v) : null);

    // El tipo debe respetar el CHECK del esquema. Antes se usaba
    // `|| 'desconocido'`, que lo viola y provoca un 500 genérico: el técnico
    // perdía el envío sin saber por qué.
    const TIPOS_VALIDOS = ['visita', 'visita_tecnica', 'caracterizacion', 'capacitacion'];
    if (!TIPOS_VALIDOS.includes(formulario.tipo)) {
      return res.status(400).json({
        estado: 'error',
        mensaje: `Tipo de formulario inválido: "${formulario.tipo}". Válidos: ${TIPOS_VALIDOS.join(', ')}`,
      });
    }

    // Solo se guarda la URL del PDF si es remota: los formularios traen la ruta
    // LOCAL del teléfono (file:///...), que no sirve para nadie más.
    const pdfUrlRemoto =
      typeof formulario.pdf_url === 'string' && !formulario.pdf_url.startsWith('file://')
        ? formulario.pdf_url
        : null;

    const existente = await db.queryOne('SELECT id FROM formularios WHERE id = $1', [formulario.id]);

    // Subir firmas base64 a MinIO si vienen en ese formato
    const tipoFormulario = formulario.tipo;
    // Resolver datos del beneficiario para la estructura de carpetas en MinIO
    let benefItem = null;
    let benefNombre = null;
    if (beneficiario?.cedula) {
      try {
        const benef = await db.queryOne(
          'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
          [beneficiario.cedula.trim()]
        );
        if (benef) {
          benefItem = benef.item;
          benefNombre = beneficiario.nombre || benef.nombre_completo;
        }
      } catch (lookupErr) {
        console.warn('[Forms] Error buscando beneficiario:', lookupErr.message);
      }
    }

    const firmaBeneficiario = await subirBase64AMinIO(req, formulario.firma_beneficiario, 'beneficiario', `firma_beneficiario_${formulario.id}`, tipoFormulario, benefItem, benefNombre, formulario.id);
    const firmaTecnico = await subirBase64AMinIO(req, formulario.firma_tecnico, 'tecnico', `firma_tecnico_${formulario.id}`, tipoFormulario, benefItem, benefNombre, formulario.id);

    if (existente) {
      await db.query(
        `UPDATE formularios SET
          tipo = $1, usuario_id = $2,
          tecnico_json = $3,
          beneficiario_json = $4, actividad_json = $5,
          sociodemografico_json = $6, caracterizacion_nueva_json = $7,
          coordenadas_json = $8, georeferencia_json = $9,
          clima_json = $10, fotos_json = $11,
          firma_beneficiario = $12, firma_tecnico = $13,
          huella_beneficiario = $14,
          pdf_url = COALESCE($15, pdf_url),
          sincronizado = TRUE,
          -- Usar la hora REAL en que el técnico completó el formulario, no
          -- la de llegada al servidor. Con NOW() el servidor SIEMPRE quedaba
          -- "más nuevo" que la copia local (por la latencia de red, aunque
          -- fuera de segundos) — la próxima vez que el dispositivo fusionaba
          -- datos del servidor, esa comparación de fechas hacía que la copia
          -- local completa (fotos con ruta válida en ese teléfono, etc.) se
          -- sobrescribiera con la versión "adelgazada" que viaja por la red.
          -- Esto pasaba SIEMPRE, en cada formulario, tras el primer sync.
          updated_at = COALESCE($16::timestamp, NOW())
         WHERE id = $17`,
        [
          formulario.tipo,
          req.user.id,
          JSON.stringify(tecnico),
          JSON.stringify(beneficiario),
          JSON.stringify(actividad),
          jsonOrNull(sociodemografico),
          jsonOrNull(caracterizacion),
          JSON.stringify(coordenadas),
          jsonOrNull(georeferencia),
          jsonOrNull(clima),
          JSON.stringify(fotos),
          firmaBeneficiario,
          firmaTecnico,
          formulario.huella_beneficiario || false,
          pdfUrlRemoto,
          formulario.updated_at ? new Date(formulario.updated_at) : null,
          formulario.id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO formularios
          (id, tipo, usuario_id, tecnico_json,
           beneficiario_json, actividad_json,
           sociodemografico_json, caracterizacion_nueva_json,
           coordenadas_json, georeferencia_json, clima_json,
           fotos_json, firma_beneficiario, firma_tecnico,
           huella_beneficiario, pdf_url, sincronizado, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE,
                 COALESCE($17::timestamp, NOW()))`,
        [
          formulario.id,
          formulario.tipo,
          req.user.id,
          JSON.stringify(tecnico),
          JSON.stringify(beneficiario),
          JSON.stringify(actividad),
          jsonOrNull(sociodemografico),
          jsonOrNull(caracterizacion),
          JSON.stringify(coordenadas),
          jsonOrNull(georeferencia),
          jsonOrNull(clima),
          JSON.stringify(fotos),
          firmaBeneficiario,
          firmaTecnico,
          formulario.huella_beneficiario || false,
          pdfUrlRemoto,
          // COALESCE en el SQL: pasar null ANULABA el DEFAULT now() y dejaba
          // formularios sin fecha, rompiendo el orden y los conteos.
          formulario.created_at ? new Date(formulario.created_at) : null,
        ]
      );
    }

    // Vincular las evidencias que llegaron ANTES que el formulario.
    // En campo las fotos y videos se suben apenas hay señal, mientras el
    // formulario puede tardar en sincronizar; en ese momento la FK impide
    // rellenar archivos.formulario_id, así que el vínculo queda en
    // metadata_json y se reconcilia aquí, ya con el formulario existente.
    try {
      const vinculadas = await db.query(
        `UPDATE archivos
            SET formulario_id = $1
          WHERE formulario_id IS NULL
            AND metadata_json->>'formulario_id' = $1`,
        [formulario.id]
      );
      if (vinculadas?.rowCount > 0) {
        console.log(`[Forms] ${vinculadas.rowCount} evidencia(s) vinculadas a ${formulario.id}`);
      }
    } catch (linkErr) {
      // No debe impedir guardar el formulario
      console.warn('[Forms] No se pudieron vincular evidencias:', linkErr.message);
    }

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, existente ? 'actualizar_formulario' : 'guardar_formulario',
       JSON.stringify({ formulario_id: formulario.id, tipo: formulario.tipo })]
    );

    console.log(`[Forms] Formulario ${existente ? 'actualizado' : 'guardado'}: ${formulario.id} (${formulario.tipo})`);

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

// GET /api/formularios — listar todos (con filtros opcionales)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { tipo, usuario_id, desde, hasta, limit, offset, vista } = req.query;
    // El calendario es universal: técnico, supervisor, interventor, gerente
    // y admin deben ver EXACTAMENTE las mismas visitas realizadas, sin el
    // filtro de "solo mis formularios" ni la jerarquía de aprobación (que
    // gobierna el flujo de revisión, no la visibilidad en el calendario).
    const esVistaCalendario = vista === 'calendario';
    let sql = `
      SELECT id, tipo, usuario_id,
        tecnico_json,
        beneficiario_json, actividad_json, sociodemografico_json,
        caracterizacion_nueva_json, coordenadas_json, georeferencia_json,
        clima_json, fotos_json, firma_beneficiario, firma_tecnico,
        huella_beneficiario, pdf_url, sincronizado, created_at, updated_at
      FROM formularios WHERE 1=1`;
    const params = [];
    let paramIdx = 1;

    if (tipo) { sql += ` AND tipo = $${paramIdx++}`; params.push(tipo); }
    if (usuario_id) { sql += ` AND usuario_id = $${paramIdx++}`; params.push(usuario_id); }
    if (desde) { sql += ` AND created_at >= $${paramIdx++}`; params.push(desde); }
    if (hasta) { sql += ` AND created_at <= $${paramIdx++}`; params.push(hasta); }

    if (!esVistaCalendario) {
      // Filtro por rol: si es técnico, solo ve sus formularios
      if (req.user.rol === 'tecnico') {
        sql += ` AND usuario_id = $${paramIdx++}`;
        params.push(req.user.id);
      }

      // Jerarquía de control: el INTERVENTOR solo ve formularios que ya
      // tienen el visto bueno del SUPERVISOR (orden: técnico → supervisor
      // → interventor). Supervisor, gerente y admin ven todo.
      if (req.user.rol === 'interventor') {
        sql += ` AND id IN (
          SELECT formulario_id FROM revisiones_formulario
          WHERE revisor_rol = 'supervisor' AND tipo = 'visto_bueno'
        )`;
      }
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) { sql += ` LIMIT $${paramIdx++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${paramIdx++}`; params.push(parseInt(offset)); }

    const formularios = await db.queryAll(sql, params);

    // En vista=calendario un técnico ve TODAS las visitas (quién, a quién,
    // cuándo) para que el calendario sea universal, pero NO debe poder ver
    // el contenido detallado de una visita que no es suya (fotos, firmas,
    // huella, actividad, sociodemográfico, coordenadas, clima, PDF). Se
    // recorta esa información aquí; supervisor/interventor/gerente/admin no
    // se ven afectados.
    const CAMPOS_DETALLE_SENSIBLE = [
      'actividad_json', 'sociodemografico_json', 'caracterizacion_nueva_json',
      'coordenadas_json', 'georeferencia_json', 'clima_json', 'fotos_json',
      'firma_beneficiario', 'firma_tecnico', 'huella_beneficiario', 'pdf_url',
    ];
    const resultado = (esVistaCalendario && req.user.rol === 'tecnico')
      ? formularios.map((f) => {
          if (f.usuario_id === req.user.id) return f;
          const limitado = { ...f };
          for (const campo of CAMPOS_DETALLE_SENSIBLE) limitado[campo] = null;
          return limitado;
        })
      : formularios;

    res.json({
      estado: 'ok',
      total: resultado.length,
      formularios: resultado,
    });
  } catch (error) {
    console.error('[Forms] Listar error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar formularios' });
  }
});

// GET /api/formularios/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    let sql = `SELECT id, tipo, usuario_id,
        tecnico_json,
        beneficiario_json, actividad_json, sociodemografico_json,
        caracterizacion_nueva_json, coordenadas_json, georeferencia_json,
        clima_json, fotos_json, firma_beneficiario, firma_tecnico,
        huella_beneficiario, pdf_url, sincronizado, created_at, updated_at
       FROM formularios WHERE id = $1`;
    const params = [req.params.id];

    // Filtro por rol: si es técnico, solo puede ver sus propios formularios
    if (req.user.rol === 'tecnico') {
      sql += ' AND usuario_id = $2';
      params.push(req.user.id);
    }

    // Jerarquía: interventor solo ve formularios ya aprobados por supervisor
    if (req.user.rol === 'interventor') {
      sql += ` AND id IN (
        SELECT formulario_id FROM revisiones_formulario
        WHERE revisor_rol = 'supervisor' AND tipo = 'visto_bueno'
      )`;
    }

    const form = await db.queryOne(sql, params);
    if (!form) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    }
    res.json({ estado: 'ok', formulario: form });
  } catch (error) {
    console.error('[Forms] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener formulario' });
  }
});

// DELETE /api/formularios/:id — Solo admin puede eliminar
//
// Borrado EN CASCADA de todo el árbol que depende del formulario: antes
// solo se borraba la fila `formularios` y, de rebote, la FK con
// ON DELETE CASCADE de `archivos` (fotos/videos/firmas) — pero
// `revisiones_formulario`, `notificaciones` y `revision_evidencia_formulario`
// no tienen FK (quedaban huérfanas apuntando a un formulario inexistente),
// `mediciones`/`plantaciones` solo perdían el vínculo (ON DELETE SET NULL,
// quedaban vivas pero sueltas), y los objetos físicos en MinIO nunca se
// borraban (storage.deleteFile() existía pero nadie la llamaba desde aquí).
// Los PDFs generados no llevan `archivos.formulario_id` (solo quedó en
// metadata_json, ver subirBase64AMinIO/pdfs.js), por eso el SELECT de abajo
// busca por ambos.
router.delete('/:id', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar formularios' });
  }

  const formularioId = req.params.id;
  const client = await db.pool.connect();
  let archivosParaBorrar = [];
  let deleted = false;

  try {
    await client.query('BEGIN');

    const archivosResult = await client.query(
      `SELECT id, minio_path FROM archivos
        WHERE formulario_id = $1 OR metadata_json->>'formulario_id' = $1`,
      [formularioId]
    );
    archivosParaBorrar = archivosResult.rows;

    await client.query('DELETE FROM revisiones_formulario WHERE formulario_id = $1', [formularioId]);
    await client.query('DELETE FROM notificaciones WHERE formulario_id = $1', [formularioId]);
    await client.query('DELETE FROM revision_evidencia_formulario WHERE formulario_id = $1', [formularioId]);
    await client.query('DELETE FROM mediciones WHERE formulario_id = $1', [formularioId]);
    await client.query('DELETE FROM plantaciones WHERE formulario_id = $1', [formularioId]);
    await client.query(
      `DELETE FROM archivos WHERE formulario_id = $1 OR metadata_json->>'formulario_id' = $1`,
      [formularioId]
    );

    const result = await client.query('DELETE FROM formularios WHERE id = $1 RETURNING id', [formularioId]);
    deleted = result.rowCount > 0;

    if (deleted) {
      await client.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'eliminar_formulario', JSON.stringify({
          formulario_id: formularioId,
          archivos_borrados: archivosParaBorrar.length,
        })]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('[Forms] Delete error:', error);
    return res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar formulario' });
  }
  client.release();

  if (!deleted) {
    return res.json({ estado: 'error', mensaje: 'Formulario no encontrado' });
  }

  // Borrado físico en MinIO — fuera de la transacción de Postgres (no es
  // atómico con la BD a propósito: los registros ya quedaron consistentes;
  // si un objeto puntual falla aquí, queda huérfano en el bucket pero no
  // bloquea ni corrompe nada).
  let archivosFisicosBorrados = 0;
  for (const archivo of archivosParaBorrar) {
    const ok = await storage.deleteFile(archivo.minio_path);
    if (ok) archivosFisicosBorrados++;
  }

  res.json({
    estado: 'ok',
    mensaje: 'Formulario eliminado junto con revisiones, notificaciones, mediciones, plantaciones y archivos asociados',
    archivos_totales: archivosParaBorrar.length,
    archivos_fisicos_eliminados: archivosFisicosBorrados,
  });
});

module.exports = router;
