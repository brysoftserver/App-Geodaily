// ============================================================
// GEODAILY — Catálogo de formatos de Verificación de Entregas
// ============================================================
// Cada material define su encabezado, módulos de criterios (SÍ / NO / N/A +
// observación + fotos) y las opciones de daños del dictamen. La pantalla del
// formulario se arma a partir de esta definición: agregar el formato de otro
// material es agregar aquí su definición y marcarlo `disponible`.
// ============================================================

export type MaterialVerificacionId = 'colinos_platano' | 'plantulas_cacao' | 'plantulas_maderables';

export interface CriterioVerificacion {
  id: string;
  /** Rótulo en negrita antes de la pregunta (ej. "Limpieza (Plátano)"). */
  rotulo?: string;
  pregunta: string;
  /** Qué se espera en observaciones / fotos. */
  ayuda: string;
}

export interface ModuloVerificacion {
  id: string;
  titulo: string;
  subtitulo: string;
  criterios: CriterioVerificacion[];
}

export interface MaterialVerificacion {
  id: MaterialVerificacionId;
  /** Título oficial del formato. */
  titulo: string;
  /** Nombre corto para tarjetas y listas. */
  nombreCorto: string;
  icono: string;
  /** "Tipo de Material Vegetal" predeterminado del encabezado. */
  tipoMaterial: string;
  /** true = el tipo de material es texto libre (arranca vacío); false = fijo con `tipoMaterial`. */
  tipoMaterialEditable?: boolean;
  /** false = el formato aún no está definido (la opción se muestra, pero no abre). */
  disponible: boolean;
  modulos: ModuloVerificacion[];
  danos: string[];
}

export const MAX_FOTOS_CRITERIO = 3;
export const MAX_FOTOS_EVIDENCIAS = 10;

const COLINOS_PLATANO: MaterialVerificacion = {
  id: 'colinos_platano',
  titulo: 'RECEPCIÓN Y VERIFICACIÓN DE MATERIAL VEGETAL – COLINOS DE PLATANO',
  nombreCorto: 'Colinos de Plátano',
  icono: '🍌',
  tipoMaterial: 'Colinos de Plátano',
  disponible: true,
  modulos: [
    {
      id: 'm1',
      titulo: 'MÓDULO 1: Legalidad y Documentación del Transporte',
      subtitulo: 'Verificación de soporte documental al momento del arribo',
      criterios: [
        { id: '1.1', pregunta: '¿Presenta Guía de Movilización / Salvoconducto fitosanitario vigente para el trayecto?', ayuda: 'Adjuntar foto de la guía o texto libre' },
        { id: '1.2', pregunta: '¿El material proviene de un vivero con Registro ICA vigente?', ayuda: 'Adjuntar foto del certificado o texto libre' },
        { id: '1.3', pregunta: '¿El certificado de origen acredita la variedad/clon o especie contratada?', ayuda: 'Foto Colino o texto libre' },
        { id: '1.4', pregunta: '¿La cantidad física transportada coincide con la orden de despacho/remisión?', ayuda: 'Texto libre o foto' },
      ],
    },
    {
      id: 'm2',
      titulo: 'MÓDULO 2: Condiciones del Vehículo y Bioseguridad en Arribo',
      subtitulo: 'Evaluación del transporte y medidas preventivas de inocuidad',
      criterios: [
        { id: '2.1', pregunta: '¿El vehículo y los empaques llegan limpios, sin barro ni residuos de otras fincas?', ayuda: 'Foto de furgón/carrocería o texto libre' },
        { id: '2.2', pregunta: '¿El material viaja protegido contra radiación solar directa, viento o lluvia?', ayuda: 'Foto de carpa/cobertura o texto libre' },
        { id: '2.3', pregunta: '¿El tiempo estimado de transporte (arranque a entrega) es menor a 3–5 días sin deshidratación?', ayuda: 'Texto libre o foto' },
      ],
    },
    {
      id: 'm3',
      titulo: 'MÓDULO 3: Calidad Física y Acondicionamiento del Lote',
      subtitulo: 'Inspección física general según el tipo de material',
      criterios: [
        { id: '3.1', rotulo: 'Limpieza (Plátano)', pregunta: '¿Los colinos llegan con cormos limpios sin tierra adherida?', ayuda: 'Foto de cormos o texto libre' },
        { id: '3.2', rotulo: 'Daño Mecánico', pregunta: '¿El lote presenta menos del 5% de daños (sin golpes o cormos partidos)?', ayuda: 'Foto de daños si existen o texto libre' },
        { id: '3.3', rotulo: 'Vigor y Desarrollo', pregunta: '¿Los colinos cumplen con el peso (800 gr promedio) y diámetro técnico requerido?', ayuda: 'Texto libre o foto' },
        // La 3.4 del formato original repetía la 2.3 (tiempo de transporte): se quitó.
      ],
    },
    {
      id: 'm4',
      titulo: 'MÓDULO 4: Sanidad Fitosanitaria (Muestreo Aleatorio)',
      subtitulo: 'Verificación patológica sobre la muestra seleccionada',
      criterios: [
        { id: '4.1', rotulo: 'Olor', pregunta: '¿El lote está libre de olores a pudrición o fermentación?', ayuda: 'Texto libre o foto' },
        { id: '4.2', rotulo: 'Plagas de Tallo/Cormo', pregunta: '¿Ausencia total de orificios, galerías o larvas de picudo o barrenadores?', ayuda: 'Foto o texto libre' },
        { id: '4.3', rotulo: 'Manchas Fitosanitarias', pregunta: '¿Corteza libres de manchas rojas/negras o necrosis (Nematodos, Sigatoka, Mosaico)?', ayuda: 'Texto libre o foto' },
        { id: '4.4', rotulo: 'Ausencia de Bacteriosis', pregunta: '¿Ausencia de zonas acuosas blandas o exudados lechosos/amarillentos al presionar (Moko/Fusarium)?', ayuda: 'Texto libre o foto' },
        { id: '4.5', rotulo: 'Sistema Radicular', pregunta: '¿Raíces claras/sanas, sin entorchamiento ("cola de marrano") ni pudrición?', ayuda: 'Texto libre o foto' },
      ],
    },
  ],
  danos: ['Daño Mecánico', 'Presencia de Plaga', 'Pudrición/Bacteriosis'],
};

