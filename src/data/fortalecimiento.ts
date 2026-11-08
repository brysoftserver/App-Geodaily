// ============================================================
// GEODAILY — Catálogo de "Fortalecimiento de Capacidades en Cacao Sostenible"
// ============================================================
// Debe coincidir con backend/src/lib/fortalecimiento.js (mismos números de
// ECA, mismo orden de grupos y mismos ids de sección).
// ============================================================

export type ComponenteFortalecimiento = 'ecas' | 'cartillas' | 'folletos';

export const COMPONENTES_FORTALECIMIENTO: Array<{ id: ComponenteFortalecimiento; nombre: string; icon: string }> = [
  { id: 'ecas', nombre: 'ECAS', icon: '👩‍🏫' },
  { id: 'cartillas', nombre: 'Cartillas', icon: '📘' },
  { id: 'folletos', nombre: 'Folletos', icon: '📰' },
];

export const TOTAL_ECAS = 7;

/** Grupos de veredas de cada ECA: la posición (1..7) es el número de grupo. */
export const GRUPOS_VEREDAS: string[] = [
  'El Porvenir',
  'El desquite, el retorno, La Nutria, Monterrey, Villa Nueva, 12 de octubre, Aguila 1, Alto riecito, brillante Bajo, caimancito medio, El Jordán, El Cedral, EL Danubio, Líbano Alto, Palestina 2, Risaralda Montebello, La Florida, La esperanza, La Florida Cimitarra, Miravalle, Santa Elena',
  'La Soledad, Las Iglesias, Betania, EL Cuervo, La Camelita, La estrellita, La parada, La Pedregosa, La estrella y La Floresta No. 5',
  'La Victoria',
  'Lobo, Lobo 2, Aurora de Guayas, Palestina, Lindanai, Siberia alta, Siberia baja, Arenosa Oriente, Costa Rica Alta y la Esperanza',
  'Buena vista, Coconuco, Coconuco 2, el Diamante, Etiopia, la Tigra, Los Alpes, Trocha, Villa Marta, El arenoso, El Carmelo, Las Damas, El Plebeyo, Pedregales, La profunda, Topacio Alto',
  'Brisas de la cristalina, El arenoso, El Méndez, El Nutrio, Guadualito, Loma alta, Palestina, San Pablo, Santana Ramos, Yarumal bajo, Yarumal medio',
];

export type SeccionEca = 'protocolo' | 'informes' | 'listado_asistencia' | 'registro_fotografico';

/** `admite`: qué puede subirse en la sección. */
export const SECCIONES_ECA: Array<{ id: SeccionEca; titulo: string; icon: string; admite: 'pdf' | 'pdf_o_foto' | 'foto' }> = [
  { id: 'protocolo', titulo: 'Protocolo', icon: '📄', admite: 'pdf' },
  { id: 'informes', titulo: 'Informes', icon: '📑', admite: 'pdf' },
  { id: 'listado_asistencia', titulo: 'Listado de Asistencia', icon: '📝', admite: 'pdf_o_foto' },
  { id: 'registro_fotografico', titulo: 'Registro Fotográfico', icon: '📷', admite: 'foto' },
];

/** Ubicación dentro del árbol; viaja en los params de ActividadDetalle. */
export interface NivelFortalecimiento {
  componente?: ComponenteFortalecimiento;
  eca?: number;
  grupo?: number;
}
