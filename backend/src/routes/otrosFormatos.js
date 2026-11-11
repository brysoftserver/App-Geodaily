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
const { crearNotificacion } = require('./notificaciones');
const { debeAvisarActa, avisarActaCompletada } = require('../lib/avisoActaCompletada');
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

/** Campos de `datos` que guardan una firma (data URI). */
const CAMPOS_FIRMA = ['firma', 'firmaBeneficiario', 'firmaTecnico', 'firmaInterventoria'];

const esFirma = (v) => typeof v === 'string' && v.startsWith('data:image');

/** Fecha ISO válida del cliente, o null. Se ignoran las del futuro lejano (reloj del teléfono mal). */
const fechaValida = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) return null;
  return d;
};

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
    const obsoletos = [];

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

      const instancia = limpiarInstancia(tipo, f.instancia || datos.instancia);
      const previo = await db.queryOne(
        'SELECT datos, completo, cliente_updated_at FROM otros_formatos WHERE beneficiario_cedula = $1 AND tipo = $2 AND instancia = $3',
        [cedula, tipo, instancia]
      );

      // Subidas en desorden (señal débil, reintentos): si lo que llega es MÁS
      // VIEJO que lo guardado, no se pisa. Se cuenta como recibido para que el
      // teléfono no lo reintente para siempre; el servidor ya tiene lo nuevo.
      const clienteTs = fechaValida(f.updated_at);
      if (clienteTs && previo?.cliente_updated_at && clienteTs < new Date(previo.cliente_updated_at)) {
        console.log(`[OtrosFormatos] Versión vieja de ${f.id} ignorada (${clienteTs.toISOString()} < ${new Date(previo.cliente_updated_at).toISOString()})`);
        obsoletos.push(f.id);
        sincronizados++;
        continue;
      }

      // Una firma ya guardada nunca se reemplaza por vacío: la app no tiene
      // forma de "borrar" una firma (solo de volver a firmar), así que un
      // vacío es una copia desactualizada del teléfono (borrador viejo, firma
      // que no se pudo leer del archivo). La de interventoría además se pone
      // DESPUÉS desde supervisión y la copia del técnico nunca la trae.
      const dp = previo && (typeof previo.datos === 'string' ? JSON.parse(previo.datos) : previo.datos);
      if (dp && typeof dp === 'object') {
        const conservado = { ...datos };
        let tocado = false;
        for (const campo of CAMPOS_FIRMA) {
          if (esFirma(dp[campo]) && !esFirma(datos[campo])) {
            conservado[campo] = dp[campo];
            tocado = true;
          }
        }
        if (esFirma(dp.firmaInterventoria) && !esFirma(datos.firmaInterventoria)) {
          conservado.interventoriaNombre = dp.interventoriaNombre || datos.interventoriaNombre || '';
          conservado.interventoriaCargo = dp.interventoriaCargo || datos.interventoriaCargo || '';
        }
        // Lo que el técnico marcó como pendiente ya no lo está si la firma se conservó.
        if (tocado && Array.isArray(conservado.faltantes)) {
          conservado.faltantes = conservado.faltantes.filter(
            (x) =>
              !(x === 'Firma del beneficiario' && esFirma(conservado.firmaBeneficiario)) &&
              !(x === 'Firma del contratista (técnico)' && esFirma(conservado.firmaTecnico))
          );
        }
        if (tocado) {
          console.log(`[OtrosFormatos] ${f.id}: se conservaron firmas ya guardadas que la copia del teléfono traía vacías`);
        }
        datos = conservado;
      }

      // La interventoría puede haber firmado el BORRADOR del servidor desde las
      // entregas antes de que el técnico publicara: esa firma no se pierde.
      if (tipo === TIPO_MULTIPLE && !esFirma(datos.firmaInterventoria)) {
        const bor = await db.queryOne(
          'SELECT datos FROM otros_formatos_borradores WHERE id = $1',
          [idFormato(cedula, tipo, instancia)]
        );
        const dbor = bor && parsear(bor.datos);
        if (dbor && esFirma(dbor.firmaInterventoria)) {
          datos = {
            ...datos,
            firmaInterventoria: dbor.firmaInterventoria,
            interventoriaNombre: dbor.interventoriaNombre || datos.interventoriaNombre || '',
            interventoriaCargo: dbor.interventoriaCargo || datos.interventoriaCargo || '',
          };
          console.log(`[OtrosFormatos] ${f.id}: se tomó la firma de interventoría del borrador del servidor`);
        }
      }

      // El autor SIEMPRE es quien sube (nunca se confía en el tecnico_id que
      // manda el cliente): así el registro queda atribuido a su dueño real.
      await db.query(
        `INSERT INTO otros_formatos (
          id, tecnico_id, tecnico_nombre, tecnico_usuario,
          beneficiario_cedula, beneficiario_nombre, tipo, datos, completo,
          instancia, created_at, updated_at, cliente_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $11, $10, NOW(), $12)
         ON CONFLICT (beneficiario_cedula, tipo, instancia) DO UPDATE SET
           -- El PDF guardado solo sigue siendo válido si los datos no cambiaron.
           pdf_path = CASE WHEN otros_formatos.datos = EXCLUDED.datos THEN otros_formatos.pdf_path ELSE NULL END,
           tecnico_id = EXCLUDED.tecnico_id,
           tecnico_nombre = EXCLUDED.tecnico_nombre,
           tecnico_usuario = EXCLUDED.tecnico_usuario,
           beneficiario_nombre = EXCLUDED.beneficiario_nombre,
           datos = EXCLUDED.datos,
           completo = EXCLUDED.completo,
           cliente_updated_at = COALESCE(EXCLUDED.cliente_updated_at, otros_formatos.cliente_updated_at),
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
          clienteTs ? clienteTs.toISOString() : null,
        ]
      );
      sincronizados++;

      // Primera vez completada: aviso en la campanita a todos los interventores.
      const completo = f.completo === false ? false : true;
      if (debeAvisarActa({ tipo, completo, datos, previoCompleto: !!previo?.completo })) {
        await avisarActaCompletada({
          db,
          crearNotificacion,
          id: idFormato(cedula, tipo, instancia),
          cedula,
          instancia,
          datos,
          beneficiarioNombre: f.beneficiario_nombre || datos.nombre || null,
          tecnicoNombre: req.user.nombre || req.user.usuario,
        });
      }
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
      obsoletos,
    });
  } catch (error) {
    console.error('[OtrosFormatos] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar otros formatos' });
  }
});

// ------------------------------------------------------------
// Borradores de formatos (hoy: Acta de Entrega) respaldados en el servidor
// ------------------------------------------------------------
// El técnico diligencia el acta (con firmas) y la app sube el borrador en
// segundo plano en cada guardado. Así el trabajo no depende de que
// "Completar" funcione en el teléfono y se ve desde otro dispositivo (tablet)
// con la misma cuenta. Tabla aparte (otros_formatos_borradores): bitácora,
// revisión y evidencias siguen viendo solo actas publicadas.
// Reglas: la versión más nueva del cliente gana; una firma guardada nunca se
// reemplaza por vacío; nunca se borra nada.

const MAX_BORRADOR_BYTES = 8 * 1024 * 1024;

router.put('/borradores/:id', authenticateToken, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim().slice(0, 160);
    const tipo = String(req.body?.tipo || '').trim();
    const cedula = String(req.body?.beneficiario_cedula || '').trim();
    let datos = req.body?.datos;
    if (typeof datos === 'string') {
      try {
        datos = JSON.parse(datos);
      } catch {
        return res.status(400).json({ estado: 'error', mensaje: 'Los datos del borrador no son JSON válido' });
      }
    }
    if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ estado: 'error', mensaje: `Tipo no válido: ${tipo}` });
    if (!cedula) return res.status(400).json({ estado: 'error', mensaje: 'Falta la cédula del beneficiario' });
    if (!datos || typeof datos !== 'object') return res.status(400).json({ estado: 'error', mensaje: 'El borrador no trae datos' });
    const instancia = limpiarInstancia(tipo, req.body?.instancia || datos.instancia);
    if (id !== idFormato(cedula, tipo, instancia)) {
      return res.status(400).json({ estado: 'error', mensaje: 'El id no corresponde al formato' });
    }
    const json = JSON.stringify(datos);
    if (Buffer.byteLength(json) > MAX_BORRADOR_BYTES) {
      return res.status(413).json({ estado: 'error', mensaje: 'El borrador es demasiado grande' });
    }

    const previo = await db.queryOne(
      'SELECT tecnico_id, datos, cliente_updated_at FROM otros_formatos_borradores WHERE id = $1',
      [id]
    );
    if (previo && previo.tecnico_id !== req.user.id && !esSuperior(req.user)) {
      return res.status(409).json({ estado: 'ajeno', mensaje: 'El borrador pertenece a otro técnico' });
    }
    const clienteTs = fechaValida(req.body?.updated_at);
    if (clienteTs && previo?.cliente_updated_at && clienteTs <= new Date(previo.cliente_updated_at)) {
      return res.json({ estado: 'ok', obsoleto: true });
    }
    // Firmas ya guardadas: nunca se reemplazan por vacío.
    const dp = previo && (typeof previo.datos === 'string' ? JSON.parse(previo.datos) : previo.datos);
    let final = datos;
    if (dp && typeof dp === 'object') {
      final = { ...datos };
      for (const campo of CAMPOS_FIRMA) {
        if (esFirma(dp[campo]) && !esFirma(datos[campo])) final[campo] = dp[campo];
      }
      // Firma de interventoría conservada → también quién firmó.
      if (esFirma(dp.firmaInterventoria) && !esFirma(datos.firmaInterventoria)) {
        final.interventoriaNombre = dp.interventoriaNombre || datos.interventoriaNombre || '';
        final.interventoriaCargo = dp.interventoriaCargo || datos.interventoriaCargo || '';
      }
      // La actividad del acta tampoco se pierde (copias de versiones viejas de la app no la traen).
      if (dp.actividadId && !final.actividadId) final.actividadId = dp.actividadId;
    }

    await db.query(
      `INSERT INTO otros_formatos_borradores
         (id, tecnico_id, tecnico_usuario, beneficiario_cedula, tipo, instancia, datos, cliente_updated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         datos = EXCLUDED.datos,
         -- El dueño (tecnico_id/usuario) no cambia aunque guarde un rol superior.
         cliente_updated_at = COALESCE(EXCLUDED.cliente_updated_at, otros_formatos_borradores.cliente_updated_at),
         updated_at = NOW()`,
      [
        id,
        previo?.tecnico_id || req.user.id,
        req.user.usuario || null,
        cedula,
        tipo,
        instancia,
        JSON.stringify(final),
        clienteTs ? clienteTs.toISOString() : null,
      ]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[OtrosFormatos] Error guardando borrador:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar el borrador' });
  }
});

router.get('/borradores/:id', authenticateToken, async (req, res) => {
  try {
    const b = await db.queryOne(
      `SELECT id, tecnico_id, tecnico_usuario, beneficiario_cedula, tipo, instancia, datos,
              cliente_updated_at, updated_at
         FROM otros_formatos_borradores WHERE id = $1`,
      [req.params.id]
    );
    if (!b) return res.status(404).json({ estado: 'error', mensaje: 'Borrador no encontrado' });
    if (!esSuperior(req.user) && b.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', borrador: b });
  } catch (error) {
    console.error('[OtrosFormatos] Error leyendo borrador:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el borrador' });
  }
});

// ------------------------------------------------------------
// Acta de Entrega vista y firmada por la interventoría desde las entregas
// ------------------------------------------------------------
// El acta puede estar publicada (otros_formatos), en borrador respaldado
// (otros_formatos_borradores) o en ambas. Estas rutas la combinan: los datos
// de la publicada (o del borrador si no hay publicada) y, si a una le falta
// una firma que la otra tiene, se completa. La firma de interventoría se
// escribe en TODAS las copias que existan y NUNCA cambia el técnico dueño.

const parsear = (d) => (typeof d === 'string' ? JSON.parse(d) : d || {});
const CAMPOS_FIRMA_ACTA = ['firmaBeneficiario', 'firmaTecnico', 'firmaInterventoria'];

const combinarActa = (pub, bor) => {
  const dp = pub ? parsear(pub.datos) : null;
  const db_ = bor ? parsear(bor.datos) : null;
  const base = { ...(dp || db_ || {}) };
  const otra = dp ? db_ : null;
  if (otra) {
    for (const c of CAMPOS_FIRMA_ACTA) {
      if (!esFirma(base[c]) && esFirma(otra[c])) base[c] = otra[c];
    }
    if (esFirma(base.firmaInterventoria) && !esFirma(dp.firmaInterventoria)) {
      base.interventoriaNombre = otra.interventoriaNombre || base.interventoriaNombre || '';
      base.interventoriaCargo = otra.interventoriaCargo || base.interventoriaCargo || '';
    }
  }
  return base;
};

const leerActaCombinada = async (id) => {
  const pub = await db.queryOne(
    `SELECT id, tecnico_id, tecnico_nombre, tecnico_usuario, beneficiario_cedula, beneficiario_nombre, datos, updated_at
       FROM otros_formatos WHERE id = $1 AND tipo = $2`,
    [id, TIPO_MULTIPLE]
  );
  const bor = await db.queryOne(
    `SELECT id, tecnico_id, tecnico_usuario, beneficiario_cedula, datos, updated_at
       FROM otros_formatos_borradores WHERE id = $1 AND tipo = $2`,
    [id, TIPO_MULTIPLE]
  );
  return { pub, bor };
};

// POST /api/otros-formatos/actas/estado — { ids: [...] } → estado y firmas de cada acta.
// Roles superiores: cualquier acta (lista de entregas de los revisores).
// Técnico: solo las suyas (su lista de entregas, también en otro dispositivo).
router.post('/actas/estado', authenticateToken, async (req, res) => {
  try {
    const superior = esSuperior(req.user);
    if (!superior && !req.user?.id) return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x) => String(x)).slice(0, 2000);
    if (!ids.length) return res.json({ estado: 'ok', actas: {} });
    const resumen = (tabla) =>
      db.queryAll(
        `SELECT id,
                (datos->>'firmaBeneficiario') LIKE 'data:image%' AS fb,
                (datos->>'firmaTecnico') LIKE 'data:image%' AS ft,
                (datos->>'firmaInterventoria') LIKE 'data:image%' AS fi,
                datos->'faltantes' AS faltantes
           FROM ${tabla} WHERE tipo = $1 AND id = ANY($2::text[])
           ${superior ? '' : 'AND tecnico_id = $3'}`,
        superior ? [TIPO_MULTIPLE, ids] : [TIPO_MULTIPLE, ids, req.user.id]
      );
    const [pubs, bors] = await Promise.all([resumen('otros_formatos'), resumen('otros_formatos_borradores')]);
    const actas = {};
    for (const b of bors) actas[b.id] = { estado: 'borrador', firmaBeneficiario: !!b.fb, firmaTecnico: !!b.ft, firmaInterventoria: !!b.fi };
    for (const p of pubs) {
      const b = actas[p.id];
      const faltantes = parsear(p.faltantes);
      actas[p.id] = {
        estado: 'publicada',
        firmaBeneficiario: !!p.fb || !!b?.firmaBeneficiario,
        firmaTecnico: !!p.ft || !!b?.firmaTecnico,
        firmaInterventoria: !!p.fi || !!b?.firmaInterventoria,
        /** Lo que el técnico dejó pendiente al completar. */
        faltantes: Array.isArray(faltantes) ? faltantes : [],
      };
    }
    res.json({ estado: 'ok', actas });
  } catch (error) {
    console.error('[OtrosFormatos] Error en estado de actas:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al consultar las actas' });
  }
});

// POST /api/otros-formatos/actas/por-actividad — { actividad } → actas de esa
// actividad agrupadas por cédula del beneficiario (publicadas y borradores).
// Para las tarjetas de beneficiarios (ej. Preparación del Terreno): cómo va
// cada acta sin entrar. Técnico: solo las suyas. Roles superiores: todas.
// Borradores de versiones viejas de la app no traen la actividad: los de
// Preparación del Terreno se reconocen por su primera fila.
router.post('/actas/por-actividad', authenticateToken, async (req, res) => {
  try {
    const actividad = String(req.body?.actividad || '').trim().slice(0, 100);
    if (!actividad) return res.status(400).json({ estado: 'error', mensaje: 'Falta la actividad' });
    const superior = esSuperior(req.user);
    const params = [TIPO_MULTIPLE, actividad];
    if (!superior) params.push(req.user.id);
    const filtroDueno = superior ? '' : 'AND tecnico_id = $3';
    const columnas = `id, beneficiario_cedula, instancia, updated_at,
                (datos->>'firmaInterventoria') LIKE 'data:image%' AS fi,
                datos->'faltantes' AS faltantes`;
    const pubs = await db.queryAll(
      `SELECT ${columnas} FROM otros_formatos
        WHERE tipo = $1 AND completo = TRUE AND datos->>'actividadId' = $2 ${filtroDueno}`,
      params
    );
    const bors = await db.queryAll(
      `SELECT ${columnas} FROM otros_formatos_borradores
        WHERE tipo = $1 ${filtroDueno}
          AND (datos->>'actividadId' = $2
               OR ($2 = 'preparacion_terreno' AND datos->>'actividadId' IS NULL
                   AND datos->'actividades'->0->>'descripcion' = 'Preparación del terreno'))`,
      params
    );
    const porCedula = {};
    const agregar = (fila, estado, firmaExtra) => {
      const faltantes = parsear(fila.faltantes);
      (porCedula[fila.beneficiario_cedula] ||= []).push({
        id: fila.id,
        instancia: fila.instancia,
        estado,
        firmaInterventoria: !!fila.fi || !!firmaExtra,
        faltantes: estado === 'publicada' && Array.isArray(faltantes) ? faltantes : [],
        updated_at: fila.updated_at,
      });
    };
    const borPorId = new Map(bors.map((b) => [b.id, b]));
    for (const p of pubs) agregar(p, 'publicada', borPorId.get(p.id)?.fi);
    const publicadas = new Set(pubs.map((p) => p.id));
    for (const b of bors) if (!publicadas.has(b.id)) agregar(b, 'borrador');
    res.json({ estado: 'ok', actas: porCedula });
  } catch (error) {
    console.error('[OtrosFormatos] Error en actas por actividad:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al consultar las actas' });
  }
});

// GET /api/otros-formatos/actas/:id — acta combinada (publicada + borrador).
// Técnico dueño o roles superiores.
router.get('/actas/:id', authenticateToken, async (req, res) => {
  try {
    const { pub, bor } = await leerActaCombinada(req.params.id);
    if (!pub && !bor) return res.status(404).json({ estado: 'error', mensaje: 'Acta no encontrada' });
    const dueno = pub?.tecnico_id || bor?.tecnico_id;
    if (!esSuperior(req.user) && dueno !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({
      estado: 'ok',
      acta: {
        id: req.params.id,
        estado: pub ? 'publicada' : 'borrador',
        tecnico_id: dueno,
        tecnico_nombre: pub?.tecnico_nombre || null,
        tecnico_usuario: pub?.tecnico_usuario || bor?.tecnico_usuario || null,
        beneficiario_cedula: pub?.beneficiario_cedula || bor?.beneficiario_cedula,
        datos: combinarActa(pub, bor),
        updated_at: pub?.updated_at || bor?.updated_at,
      },
    });
  } catch (error) {
    console.error('[OtrosFormatos] Error leyendo acta combinada:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el acta' });
  }
});

// POST /api/otros-formatos/actas/:id/firma-interventoria — { firma, nombre, cargo }
// SOLO el rol interventor. Firma la publicada y/o el borrador.
router.post('/actas/:id/firma-interventoria', authenticateToken, async (req, res) => {
  try {
    if (req.user?.rol !== 'interventor') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo la interventoría puede firmar esta acta' });
    }
    const { firma, nombre, cargo } = req.body || {};
    if (!esFirma(firma)) return res.status(400).json({ estado: 'error', mensaje: 'Se requiere la firma como imagen' });
    const nombreFirma = String(nombre || req.user.nombre || '').trim().slice(0, 200);
    if (!nombreFirma) return res.status(400).json({ estado: 'error', mensaje: 'Falta el nombre de quien firma' });

    const id = req.params.id;
    const { pub, bor } = await leerActaCombinada(id);
    if (!pub && !bor) return res.status(404).json({ estado: 'error', mensaje: 'Acta no encontrada' });

    const parche = {
      firmaInterventoria: firma,
      interventoriaNombre: nombreFirma,
      interventoriaCargo: String(cargo || '').trim().slice(0, 200),
    };
    const json = JSON.stringify(parche);
    if (pub) {
      // El PDF guardado queda sin la firma: se descarta para regenerarlo.
      await db.query(`UPDATE otros_formatos SET datos = datos || $2::jsonb, pdf_path = NULL, updated_at = NOW() WHERE id = $1`, [id, json]);
    }
    if (bor) {
      // cliente_updated_at no se toca: el técnico sigue pudiendo guardar su borrador
      // (y la firma no se pierde porque nunca se reemplaza por vacío).
      await db.query(`UPDATE otros_formatos_borradores SET datos = datos || $2::jsonb, updated_at = NOW() WHERE id = $1`, [id, json]);
    }
    console.log(`[OtrosFormatos] Firma de interventoría en ${id} (${pub ? 'publicada' : ''}${pub && bor ? '+' : ''}${bor ? 'borrador' : ''}) por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Firma registrada', datos: parche });
  } catch (error) {
    console.error('[OtrosFormatos] Error al firmar acta:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la firma' });
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
// GET /api/otros-formatos/:id — Un formato con sus datos completos.
// El técnico autor o un rol superior. (Para reabrir un acta a corregir o
// armar su PDF cuando todavía no hay uno guardado.)
// ------------------------------------------------------------
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const f = await db.queryOne(
      `SELECT id, tecnico_id, tecnico_nombre, tecnico_usuario, beneficiario_cedula, beneficiario_nombre,
              tipo, datos, completo, instancia, (pdf_path IS NOT NULL) AS tiene_pdf, created_at, updated_at
         FROM otros_formatos WHERE id = $1`,
      [req.params.id]
    );
    if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    if (!esSuperior(req.user) && f.tecnico_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', formato: f });
  } catch (error) {
    console.error('[OtrosFormatos] Error al obtener:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el formato' });
  }
});

