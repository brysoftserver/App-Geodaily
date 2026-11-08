// ============================================================
// GEODAILY — Catálogo de "Fortalecimiento de Capacidades en Cacao Sostenible"
// ============================================================
// Debe coincidir con src/data/fortalecimiento.ts del cliente (mismos números
// de ECA, mismo orden de grupos y mismos ids de sección).
//
// Árbol en MinIO (una carpeta por nivel, para no mezclar con otras
// actividades ni con las visitas de los beneficiarios):
//   actividades/Fortalecimiento_Capacidades/ECAS/ECA_{n}/Grupo_{g}_{veredas}/{Seccion}/{archivo}
// ============================================================

const { sanitizeFolderName } = require('../storage');

const RAIZ_MINIO = 'actividades/Fortalecimiento_Capacidades';

const TOTAL_ECAS = 7;

/** Grupos de veredas: el índice (1..7) es lo que viaja en la URL. */
const GRUPOS_VEREDAS = [
  'El Porvenir',
  'El desquite, el retorno, La Nutria, Monterrey, Villa Nueva, 12 de octubre, Aguila 1, Alto riecito, brillante Bajo, caimancito medio, El Jordán, El Cedral, EL Danubio, Líbano Alto, Palestina 2, Risaralda Montebello, La Florida, La esperanza, La Florida Cimitarra, Miravalle, Santa Elena',
  'La Soledad, Las Iglesias, Betania, EL Cuervo, La Camelita, La estrellita, La parada, La Pedregosa, La estrella y La Floresta No. 5',
  'La Victoria',
  'Lobo, Lobo 2, Aurora de Guayas, Palestina, Lindanai, Siberia alta, Siberia baja, Arenosa Oriente, Costa Rica Alta y la Esperanza',
  'Buena vista, Coconuco, Coconuco 2, el Diamante, Etiopia, la Tigra, Los Alpes, Trocha, Villa Marta, El arenoso, El Carmelo, Las Damas, El Plebeyo, Pedregales, La profunda, Topacio Alto',
  'Brisas de la cristalina, El arenoso, El Méndez, El Nutrio, Guadualito, Loma alta, Palestina, San Pablo, Santana Ramos, Yarumal bajo, Yarumal medio',
];

/** Secciones de cada grupo: qué archivos admite y su carpeta en MinIO. */
const SECCIONES = {
  protocolo: { carpeta: 'Protocolo', admite: ['pdf'] },
  informes: { carpeta: 'Informes', admite: ['pdf'] },
  listado_asistencia: { carpeta: 'Listado_de_Asistencia', admite: ['pdf', 'imagen'] },
  registro_fotografico: { carpeta: 'Registro_Fotografico', admite: ['imagen'] },
};

/** Número entero dentro de [1, max] o null. */
function indiceValido(valor, max) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

const ecaValida = (v) => indiceValido(v, TOTAL_ECAS);
const grupoValido = (v) => indiceValido(v, GRUPOS_VEREDAS.length);

/** Carpeta del grupo: "Grupo_2_El_desquite_el_retorno_La_Nutria…" (acotada). */
function carpetaGrupo(grupo) {
  return `Grupo_${grupo}_${sanitizeFolderName(GRUPOS_VEREDAS[grupo - 1])}`.slice(0, 90);
}

/** Prefijo de una sección dentro del árbol (sin "/" final). */
function prefijoSeccion(eca, grupo, seccion) {
  return `${RAIZ_MINIO}/ECAS/ECA_${eca}/${carpetaGrupo(grupo)}/${SECCIONES[seccion].carpeta}`;
}

module.exports = {
  RAIZ_MINIO,
  TOTAL_ECAS,
  GRUPOS_VEREDAS,
  SECCIONES,
  ecaValida,
  grupoValido,
  carpetaGrupo,
  prefijoSeccion,
};
