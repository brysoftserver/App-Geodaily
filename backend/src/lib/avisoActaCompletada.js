// ============================================================
// GEODAILY — Aviso a la interventoría: "se completó un Acta de Entrega"
// ============================================================
// Cuando un Acta de Entrega de una actividad con acta + firmas (Plátano,
// Forestales, Cacao, Preparación del Terreno — y sus subactividades) LLEGA
// COMPLETADA al servidor por primera vez, se avisa en la campanita a TODOS
// los interventores activos para que la revisen y la firmen.
//   · Una sola vez por acta (si el técnico la corrige no se repite).
//   · No se avisa si la interventoría ya la firmó (p. ej. en campo).
//   · Actas sin actividad (las de "Otros formatos") no avisan.
// Nunca lanza: un fallo del aviso no puede tumbar la sincronización.
// ============================================================

const TIPO_ACTA = 'acta_entrega_individual';
const TIPO_NOTIFICACION = 'acta_por_firmar';

/** Actividades con acta firmada por técnico, beneficiario e interventor. */
const ACTIVIDADES_CON_FIRMA = {
  siembra_platano: 'Siembra de Plátano',
  siembra_forestales: 'Siembra de Forestales',
  siembra_cacao: 'Siembra de Cacao',
  preparacion_terreno: 'Preparación del Terreno',
};

/** Nombre del proceso (subactividad) — debe coincidir con src/data/actividades.ts. */
const PROCESOS = {
  entrega_colinos: 'Entrega de Colinos de Plátano',
  entrega_plantulas: 'Entrega de Plántulas Forestales',
  entrega_plantulas_cacao: 'Entrega de Plántulas de Cacao',
  trazado_ahoyado_encalado: 'Trazado, Ahoyado y Encalado',
  siembra_colinos: 'Siembra de los Colinos de Plátano',
  siembra_plantulas: 'Siembra de las Plántulas Forestales',
  siembra_plantulas_cacao: 'Siembra de las Plántulas de Cacao',
  fertilizacion: 'Fertilización',
};

/** Subactividad de entregas de cada actividad (su acta va dentro de una entrega). */
const PROCESO_ENTREGAS = {
  siembra_platano: 'entrega_colinos',
  siembra_forestales: 'entrega_plantulas',
  siembra_cacao: 'entrega_plantulas_cacao',
};

const esFirma = (v) => typeof v === 'string' && v.startsWith('data:image');

/** 'siembra_platano.fertilizacion' → { actividad: 'siembra_platano', sub: 'fertilizacion' } */
const descomponer = (clave) => {
  const s = String(clave || '');
  const i = s.indexOf('.');
  return i < 0 ? { actividad: s, sub: null } : { actividad: s.slice(0, i), sub: s.slice(i + 1) };
};

/**
 * ¿Hay que avisar? Solo la primera vez que el acta queda completada en el
 * servidor, si pertenece a una actividad con firma y aún no tiene la de la
 * interventoría.
 * @param {{ tipo: string, completo: boolean, datos: object, previoCompleto: boolean }} p
 */
const debeAvisarActa = ({ tipo, completo, datos, previoCompleto }) => {
  if (tipo !== TIPO_ACTA || !completo || previoCompleto) return false;
  if (!datos || typeof datos !== 'object') return false;
  const { actividad } = descomponer(datos.actividadId);
  if (!ACTIVIDADES_CON_FIRMA[actividad]) return false;
  return !esFirma(datos.firmaInterventoria);
};

/**
 * Título y mensaje de la notificación.
 * @param {{ datos: object, beneficiarioNombre?: string, tecnicoNombre?: string, entregaNumero?: number|null }} p
 */
const textoAvisoActa = ({ datos, beneficiarioNombre, tecnicoNombre, entregaNumero }) => {
  const { actividad, sub } = descomponer(datos?.actividadId);
  const nombreActividad = ACTIVIDADES_CON_FIRMA[actividad] || actividad;
  let proceso;
  if (sub) proceso = PROCESOS[sub] || sub;
  else if (entregaNumero && PROCESO_ENTREGAS[actividad]) proceso = `${PROCESOS[PROCESO_ENTREGAS[actividad]]} · Entrega ${entregaNumero}`;
  else proceso = nombreActividad;
  const benef = beneficiarioNombre || datos?.nombre || 'un beneficiario';
  const partes = [proceso, `Beneficiario: ${benef}`];
  if (tecnicoNombre) partes.push(`Técnico: ${tecnicoNombre}`);
  return {
    titulo: `📦 Acta completada · ${nombreActividad}`.slice(0, 200),
    mensaje: `${partes.join(' · ')}. Por favor revísela y fírmela para completarla.`,
    proceso,
    nombreActividad,
  };
};

/**
 * Avisa a todos los interventores activos. Nunca lanza.
 * @param {object} p
 * @param {object} p.db              módulo de base de datos (queryOne / queryAll)
 * @param {Function} p.crearNotificacion (usuarioId, tipo, titulo, mensaje, formularioId, datos)
 */
const avisarActaCompletada = async ({ db, crearNotificacion, id, cedula, instancia, datos, beneficiarioNombre, tecnicoNombre }) => {
  try {
    const { actividad, sub } = descomponer(datos?.actividadId);
    // Número de la entrega que lleva esta acta (solo actividades con entregas).
    let entregaNumero = null;
    if (!sub && PROCESO_ENTREGAS[actividad] && instancia) {
      const e = await db.queryOne(
        `SELECT numero FROM actividad_entregas
          WHERE actividad = $1 AND datos->>'actaInstancia' = $2 AND datos->'beneficiario'->>'cedula' = $3
          ORDER BY updated_at DESC LIMIT 1`,
        [actividad, instancia, cedula]
      );
      entregaNumero = e?.numero ?? null;
    }
    const t = textoAvisoActa({ datos, beneficiarioNombre, tecnicoNombre, entregaNumero });
    const interventores = await db.queryAll(`SELECT id FROM usuarios WHERE rol = 'interventor' AND activo = TRUE`);
    const extra = {
      actaId: id,
      cedula,
      instancia,
      actividadId: datos?.actividadId || null,
      beneficiarioNombre: beneficiarioNombre || datos?.nombre || null,
      titulo: entregaNumero ? `Acta · Entrega ${entregaNumero}` : `Acta · ${t.proceso}`,
    };
    for (const u of interventores) {
      await crearNotificacion(u.id, TIPO_NOTIFICACION, t.titulo, t.mensaje, null, extra);
    }
    console.log(`[AvisoActa] ${id}: aviso a ${interventores.length} interventor(es) · ${t.proceso}`);
    return interventores.length;
  } catch (error) {
    console.error('[AvisoActa] No se pudo avisar a la interventoría:', error.message);
    return 0;
  }
};

module.exports = {
  TIPO_NOTIFICACION,
  ACTIVIDADES_CON_FIRMA,
  debeAvisarActa,
  textoAvisoActa,
  avisarActaCompletada,
};