// ------------------------------------------------------------
// POST /api/otros-formatos/:id/observaciones — Un rol superior avisa de un dato
// errado o faltante. Body: { comentario }. Notifica al técnico autor.
// ------------------------------------------------------------
router.post('/:id/observaciones', authenticateToken, async (req, res) => {
  try {
    if (!esSuperior(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo los roles de revisión pueden dejar observaciones' });
    }
    const comentario = String(req.body?.comentario || '').trim().slice(0, 2000);
    if (!comentario) {
      return res.status(400).json({ estado: 'error', mensaje: 'Escribe el dato errado o faltante' });
    }
    const f = await db.queryOne(
      'SELECT id, tecnico_id, beneficiario_nombre, tipo FROM otros_formatos WHERE id = $1',
      [req.params.id]
    );
    if (!f) return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });

    const fila = await db.queryOne(
      `INSERT INTO otros_formatos_observaciones (formato_id, autor_id, autor_nombre, autor_rol, comentario)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [f.id, req.user.id, req.user.nombre || req.user.usuario, req.user.rol, comentario]
    );
    await crearNotificacion(
      f.tecnico_id,
      'observacion_formato',
      `Observación en el acta de ${f.beneficiario_nombre || 'un beneficiario'}`,
      `${req.user.nombre || req.user.usuario}: ${comentario}`,
      null
    );
    console.log(`[OtrosFormatos] Observación ${fila.id} en ${f.id} por ${req.user.usuario}`);
    res.json({ estado: 'ok', id: fila.id });
  } catch (error) {
    console.error('[OtrosFormatos] Error al registrar observación:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la observación' });
  }
});

// ------------------------------------------------------------
// POST /api/otros-formatos/observaciones/:obsId/resolver — la marca como
// atendida quien la hizo, o un admin.
// ------------------------------------------------------------
router.post('/observaciones/:obsId/resolver', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.obsId, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ estado: 'error', mensaje: 'Observación inválida' });
    const o = await db.queryOne('SELECT id, autor_id, resuelta FROM otros_formatos_observaciones WHERE id = $1', [id]);
    if (!o) return res.status(404).json({ estado: 'error', mensaje: 'Observación no encontrada' });
    if (o.autor_id !== req.user.id && req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo quien la dejó puede marcarla como resuelta' });
    }
    await db.query(
      'UPDATE otros_formatos_observaciones SET resuelta = TRUE, resuelta_por = $2, resuelta_en = NOW() WHERE id = $1',
      [id, req.user.id]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[OtrosFormatos] Error al resolver observación:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al resolver la observación' });
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
// PATCH /api/otros-formatos/:id/fecha — Solo admin
// Cambia la fecha del formato (created_at, conservando la hora en hora de
// Colombia). El upsert de /sync no toca created_at, así que el cambio resiste
// las resincronizaciones.
// ------------------------------------------------------------
router.patch('/:id/fecha', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ estado: 'error', mensaje: 'Solo el administrador puede cambiar la fecha' });
  }
  const { fecha } = req.body || {};
  const m = typeof fecha === 'string' ? fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const valida = m && new Date(`${fecha}T12:00:00Z`).toISOString().slice(0, 10) === fecha;
  if (!valida) {
    return res.status(400).json({ estado: 'error', mensaje: 'Fecha inválida (use AAAA-MM-DD)' });
  }
  try {
    const row = await db.queryOne(
      `UPDATE otros_formatos
          SET created_at = ($1::date + (created_at AT TIME ZONE 'America/Bogota')::time)
                           AT TIME ZONE 'America/Bogota'
        WHERE id = $2
        RETURNING id, created_at`,
      [fecha, req.params.id]
    );
    if (!row) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formato no encontrado' });
    }
    res.json({ estado: 'ok', created_at: row.created_at });
  } catch (error) {
    console.error('[OtrosFormatos] Error al cambiar fecha:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cambiar la fecha' });
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
