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

/** Formatos aún no entregados: la opción se muestra pero no abre hasta tener su definición. */
const pendiente = (id: MaterialVerificacionId, nombreCorto: string, icono: string): MaterialVerificacion => ({
  id,
  titulo: `RECEPCIÓN Y VERIFICACIÓN DE MATERIAL VEGETAL – ${nombreCorto.toUpperCase()}`,
  nombreCorto,
  icono,
  tipoMaterial: nombreCorto,
  disponible: false,
  modulos: [],
  danos: [],
});

export const MATERIALES_VERIFICACION: MaterialVerificacion[] = [
  COLINOS_PLATANO,
  pendiente('plantulas_cacao', 'Plantulas de Cacao', '🌱'),
  pendiente('plantulas_maderables', 'Plantulas de Maderables', '🌳'),
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
    tipoMaterial: m.tipoMaterial,
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