const PLANTULAS_CACAO: MaterialVerificacion = {
  id: 'plantulas_cacao',
  titulo: 'RECEPCIÓN Y VERIFICACIÓN DE MATERIAL VEGETAL – PLANTULAS DE CACAO',
  nombreCorto: 'Plántulas de Cacao',
  icono: '🌱',
  tipoMaterial: 'Plántulas de Cacao',
  // En el formato de cacao el tipo de material es texto libre.
  tipoMaterialEditable: true,
  disponible: true,
  modulos: [
    {
      id: 'm1',
      titulo: 'MÓDULO 1: Legalidad y Documentación del Transporte',
      subtitulo: 'Verificación de soporte documental al momento del arribo',
      criterios: [
        { id: '1.1', pregunta: '¿Presenta Guía de Movilización / Salvoconducto fitosanitario vigente para el trayecto?', ayuda: 'Adjuntar foto de la guía o texto libre' },
        { id: '1.2', pregunta: '¿El material proviene de un vivero con Registro ICA vigente?', ayuda: 'Adjuntar foto del certificado o texto libre' },
        { id: '1.3', pregunta: '¿El certificado de origen acredita el material vegetal contratado?', ayuda: 'Foto Material Vegetal o texto libre' },
        { id: '1.4', pregunta: '¿La cantidad física transportada coincide con la orden de despacho/remisión?', ayuda: 'Texto libre o fotos' },
      ],
    },
    {
      id: 'm2',
      titulo: 'MÓDULO 2: Condiciones del Vehículo y Manejo en Transporte',
      subtitulo: 'Evaluación del acondicionamiento logístico para evitar deshidratación y daño mecánico',
      criterios: [
        { id: '2.1', pregunta: '¿El material fue cargado en estantes o hileras sin apilamiento excesivo que aplaste los ápices?', ayuda: 'Foto del interior del furgón o texto libre' },
        { id: '2.2', pregunta: '¿El material viaja protegido contra radiación solar directa, viento o lluvia?', ayuda: 'Foto de carpa/cobertura o texto libre' },
        { id: '2.3', pregunta: '¿El furgón/planchón se encuentra limpio, desinfectado y libre de residuos ajenos al material?', ayuda: 'Texto libre o foto' },
        { id: '2.4', pregunta: '¿El material arriba con temperatura adecuada (sin evidencia de sofocamiento o calentamiento del follaje)?', ayuda: 'Texto libre o foto' },
      ],
    },
    {
      id: 'm3',
      titulo: 'MÓDULO 3: Especificaciones Morfométricas y Vigor de las Plántulas',
      subtitulo: 'Inspección técnica de arquitectura y calidad física del lote maderable',
      criterios: [
        { id: '3.1', rotulo: 'Altura Útil', pregunta: '¿Las plántulas cumplen con la altura mínima requerida?', ayuda: 'Foto o texto libre' },
        { id: '3.2', rotulo: 'Grosor del Tallo (Cuello)', pregunta: '¿El diámetro a la altura del cuello cumple con lo establecido?', ayuda: 'Foto o texto libre' },
        { id: '3.3', rotulo: 'Lignificación', pregunta: '¿El tallo es erguido, recto y presenta consistencia semileñosa (bien lignificada)?', ayuda: 'Foto o texto libre' },
        { id: '3.4', rotulo: 'Firmeza del Sustrato', pregunta: '¿El pilón de tierra es firme, retiene humedad adecuada y no se desmorona al tacto?', ayuda: 'Foto o texto libre' },
        { id: '3.5', rotulo: 'Integridad de Bolsa', pregunta: '¿La bolsa plástica está entera, bien llena, con perforaciones de drenaje y sin romper?', ayuda: 'Foto o texto libre' },
      ],
    },
    {
      id: 'm4',
      titulo: 'MÓDULO 4: Inspección Fitosanitaria y Calidad Radicular (Muestreo)',
      subtitulo: 'Evaluación patológica y de estructura subterránea en plántulas seleccionadas al azar',
      criterios: [
        { id: '4.1', rotulo: 'Ausencia de Brotes Anormales', pregunta: '¿Ápice y brotes 100% libres de malformaciones, agallas o hipertrofias?', ayuda: 'Foto o texto libre' },
        { id: '4.2', rotulo: 'Ausencia de Hongos de Cuello/Tallo', pregunta: '¿Tallo y punto de injerto libres de exudados, chancros o pudrición?', ayuda: 'Fotos o texto libre' },
        { id: '4.3', rotulo: 'Sanidad Foliar', pregunta: '¿Follaje libre de perforaciones, manchas necrosadas?', ayuda: 'Foto o texto libre' },
        { id: '4.4', rotulo: 'Ausencia de Insectos Plaga', pregunta: '¿Lote libre de pulgones, cochinillas harinosas, ácaros o trips en el envés de las hojas y yemas?', ayuda: 'Foto o texto libre' },
        { id: '4.5', rotulo: 'Sistema Radicular', pregunta: '¿Raíces claras/sanas, sin entorchamiento ("cola de marrano") ni pudrición?', ayuda: 'Foto o texto libre' },
        { id: '4.6', rotulo: 'Sanidad Radicular', pregunta: '¿Las raíces secundarias presentan color claro/sano, bien ramificadas y sin síntomas de pudrición?', ayuda: 'Foto o texto libre' },
      ],
    },
  ],
  danos: ['Daño Mecánico', 'Presencia de Plaga', 'Pudrición/Bacteriosis'],
};

