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
  const filename = `${prefijo}.png`;
  const formFolder = storage.getFormTypeFolder(tipoFormulario);

  const objetoMinio = await storage.uploadFile(
    req.user.rol, req.user.usuario, 'firmas', filename, buffer,
    {
      contentType: mimetype,
      tipoFormulario,
      beneficiarioItem: benefItem,
      beneficiarioNombre: benefNombre,
    }
  );
  const minioPath = objetoMinio.path;

  // Igual que en photos.js: el SELECT evita violar la FK si la firma llega
  // en el mismo request que crea el formulario por primera vez (formulario_id
  // aún no existe) — queda NULL y metadata_json.formulario_id permite
  // vincularla más abajo, en el bloque que ya reconcilia fotos/videos.
  const bucket = objetoMinio.bucket || process.env.MINIO_BUCKET || 'geodaily-archivos';
  const idLocal = `${formularioId}:firma:${tipo}`;
  await db.query(
    `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json, evidencia_local_id)
     VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (usuario_id, evidencia_local_id) WHERE evidencia_local_id IS NOT NULL
     DO UPDATE SET
       formulario_id = COALESCE(EXCLUDED.formulario_id, archivos.formulario_id),
       filename = EXCLUDED.filename,
       originalname = EXCLUDED.originalname,
       mimetype = EXCLUDED.mimetype,
       size_bytes = EXCLUDED.size_bytes,
       minio_path = EXCLUDED.minio_path,
       minio_bucket = EXCLUDED.minio_bucket,
       metadata_json = EXCLUDED.metadata_json`,
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
      idLocal,
    ]
  );

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

    // Este id fue borrado explícitamente (ver DELETE /:id). Sin este check,
    // cualquier dispositivo que aún conserve una copia local de ese
    // formulario (el técnico que lo creó, un interventor que lo vio, etc.)
    // lo vuelve a subir en su próximo sync y el upsert de abajo lo recrea
    // como si fuera nuevo — la visita "resucita" tras haberla eliminado.
    const tumba = await db.queryOne(
      'SELECT id FROM formularios_eliminados WHERE id = $1',
      [formulario.id]
    );
    if (tumba) {
      return res.status(410).json({
        estado: 'eliminado',
        mensaje: 'Este formulario fue eliminado por un administrador y no puede volver a guardarse',
        id: formulario.id,
      });
    }

    // Extraer campos del formulario para mapear al esquema
    const tecnico = formulario.tecnico || {};
    const beneficiario = formulario.beneficiario || {};
    const actividad = formulario.actividad || {};
    const coordenadas = formulario.coordenadas || {};
    let fotos = formulario.fotos || [];

    // Filtrar evidencias que un admin/coordinador borró individualmente (ver
    // DELETE /api/archivos/:id). Este POST sube el formulario COMPLETO con su
    // lista de fotos, así que sin este filtro cualquier dispositivo que aún
    // conserve la foto en su almacenamiento local la reinsertaría en
    // fotos_json en el próximo sync y la evidencia "resucitaría".
    try {
      const tumbasEvidencia = await db.queryAll(
        `SELECT archivo_id, evidencia_local_id FROM evidencias_eliminadas WHERE formulario_id = $1`,
        [formulario.id]
      );
      if (tumbasEvidencia.length > 0) {
        const idsLocales = new Set(
          tumbasEvidencia.map((t) => t.evidencia_local_id).filter(Boolean)
        );
        const idsArchivo = new Set(
          tumbasEvidencia
            .map((t) => t.archivo_id)
            .filter((v) => v !== null && v !== undefined)
            .map(String)
        );
        const antes = fotos.length;
        fotos = fotos.filter((f) => {
          if (!f) return false;
          if (f.id && idsLocales.has(f.id)) return false;
          if (f.archivo_id && idsArchivo.has(String(f.archivo_id))) return false;
          return true;
        });
        if (fotos.length !== antes) {
          console.log(`[Forms] 🗑️ ${antes - fotos.length} evidencia(s) eliminada(s) filtrada(s) de ${formulario.id}`);
        }
      }
    } catch (evidErr) {
      console.warn('[Forms] No se pudo filtrar evidencias eliminadas:', evidErr.message);
    }

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

    const existente = await db.queryOne(
      'SELECT id, usuario_id, tecnico_json FROM formularios WHERE id = $1',
      [formulario.id]
    );

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

    // Blindaje anti-"resurrección": si este formulario ya existe y el
    // beneficiario fue reasignado a otro técnico desde que este dispositivo
    // guardó su copia local, NO se debe pisar usuario_id/tecnico_json con el
    // snapshot viejo que trae el dispositivo — eso deshace en silencio la
    // reasignación hecha en PUT /api/beneficiarios/:item/asignacion. El resto
    // del contenido (fotos, clima, coordenadas) sí se sigue guardando normal.
    let usuarioIdParaGuardar = req.user.id;
    let tecnicoJsonParaGuardar = JSON.stringify(tecnico);
    if (existente && benefItem) {
      const benefActual = await db.queryOne(
        'SELECT tecnico_asignado_id FROM beneficiarios WHERE item = $1',
        [benefItem]
      );
      if (benefActual?.tecnico_asignado_id && benefActual.tecnico_asignado_id !== req.user.id) {
        // node-pg devuelve tecnico_json ya parseado (columna jsonb) — hay
        // que volver a serializarlo para usarlo como bind del UPDATE.
        usuarioIdParaGuardar = existente.usuario_id;
        tecnicoJsonParaGuardar = JSON.stringify(existente.tecnico_json);
        console.warn(`[Forms] 🛡️ Formulario ${formulario.id}: se preserva atribución vigente (usuario_id=${existente.usuario_id}) — sincronizado por ${req.user.id}, distinto del técnico actual del beneficiario`);
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
          usuarioIdParaGuardar,
          tecnicoJsonParaGuardar,
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

    // Un formulario completado deja de aparecer como borrador en cualquier
    // dispositivo. Si esta limpieza falla, el endpoint de borradores lo
    // excluye igualmente mientras exista la fila completada.
    try {
      await db.query(
        'DELETE FROM formularios_borradores WHERE id = $1 AND usuario_id = $2',
        [formulario.id, req.user.id]
      );
    } catch (draftErr) {
      console.warn('[Forms] No se pudo limpiar el borrador remoto:', draftErr.message);
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

    const cedulaBeneficiario = (formulario.beneficiario && formulario.beneficiario.cedula) || null;
    const visitaNumero = Number((formulario.actividad && formulario.actividad.visita_numero) ?? 0);
    if (cedulaBeneficiario && Number.isInteger(visitaNumero) && visitaNumero >= 1 && visitaNumero <= 12) {
      await db.query(
        `UPDATE visitas_programadas
           SET estado = 'realizada',
               titulo = COALESCE(titulo, '')
         WHERE beneficiario_cedula = $1
           AND actividad_numero = $2
           AND estado = 'pendiente'`,
        [cedulaBeneficiario, visitaNumero]
      );
    }

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
    // El calendario es universal: técnico, coordinador, interventor, gerente
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

      // Interventor es un rol superior: ve todos los formularios igual que
      // coordinador, gerente y admin (sin filtro de "visto bueno" previo).
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) { sql += ` LIMIT $${paramIdx++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${paramIdx++}`; params.push(parseInt(offset)); }

    const formularios = await db.queryAll(sql, params);

    // En vista=calendario un técnico ve TODAS las visitas (quién, a quién,
    // cuándo) para que el calendario sea universal, pero NO debe poder ver
    // el contenido detallado de una visita que no es suya (fotos, firmas,
    // huella, actividad, sociodemográfico, coordenadas, clima, PDF). Se
    // recorta esa información aquí; coordinador/interventor/gerente/admin no
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

// ── PATCH /api/formularios/:id/respuesta — Completar o corregir una respuesta ──
//
// El detalle del formulario le muestra un botón "✎ Completar" junto a las
// preguntas de la Encuesta Social que quedaron "Sin responder" y un botón
// "✎ Corregir" junto a las que ya tienen respuesta. Además del admin, el
// técnico puede completar/corregir SUS PROPIOS formularios (se valida abajo
// contra `usuario_id`). Esta ruta escribe el valor dentro de
// `caracterizacion_nueva_json`.
//
// El cuerpo acepta `modo: 'completar' | 'corregir'` (por defecto 'completar'
// para no romper clientes viejos):
//   - 'completar': solo escribe si la pregunta está vacía; si ya tiene
//     respuesta responde 409 (comportamiento histórico).
//   - 'corregir': sobrescribe el valor existente (el técnico corrige un dato
//     mal capturado). Requiere que la pregunta ya tenga respuesta.
// La lista de rutas permitidas es el espejo de RUTAS_RESPUESTAS_FORMULARIO_1
// en la app — cualquier path fuera de ella se rechaza para que un cliente
// manipulado no escriba en campos arbitrarios.
const RUTAS_RESPUESTA_PERMITIDAS = new Set([
  'fecha', 'municipio', 'vereda', 'productor_nombre', 'edad', 'sexo',
  'sexo_otro',
  'documento', 'telefono', 'tecnico_responsable', 'corregimiento',
  'componente_social.reconocimiento',
  'componente_social.reconocimiento_otro',
  'componente_social.nivel_educativo',
  'componente_social.participo_eca',
  'componente_social.personas_nucleo',
  'componente_social.fuente_ingresos',
  'componente_social.fuente_ingresos_otra',
  'componente_social.ingresos_salarios',
  'componente_social.ocupacion_secundaria',
  'componente_social.ocupacion_secundaria_otro',
  'componente_social.participa_organizacion',
  'componente_social.organizacion_cual',
  'componente_social.tipo_asociacion',
  'componente_social.tipo_asociacion_otro',
  'componente_social.rol_asociacion',
  'componente_social.vivienda_ubicacion',
  'componente_social.vivienda_ubicacion_otra',
  'componente_social.energia_electrica',
  'componente_social.tipo_energia',
  'componente_social.tipo_energia_otro',
  'componente_social.agua_consumo',
  'componente_social.agua_consumo_otro',
  'componente_social.elementos_tecnologicos',
  'componente_social.senal_celular',
  'componente_social.quienes_trabajan',
  'componente_social.quienes_trabajan_otro',
  'componente_social.medio_transporte',
  'componente_social.medio_transporte_otro',
  'caracterizacion_finca.nombre_finca',
  'caracterizacion_finca.latitud',
  'caracterizacion_finca.longitud',
  'caracterizacion_finca.altitud',
  'caracterizacion_finca.area_total',
  'caracterizacion_finca.division_bosque',
  'caracterizacion_finca.division_agricola',
  'caracterizacion_finca.division_pecuaria',
  'caracterizacion_finca.division_instalaciones',
  'caracterizacion_finca.medio_salida',
  'caracterizacion_finca.distancia_km',
  'caracterizacion_finca.distancia_observaciones',
  'caracterizacion_finca.aprovechamiento_directo',
  'caracterizacion_finca.aprovechamiento_porque',
  'caracterizacion_finca.actividades_finca',
  'caracterizacion_finca.actividades_finca_otro',
  'caracterizacion_finca.actividades_agricolas',
  'caracterizacion_finca.actividades_agricolas_otro',
  'caracterizacion_finca.actividades_pecuarias',
  'caracterizacion_finca.actividades_pecuarias_otro',
  'componente_productivo.actividad_principal',
  'componente_productivo.actividad_principal_cual',
  'componente_productivo.acceso_agua',
  'componente_productivo.sistemas_riego',
  'componente_productivo.asistencia_tecnica',
  'analisis_suelo.intervencion_latitud',
  'analisis_suelo.intervencion_longitud',
  'analisis_suelo.intervencion_altitud',
  'analisis_suelo.analisis_realizado',
  'analisis_suelo.textura',
  'analisis_suelo.color',
  'analisis_suelo.drenaje',
  'analisis_suelo.uso_tierra',
  'analisis_suelo.piedras',
  'analisis_suelo.compactacion',
  'analisis_suelo.cobertura',
  'analisis_suelo.erosion',
  'analisis_suelo.pendiente',
  'componente_agroambiental.procesos_erosion',
  'componente_agroambiental.fuentes_hidricas',
  'componente_agroambiental.areas_conservacion',
  'componente_agroambiental.practicas_conservacion',
  'componente_agroambiental.uso_agroquimicos',
  'componente_agroambiental.tipo_agroquimicos',
  'componente_agroambiental.tipo_agroquimicos_otro',
  'componente_agroambiental.herbicidas_cuales',
  'componente_agroambiental.manejo_residuos',
  'recomendaciones.recomendaciones_tecnicas',
  'recomendaciones.compromisos_productor',
  'recomendaciones.recomendaciones_ambientales',
  'acompaniamiento.actividades_realizadas_obs',
  'acompaniamiento.manejo_plagas_hectareas',
  'acompaniamiento.manejo_suelo_cantidad',
  'acompaniamiento.capacitacion_obs',
  'acompaniamiento.seguimiento_obs',
  'acompaniamiento.entresacado_obs',
  'acompaniamiento.observaciones_visita',
]);

router.patch('/:id/respuesta', authenticateToken, async (req, res) => {
  const esAdmin = req.user.rol === 'admin';
  const esTecnico = req.user.rol === 'tecnico';
  if (!esAdmin && !esTecnico) {
    return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para completar respuestas' });
  }

  const { path, value, modo } = req.body || {};
  const esCorreccion = modo === 'corregir';
  if (typeof path !== 'string' || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ estado: 'error', mensaje: 'Se requiere path y un valor no vacío' });
  }
  if (!RUTAS_RESPUESTA_PERMITIDAS.has(path)) {
    return res.status(400).json({ estado: 'error', mensaje: `Ruta de respuesta no permitida: ${path}` });
  }

  try {
    const form = await db.queryOne(
      // El dueño se resuelve con el MISMO criterio que usa la app al mostrar
      // el botón «✎ Completar»: el snapshot `tecnico_json.usuario_id` es la
      // atribución vigente (lo reescribe PUT /api/beneficiarios/:item/asignacion
      // al reasignar el beneficiario, y POST /guardar lo protege de snapshots
      // viejos) y la columna `usuario_id` queda como respaldo. Comparar solo
      // contra la columna dejaba fuera a los formularios creados "a nombre
      // de" un técnico por un supervisor/interventor/admin, donde la columna
      // guarda al creador y el snapshot al responsable real de la visita.
      `SELECT caracterizacion_nueva_json,
              COALESCE(NULLIF(tecnico_json->>'usuario_id', ''), usuario_id) AS usuario_id
         FROM formularios WHERE id = $1`,
      [req.params.id]
    );
    if (!form) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    }

    // El técnico solo puede completar SUS propios formularios. El admin
    // puede completar cualquiera (es quien supervisa la calidad del dato).
    if (esTecnico && form.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo puedes completar tus propios formularios' });
    }

    const encuesta = (form.caracterizacion_nueva_json && typeof form.caracterizacion_nueva_json === 'object')
      ? { ...form.caracterizacion_nueva_json }
      : {};

    const partes = path.split('.');
    const [seccion, campo] = partes;

    if (partes.length > 1 && (!encuesta[seccion] || typeof encuesta[seccion] !== 'object')) {
      encuesta[seccion] = {};
    }
    const actual = partes.length === 1 ? encuesta[seccion] : encuesta[seccion][campo];
    const tieneRespuesta =
      actual !== undefined && actual !== null && String(actual).trim() !== '';

    if (esCorreccion) {
      // Corregir: solo tiene sentido si ya había una respuesta que reemplazar.
      if (!tieneRespuesta) {
        return res.status(409).json({
          estado: 'error',
          mensaje: 'Esa respuesta está vacía: usa «Completar» en vez de «Corregir»',
        });
      }
    } else if (tieneRespuesta) {
      // Completar: no se pisa una respuesta existente.
      return res.status(409).json({ estado: 'error', mensaje: 'Esa respuesta ya está completa' });
    }

    if (partes.length === 1) {
      encuesta[seccion] = value.trim();
    } else {
      encuesta[seccion] = { ...encuesta[seccion], [campo]: value.trim() };
    }

    // updated_at = NOW() a propósito: al ser más nuevo que la copia local, el
    // próximo merge del dispositivo trae la respuesta completada/corregida.
    await db.query(
      'UPDATE formularios SET caracterizacion_nueva_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(encuesta), req.params.id]
    );

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [
        req.user.id,
        esCorreccion ? 'corregir_respuesta' : 'completar_respuesta',
        JSON.stringify({ formulario_id: req.params.id, path, valor_anterior: esCorreccion ? actual : undefined }),
      ]
    );

    res.json({
      estado: 'ok',
      mensaje: esCorreccion ? 'Respuesta corregida' : 'Respuesta completada',
    });
  } catch (error) {
    console.error('[Forms] Completar/corregir respuesta error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la respuesta' });
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
const ROLES_PUEDEN_ELIMINAR_FORMULARIO = ['admin', 'coordinador', 'interventor'];

router.delete('/:id', authenticateToken, async (req, res) => {
  if (!ROLES_PUEDEN_ELIMINAR_FORMULARIO.includes(req.user.rol)) {
    return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para eliminar formularios' });
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
      // Deja constancia de que este id fue borrado a propósito — es lo que
      // POST /guardar revisa para no recrearlo si algún dispositivo todavía
      // lo tiene guardado localmente y lo reenvía.
      await client.query(
        `INSERT INTO formularios_eliminados (id, eliminado_por)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET eliminado_por = $2, eliminado_at = NOW()`,
        [formularioId, req.user.id]
      );

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
