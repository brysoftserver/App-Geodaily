// ============================================================
// GEODAILY — Catálogo de actividades del proyecto
// ============================================================
// Cada actividad tiene una tarjeta para el técnico (ejecutar) y otra para los
// roles superiores (revisar lo que llenan los técnicos).

export interface Actividad {
  id: string;
  /** Texto después del verbo: "Realizar X" (técnico) / "Revisar X" (superiores). */
  nombre: string;
  icon: string;
  /** Valor objetivo del proyecto para esta actividad (sin meta definida = no se muestra). */
  meta?: number;
  unidad?: 'Unidades' | 'Hectáreas';
}

export const ACTIVIDADES: Actividad[] = [
  { id: 'analisis_suelos', nombre: 'Análisis de Suelos Completos por Predio', icon: '🧪', meta: 300, unidad: 'Unidades' },
  { id: 'preparacion_terreno', nombre: 'Preparación del Terreno', icon: '🚜', meta: 750, unidad: 'Hectáreas' },
  { id: 'siembra_cacao', nombre: 'Siembra de Cacao', icon: '🌱', meta: 750, unidad: 'Hectáreas' },
  { id: 'siembra_platano', nombre: 'Siembra de Plátano', icon: '🍌', meta: 750, unidad: 'Hectáreas' },
  { id: 'siembra_forestales', nombre: 'Siembra de Forestales', icon: '🌳', meta: 750, unidad: 'Hectáreas' },
  { id: 'biofactorias', nombre: 'Biofactorías', icon: '♻️', meta: 300, unidad: 'Unidades' },
  { id: 'fortalecimiento_capacidades', nombre: 'Fortalecimiento de Capacidades en Cacao Sostenible', icon: '🎓', meta: 300, unidad: 'Unidades' },
  { id: 'fertilizacion', nombre: 'Fertilización del Cultivo', icon: '🧴', meta: 750, unidad: 'Hectáreas' },
  { id: 'control_sanitario', nombre: 'Control Sanitario', icon: '🛡️', meta: 750, unidad: 'Hectáreas' },
  { id: 'asistencia_tecnica', nombre: 'Asistencia Técnica Durante el Establecimiento del Cultivo', icon: '🧑‍🌾' },
];

/**
 * Actividades que ya tienen pantalla de hectáreas. El backend admite además
 * las siembras, fertilización y control sanitario: se agregan aquí cuando
 * arme cada punto.
 */
export const ACTIVIDADES_EN_HECTAREAS = ['preparacion_terreno'];

/**
 * Actividades ya conectadas a datos reales. Las demás se muestran como
 * "Pendiente" hasta que existan los formularios/visitas que las alimenten.
 */
export const ACTIVIDADES_CONECTADAS = ['analisis_suelos', 'preparacion_terreno', 'asistencia_tecnica', 'siembra_platano', 'siembra_forestales', 'siembra_cacao'];

export type ModoActividades = 'ejecutar' | 'revisar';

export const verboActividad = (modo: ModoActividades) =>
  modo === 'revisar' ? 'Revisar' : 'Realizar';

/**
 * Busca una actividad por id. También resuelve la clave de una subactividad
 * con acta + fotos ('siembra_platano.fertilizacion'): devuelve su nombre
 * completo ("Siembra de Plátano · Fertilización") y su ícono.
 */
export const buscarActividad = (id?: string): Actividad | undefined => {
  const directa = ACTIVIDADES.find((a) => a.id === id);
  if (directa || !id) return directa;
  const { actividad, sub } = descomponerClaveEvidencia(id);
  if (!sub) return undefined;
  const padre = ACTIVIDADES.find((a) => a.id === actividad);
  const s = SUBACTIVIDADES[actividad]?.find((x) => x.id === sub);
  if (!padre || !s) return undefined;
  return { id, nombre: `${padre.nombre} · ${s.nombre}`, icon: s.icon };
};

// ─── Subactividades (técnico) ───────────────────────────────

export interface Subactividad {
  id: string;
  nombre: string;
  icon: string;
  /**
   * Pantalla que abre; sin pantalla = aún pendiente de definir.
   *   · 'EntregasActividad'  → entregas con su acta (ej. colinos).
   *   · 'EvidenciaActividad' → por beneficiario: Acta de Entrega + fotos del
   *     antes / durante / después (misma pantalla que Preparación del Terreno).
   */
  pantalla?: 'EntregasActividad' | 'EvidenciaActividad';
  /** Título del acta dentro de cada entrega (solo subactividades de entregas). */
  tituloActa?: string;
}

/**
 * Actividades que, para el técnico, se dividen en subactividades. Las que no
 * tienen `pantalla` se muestran como "Pendiente".
 */
