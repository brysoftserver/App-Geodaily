// ============================================================
// Catálogo de actividades con panel de evidencia (acta + fotos)
// ============================================================
// Única fuente en el backend de qué actividades / subactividades tienen el
// panel "Acta de Entrega + fotos del antes / durante / después" por
// beneficiario (ids de src/data/actividades.ts del cliente).
//
// Clave de la evidencia:
//   · actividad principal → su id                (ej. 'preparacion_terreno')
//   · subactividad        → '{actividad}.{sub}'  (ej. 'siembra_platano.fertilizacion')
// La clave compuesta evita que la subactividad 'fertilizacion' de Plátano se
// mezcle con la actividad principal 'fertilizacion'. Se guarda tal cual en
// actividad_evidencias.actividad y en otros_formatos.datos->>'actividadId'.
// ============================================================

const SEPARADOR = '.';

/** Actividades principales con panel de evidencia. */
const PRINCIPALES = [
  'preparacion_terreno',
  'siembra_cacao',
  'siembra_platano',
  'siembra_forestales',
  'fertilizacion',
  'control_sanitario',
];

/** Subactividades con panel de evidencia (las entregas tienen su propia pantalla). */
const SUBACTIVIDADES = {
  siembra_platano: ['trazado_ahoyado_encalado', 'siembra_colinos', 'fertilizacion'],
  siembra_forestales: ['trazado_ahoyado_encalado', 'siembra_plantulas', 'fertilizacion'],
  siembra_cacao: ['trazado_ahoyado_encalado', 'siembra_plantulas_cacao', 'fertilizacion'],
};

const claveSub = (actividad, sub) => `${actividad}${SEPARADOR}${sub}`;

const CLAVES_SUBACTIVIDADES = Object.entries(SUBACTIVIDADES).flatMap(([a, subs]) => subs.map((s) => claveSub(a, s)));

/** Todas las claves válidas (principales + subactividades). */
const ACTIVIDADES = new Set([...PRINCIPALES, ...CLAVES_SUBACTIVIDADES]);

/** { actividad, sub } de una clave ('siembra_platano.fertilizacion' → sub 'fertilizacion'). */
function descomponer(clave) {
  const s = String(clave ?? '');
  const i = s.indexOf(SEPARADOR);
  return i < 0 ? { actividad: s, sub: null } : { actividad: s.slice(0, i), sub: s.slice(i + 1) };
}

/**
 * A qué (actividad, referencia) corresponde el OK de la interventoría del
 * beneficiario `item` en esta clave. Principal → (actividad, item);
 * subactividad → (actividad padre, '{sub}:{item}'), mismo formato que
 * usan las demás subactividades en revision_interventoria.
 */
function revisionDe(clave, item) {
  const { actividad, sub } = descomponer(clave);
  return sub ? { actividad, referencia: `${sub}:${item}` } : { actividad, referencia: String(item) };
}

/** Carpeta en MinIO: la subactividad queda dentro de la de su actividad. */
const carpeta = (clave) => String(clave).split(SEPARADOR).join('/');

module.exports = { ACTIVIDADES, PRINCIPALES, SUBACTIVIDADES, CLAVES_SUBACTIVIDADES, descomponer, revisionDe, carpeta, claveSub };
