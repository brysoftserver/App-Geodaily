// ============================================================
// GEODAILY — Tipos Globales
// ============================================================

// --- Roles de usuario ---
export type UserRole = 'tecnico' | 'supervisor' | 'gerente' | 'admin';

// --- Usuario autenticado ---
export interface Usuario {
  id: string;
  nombre: string;
  cedula?: string;
  email: string;
  rol: UserRole;
  telefono?: string;
  avatar?: string;
  token: string;
}

// --- Credenciales de login ---
export interface LoginCredentials {
  usuario: string;
  contrasena: string;
}

// --- Coordenadas geográficas ---
export interface Coordenadas {
  latitud: number;
  longitud: number;
  altitud?: number;
  precision_gps?: number;
  heading?: number;
  timestamp?: string;
}

// --- Información de georreferenciación ---
export interface GeoReferencia {
  coordenadas: Coordenadas;
  huso_utm: number;
  banda_utm: string;
  codigo_mgrs: string;
  zona_horaria: string;
  pais: string;
}

// --- Datos climáticos ---
export interface ClimaActual {
  fuente: string;
  timestamp: string;
  ubicacion: {
    latitud: number;
    longitud: number;
    nombre: string;
  };
  temperatura: {
    actual: number;
    sensacion_termica: number;
    minima: number;
    maxima: number;
  };
  humedad: number;
  presion: number;
  viento: {
    velocidad: number;
    direccion_grados: number;
  };
  nubosidad: number;
  visibilidad: number;
  clima: string;
  icono: string;
  pais?: string;
}

export interface ClimaHistorico {
  variable: string;
  mes: number;
  valor: number;
  unidad: string;
  periodo: string;
}

export interface ResumenClimatico {
  ubicacion: { latitud: number; longitud: number };
  actual: ClimaActual | null;
  historico: ClimaHistorico[] | null;
}

// --- Información de foto/video geotaggeado ---
export interface FotoGeotag {
  id: string;
  uri: string;
  tipo?: 'foto' | 'video';
  coordenadas: Coordenadas;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// --- Interface base para formularios de terreno ---
export interface DatosTecnico {
  usuario_id?: string;
  nombre: string;
  cedula: string;
  telefono: string;
  email: string;
}

export interface DatosBeneficiario {
  nombre: string;
  cedula: string;
  telefono: string;
  departamento: string;
  municipio: string;
  vereda: string;
  finca: string;
}

export interface ActividadRealizada {
  descripcion: string;
  descripcion_detallada?: string;
  observaciones: string;
  recomendaciones: string;
}

export type TipoFormulario = 'caracterizacion' | 'visita_tecnica' | 'plantacion';

// --- Estado de un formulario ---
export interface FormularioBase {
  id: string;
  tipo: TipoFormulario;
  tecnico: DatosTecnico;
  beneficiario: DatosBeneficiario;
  actividad: ActividadRealizada;
  sociodemografico?: DatosSociodemograficos;
  coordenadas: Coordenadas;
  georeferencia?: GeoReferencia;
  clima?: ResumenClimatico;
  fotos: FotoGeotag[];
  firma_beneficiario: string; // base64
  firma_tecnico: string; // base64
  huella_beneficiario: boolean;
  pdf_url?: string;
  sincronizado: boolean;
  created_at: string;
  updated_at: string;
}

export type Formulario = FormularioBase;

// --- Estado de sincronización ---
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'completed';

// --- Respuestas API ---
export interface ApiResponse<T> {
  estado: string;
  data?: T;
  mensaje?: string;
  error?: string;
}

// --- Filtros para listado de formularios ---
export interface FiltrosFormulario {
  lugar?: string;
  zona_rural?: string;
  tecnico?: string;
  beneficiario?: string;
  tipo?: TipoFormulario | 'all';
  sincronizado?: 'all' | 'synced' | 'pending';
  fecha_desde?: string;
  fecha_hasta?: string;
}

// --- Métricas del dashboard ---
export interface MetricasDashboard {
  total_visitas: number;
  visitas_hoy: number;
  tecnicos_activos: number;
  beneficiarios_atendidos: number;
  formularios_por_tipo: { tipo: string; count: number }[];
  visitas_por_municipio: { municipio: string; count: number }[];
  ultimas_visitas: Formulario[];
}

// ============================================================
// INTERFACES — Módulo de Mapas y SIG (Fase 1)
// ============================================================

/** Medición de terreno (Shoelace) */
export interface MedicionTerreno {
  id: string;
  formulario_id: string;
  area_hectareas: number;
  area_metros2: number;
  perimetro_metros: number;
  puntos: { latitud: number; longitud: number }[];
  created_at: string;
}

/** Conteo de plantas por especie */
export interface ConteoPlantas {
  id: string;
  formulario_id: string;
  especie: string;
  cantidad: number;
  observaciones?: string;
  created_at: string;
}

/** Posición de tracking GPS */
export interface PosicionTracking {
  id: string;
  usuario_id: string;
  latitud: number;
  longitud: number;
  altitud?: number;
  precision_gps?: number;
  velocidad?: number;
  heading?: number;
  timestamp: string;
  sincronizado: boolean;
}

/** Documento digital de finca */
export interface DocumentoFinca {
  id: string;
  formulario_id: string;
  tipo: 'foto' | 'pdf' | 'kml' | 'otro';
  uri: string;
  nombre: string;
  descripcion?: string;
  created_at: string;
}

// ============================================================
// INTERFACES — Capacitaciones (Fase 4)
// ============================================================

/** Capacitación a beneficiarios */
export interface Capacitacion {
  id: string;
  tema: string;
  descripcion: string;
  material_url?: string;
  material_nombre?: string;
  fecha: string;
  duracion_minutos: number;
  beneficiarios_asistentes: number;
  tecnico_id: string;
  lugar: string;
  observaciones?: string;
  fotos: string[];
  created_at: string;
  updated_at: string;
}

// ============================================================
// INTERFACES — Formulario Mejorado (Fase 3)
// ============================================================

/** Datos sociodemográficos del beneficiario */
export interface DatosSociodemograficos {
  genero: 'masculino' | 'femenino' | 'otro';
  escolaridad: string;
  etnia?: string;
  personas_cargo: number;
  hectareas: number;
  vive_en_finca: boolean;
  asociado: boolean;
  asociacion_nombre?: string;
  telefono_emergencia?: string;
}

/** Datos completos de beneficiario con sociodemográfico */
export interface DatosBeneficiarioCompleto extends DatosBeneficiario {
  sociodemografico?: DatosSociodemograficos;
  documentos?: DocumentoFinca[];
}

/** Filtros para consolidado gerencial */
export interface FiltrosConsolidado {
  fecha_desde?: string;
  fecha_hasta?: string;
  municipio?: string;
  vereda?: string;
  tecnico_id?: string;
  tipo_formulario?: TipoFormulario | 'all';
}
