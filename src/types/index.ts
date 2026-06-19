// ============================================================
// GEODAILY — Tipos Globales
// ============================================================

// --- Roles de usuario ---
export type UserRole = 'tecnico' | 'supervisor' | 'admin';

// --- Usuario autenticado ---
export interface Usuario {
  id: string;
  nombre: string;
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

// --- Información de foto geotaggeada ---
export interface FotoGeotag {
  id: string;
  uri: string;
  coordenadas: Coordenadas;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// --- Interface base para formularios de terreno ---
export interface DatosTecnico {
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

export type TipoFormulario = 'visita_tecnica' | 'plantacion';

// --- Estado de un formulario ---
export interface FormularioBase {
  id: string;
  tipo: TipoFormulario;
  tecnico: DatosTecnico;
  beneficiario: DatosBeneficiario;
  actividad: ActividadRealizada;
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