export const SUBACTIVIDADES: Record<string, Subactividad[]> = {
  siembra_platano: [
    { id: 'entrega_colinos', nombre: 'Entrega de Colinos de Plátano', icon: '🚚', pantalla: 'EntregasActividad', tituloActa: 'Acta de Entrega y Recepción de Colinos de Plátano' },
    { id: 'trazado_ahoyado_encalado', nombre: 'Trazado, Ahoyado y Encalado', icon: '📐', pantalla: 'EvidenciaActividad' },
    { id: 'siembra_colinos', nombre: 'Siembra de los Colinos de Plátano', icon: '🌱', pantalla: 'EvidenciaActividad' },
    { id: 'fertilizacion', nombre: 'Fertilización', icon: '🧴', pantalla: 'EvidenciaActividad' },
  ],
  // Mismo diseño que Siembra de Plátano.
  siembra_forestales: [
    { id: 'entrega_plantulas', nombre: 'Entrega de Plántulas Forestales', icon: '🚚', pantalla: 'EntregasActividad', tituloActa: 'Acta de Entrega y Recepción de Plántulas Forestales' },
    { id: 'trazado_ahoyado_encalado', nombre: 'Trazado, Ahoyado y Encalado', icon: '📐', pantalla: 'EvidenciaActividad' },
    { id: 'siembra_plantulas', nombre: 'Siembra de las Plántulas Forestales', icon: '🌳', pantalla: 'EvidenciaActividad' },
    { id: 'fertilizacion', nombre: 'Fertilización', icon: '🧴', pantalla: 'EvidenciaActividad' },
  ],
  // Mismo diseño que Siembra de Plátano. Los nombres de los procesos también
  // están en backend/src/lib/avisoActaCompletada.js (aviso a la interventoría).
  siembra_cacao: [
    { id: 'entrega_plantulas_cacao', nombre: 'Entrega de Plántulas de Cacao', icon: '🚚', pantalla: 'EntregasActividad', tituloActa: 'Acta de Entrega y Recepción de Plántulas de Cacao' },
    { id: 'trazado_ahoyado_encalado', nombre: 'Trazado, Ahoyado y Encalado', icon: '📐', pantalla: 'EvidenciaActividad' },
    { id: 'siembra_plantulas_cacao', nombre: 'Siembra de las Plántulas de Cacao', icon: '🌱', pantalla: 'EvidenciaActividad' },
    { id: 'fertilizacion', nombre: 'Fertilización', icon: '🧴', pantalla: 'EvidenciaActividad' },
  ],
};

// ─── Clave de la evidencia (acta + fotos) ───────────────────
// Actividad principal → su id; subactividad → '{actividad}.{sub}'. Así la
// subactividad 'fertilizacion' de Plátano no se mezcla con la actividad
// principal 'fertilizacion'. Debe coincidir con backend/src/lib/actividadesEvidencia.js.

const SEPARADOR_SUB = '.';

export const claveEvidencia = (actividadId: string, subactividadId?: string | null) =>
  subactividadId ? `${actividadId}${SEPARADOR_SUB}${subactividadId}` : actividadId;

export const descomponerClaveEvidencia = (clave: string): { actividad: string; sub: string | null } => {
  const i = clave.indexOf(SEPARADOR_SUB);
  return i < 0 ? { actividad: clave, sub: null } : { actividad: clave.slice(0, i), sub: clave.slice(i + 1) };
};

/**
 * OK de la interventoría para el beneficiario `item` en esa clave:
 * principal → (actividad, item); subactividad → (actividad padre, '{sub}:{item}').
 */
export const revisionEvidencia = (clave: string, item: number): { actividad: string; referencia: string } => {
  const { actividad, sub } = descomponerClaveEvidencia(clave);
  return sub ? { actividad, referencia: `${sub}:${item}` } : { actividad, referencia: String(item) };
};

/** Título del acta de las entregas de una actividad (con un respaldo genérico). */
export const tituloActaEntregas = (actividadId?: string): string =>
  SUBACTIVIDADES[actividadId ?? '']?.find((s) => s.pantalla === 'EntregasActividad')?.tituloActa ??
  'Acta de Entrega y Recepción';

/** Primera fila de la tabla del Acta de Entrega y Recibo según la actividad. */
export const FILA_INICIAL_ACTA: Record<string, { descripcion: string; actividad: string; cantidad: string; unidad: string }> = {
  preparacion_terreno: { descripcion: 'Preparación del terreno', actividad: '2', cantidad: '2,5', unidad: 'Hectárea' },
  siembra_platano: { descripcion: 'Realizar siembra de plátano.', actividad: '4', cantidad: '', unidad: 'Semilla de plátano (Colino)' },
  siembra_forestales: { descripcion: 'Realizar siembra de forestales.', actividad: '5', cantidad: '', unidad: 'Plántula forestal' },
  siembra_cacao: { descripcion: 'Realizar siembra de cacao.', actividad: '3', cantidad: '', unidad: 'Plántula de cacao' },
};

/**
 * Primera fila del Acta de Entrega y Recibo para una actividad o subactividad.
 * Subactividad: el nombre de la subactividad con el número de actividad de su padre.
 */
export const filaInicialActa = (actividadId: string) => {
  if (FILA_INICIAL_ACTA[actividadId]) return { ...FILA_INICIAL_ACTA[actividadId] };
  const { actividad, sub } = descomponerClaveEvidencia(actividadId);
  const s = sub ? SUBACTIVIDADES[actividad]?.find((x) => x.id === sub) : undefined;
  if (s) return { descripcion: s.nombre, actividad: FILA_INICIAL_ACTA[actividad]?.actividad ?? '', cantidad: '', unidad: '' };
  return { descripcion: buscarActividad(actividadId)?.nombre ?? '', actividad: '', cantidad: '', unidad: '' };
};