const PLANTULAS_MADERABLES: MaterialVerificacion = {
  id: 'plantulas_maderables',
  titulo: 'RECEPCIÓN Y VERIFICACIÓN DE MATERIAL VEGETAL – PLANTULAS DE MADERABLES',
  nombreCorto: 'Plántulas de Maderables',
  icono: '🌳',
  tipoMaterial: 'Plántulas de Maderables',
  // Igual que en cacao, el tipo de material es texto libre.
  tipoMaterialEditable: true,
  disponible: true,
  modulos: [
    {
      id: 'm1',
      titulo: 'MÓDULO 1: Legalidad y Documentación del Transporte',
      subtitulo: 'Verificación de soporte documental al momento del arribo',
      criterios: [
        { id: '1.1', pregunta: '¿Presenta Guía de Movilización / Salvoconducto fitosanitario vigente para el trayecto?', ayuda: 'Adjuntar foto de la guía o texto libre' },
        { id: '1.2', pregunta: '¿El material proviene de un vivero con Registro ICA vigente?', ayuda: 'Adjuntar foto del certificado o texto libre' },
        { id: '1.3', pregunta: '¿El certificado de origen acredita el material vegetal contratado?', ayuda: 'Foto Material Vegetal o texto libre' },
        { id: '1.4', pregunta: '¿La cantidad física transportada coincide con la orden de despacho/remisión?', ayuda: 'Texto libre o foto' },
      ],
    },
    // Módulos 2 y 3: idénticos a los del formato de cacao.
    PLANTULAS_CACAO.modulos[1],
    PLANTULAS_CACAO.modulos[2],
    {
      id: 'm4',
      titulo: 'MÓDULO 4: Inspección Fitosanitaria y Calidad Radicular (Muestreo)',
      subtitulo: 'Evaluación patológica y de estructura subterránea en plántulas seleccionadas al azar',
      criterios: [
        { id: '4.1', rotulo: 'Ausencia de Barrenadores', pregunta: '¿Tallo y brotes libres de perforaciones producidas por barrenadores?', ayuda: 'Foto o texto libre' },
        { id: '4.2', rotulo: 'Ausencia de Defoliadores/Plagas', pregunta: '¿Follaje 100% libre de insectos plaga?', ayuda: 'Fotos o texto libre' },
        { id: '4.3', rotulo: 'Ausencia de Enfermedades Foliares', pregunta: '¿Hojas libres de clorosis severa, manchas necrosadas (Phytophthora, Cercospora) o marchitez?', ayuda: 'Foto o texto libre' },
        { id: '4.4', rotulo: 'Arquitectura Radicular', pregunta: '¿La raíz pivotante está recta, vertical y libre de deformación en espiral ("cola de marrano")?', ayuda: 'Foto o texto libre' },
        { id: '4.5', rotulo: 'Sistema Radicular', pregunta: '¿Raíces claras/sanas, sin entorchamiento ("cola de marrano") ni pudrición?', ayuda: 'Foto o texto libre' },
        { id: '4.6', rotulo: 'Sanidad Radicular', pregunta: '¿Las raíces secundarias presentan color claro/sano, bien ramificadas y sin síntomas de pudrición?', ayuda: 'Foto o texto libre' },
      ],
    },
  ],
  danos: ['Daño Mecánico', 'Presencia de Plaga', 'Pudrición/Bacteriosis'],
};

