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
export const ACTIVIDADES_CONECTADAS = ['analisis_suelos', 'preparacion_terreno', 'asistencia_tecnica', 'siembra_platano'];

export type ModoActividades = 'ejecutar' | 'revisar';

export const verboActividad = (modo: ModoActividades) =>
  modo === 'revisar' ? 'Revisar' : 'Realizar';

export const buscarActividad = (id?: string) => ACTIVIDADES.find((a) => a.id === id);

// ─── Subactividades (técnico) ───────────────────────────────

export interface Subactividad {
  id: string;
  nombre: string;
  icon: string;
  /** Pantalla que abre; sin pantalla = aún pendiente de definir. */
  pantalla?: 'EntregasActividad';
}

/**
 * Actividades que, para el técnico, se dividen en subactividades. Las que no
 * tienen `pantalla` se muestran como "Pendiente".
 */
export const SUBACTIVIDADES: Record<string, Subactividad[]> = {
  siembra_platano: [
    { id: 'entrega_colinos', nombre: 'Entrega de Colinos de Plátano', icon: '🚚', pantalla: 'EntregasActividad' },
    { id: 'trazado_ahoyado_encalado', nombre: 'Trazado, Ahoyado y Encalado', icon: '📐' },
    { id: 'siembra_colinos', nombre: 'Siembra de los Colinos de Plátano', icon: '🌱' },
    { id: 'fertilizacion', nombre: 'Fertilización', icon: '🧴' },
  ],
};

/** Primera fila de la tabla del Acta de Entrega y Recibo según la actividad. */
export const FILA_INICIAL_ACTA: Record<string, { descripcion: string; actividad: string; cantidad: string; unidad: string }> = {
  preparacion_terreno: { descripcion: 'Preparación del terreno', actividad: '2', cantidad: '2,5', unidad: 'Hectárea' },
  siembra_platano: { descripcion: 'Realizar siembra de plátano.', actividad: '4', cantidad: '', unidad: 'Semilla de plátano (Colino)' },
};