// Un formato futuro se agrega aquí con `disponible: false` hasta tener su definición.
export const MATERIALES_VERIFICACION: MaterialVerificacion[] = [
  COLINOS_PLATANO,
  PLANTULAS_CACAO,
  PLANTULAS_MADERABLES,
];

export const buscarMaterialVerificacion = (id?: string) => MATERIALES_VERIFICACION.find((m) => m.id === id);

// ─── Datos de una verificación ──────────────────────────────

export type RespuestaSiNo = 'si' | 'no' | 'na';

export interface FotoVerificacion {
  /** Id estable del cliente (idempotencia de la subida). */
  id: string;
  /** Archivo local (file://) o data URI en web; se conserva hasta subirse. */
  uri?: string;
  /** Id del archivo en el servidor una vez subida. */
  archivo_id?: number;
  /** El archivo local ya no existe en el teléfono. */
  perdido?: boolean;
}

export interface FirmaVerificacion {
  nombre: string;
  /** data URI mientras no se sube; luego se conserva y se agrega archivo_id. */
  firma?: string | null;
  archivo_id?: number;
}

export interface DatosVerificacion {
  encabezado: {
    /** Fecha de la verificación, escrita a mano en formato DD/MM/AAAA. */
    fecha: string;
    puntoRecepcion: string;
    latitud: string;
    longitud: string;
    altitud: string;
    precision: string;
    proveedor: string;
    placa: string;
    tipoMaterial: string;
    remision: string;
    cantidadDeclarada: string;
  };
  respuestas: Record<string, { valor: RespuestaSiNo | null; observacion: string; fotos: FotoVerificacion[] }>;
  dictamen: { inspeccionadas: string; conformes: string; noConformes: string; danos: string[] };
  conceptoFinal: string;
  evidencias: FotoVerificacion[];
  firmas: { tecnico: FirmaVerificacion; interventoria: FirmaVerificacion };
}

export const datosVacios = (m: MaterialVerificacion, interventorNombre = ''): DatosVerificacion => ({
  encabezado: {
    fecha: '',
    puntoRecepcion: '',
    latitud: '',
    longitud: '',
    altitud: '',
    precision: '',
    proveedor: '',
    placa: '',
    tipoMaterial: m.tipoMaterialEditable ? '' : m.tipoMaterial,
    remision: '',
    cantidadDeclarada: '',
  },
  respuestas: Object.fromEntries(
    m.modulos.flatMap((mod) => mod.criterios).map((c) => [c.id, { valor: null, observacion: '', fotos: [] }])
  ),
  dictamen: { inspeccionadas: '', conformes: '', noConformes: '', danos: [] },
  conceptoFinal: '',
  evidencias: [],
  firmas: { tecnico: { nombre: '', firma: null }, interventoria: { nombre: interventorNombre, firma: null } },
});

// ─── Fecha manual (DD/MM/AAAA) ──────────────────────────────

/** Mientras se escribe: solo dígitos y las barras se ponen solas ("09112026" → "09/11/2026"). */
export const formatearFechaEscrita = (texto: string): string => {
  const d = texto.replace(/[^0-9]/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** "09/11/2026" → "2026-11-09" si es una fecha real; si no, null. */
export const fechaVerificacionIso = (fecha?: string | null): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(fecha || '').trim());
  if (!m) return null;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (anio < 2000 || f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};
