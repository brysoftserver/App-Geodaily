// ============================================================
// GEODAILY — Tipos Globales
// ============================================================

// --- Roles de usuario ---
export type UserRole = 'tecnico' | 'supervisor' | 'interventor' | 'gerente' | 'admin';

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

export type TipoFormulario = 'caracterizacion' | 'visita_tecnica';

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
// --- Punto de polígono ---
export interface PuntoPoligono {
  latitud: number;
  longitud: number;
  orden: number;
}

// --- Plantación marcada en mapa ---
export interface Plantacion {
  id: string;
  usuario_id: string;
  latitud: number;
  longitud: number;
  especie: string;
  cantidad: number;
  timestamp: string;
  sincronizado: boolean;
  icono: string;
  /** Polígono del área de plantación (opcional — si viene, latitud/longitud son el centroide) */
  poligono?: PuntoPoligono[];
}

export interface VisitaProgramada {
  id: string;
  usuario_id?: string;
  usuario_nombre?: string;
  titulo: string;
  ubicacion: string;
  fecha: string; // YYYY-MM-DD
  estado: 'pendiente' | 'realizada' | 'cancelada';
  sincronizado?: boolean;
}

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
// INTERFACES — Base de Datos de Beneficiarios
// ============================================================

/** Beneficiario en la base de datos de beneficiarios */
export interface BeneficiarioDB {
  item: number;
  corregimiento: string;
  vereda: string;
  nombre_completo: string;
  cedula: string;
  tecnico_asignado_id?: string | null;
  tecnico_asignado_nombre?: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload para crear/editar un beneficiario manual */
export interface BeneficiarioPayload {
  item: number;
  corregimiento: string;
  vereda: string;
  nombre_completo: string;
  cedula: string;
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

// ============================================================
// INTERFACES — Nuevo Formulario de Caracterización (Fase 2)
// ============================================================

export interface ComponenteSocial {
  nivel_educativo: string;
  personas_nucleo: string;
  fuente_ingresos: string;
  participa_organizacion: string; // 'Sí' | 'No'
  servicios_publicos: string;    // 'Todos los servicios' | 'Algunos servicios' | 'Ningún servicio'
  mano_obra: string;
}

export interface ComponenteProductivo {
  actividad_productiva: string;
  acceso_agua: string;       // 'Sí' | 'No'
  sistemas_riego: string;    // 'Sí' | 'No'
  asistencia_tecnica: string; // 'Sí' | 'No'
}

export interface ComponenteAgroambiental {
  procesos_erosion: string;
  fuentes_hidricas: string;
  areas_conservacion: string;   // 'Sí' | 'No'
  practicas_conservacion: string;
  manejo_residuos: string;
}

export interface AnalisisSueloCaracterizacion {
  observacion_suelo: string;     // 'Sí' | 'No'
  textura: string;
  color: string;
  drenaje: string;
  profundidad: string;
  piedras: string;
  compactacion: string;
  cobertura: string;
  evidencia_erosion: string;
}

export interface RecomendacionesCaracterizacion {
  recomendaciones_tecnicas: string;
  recomendaciones_ambientales: string;
}

/** Datos completos del nuevo formulario de caracterización */
export interface DatosCaracterizacionNueva {
  // Datos generales / header
  municipio: string;
  fecha: string;
  vereda: string;
  encuesta_numero: string;
  productor_nombre: string;
  documento: string;
  telefono: string;
  tecnico_responsable: string;
  tecnico_cedula: string;
  finca: string;

  // Componentes
  componente_social: ComponenteSocial;
  componente_productivo: ComponenteProductivo;
  componente_agroambiental: ComponenteAgroambiental;
  analisis_suelo: AnalisisSueloCaracterizacion;
  recomendaciones: RecomendacionesCaracterizacion;
}

// ============================================================
// INTERFACES — Encuesta Social AgroAmbiental (Fase 5)
// ============================================================

export interface ComponenteSocialEncuesta {
  // P1. Reconocimiento étnico
  reconocimiento: string;
  reconocimiento_otro: string;
  // P2. Nivel educativo
  nivel_educativo: string;
  // P3. Participación ECA
  participo_eca: string; // 'Sí' | 'No'
  // P4. Personas núcleo familiar
  personas_nucleo: string;
  // P5. Fuente ingresos
  fuente_ingresos: string;
  fuente_ingresos_otra: string;
  // P6. Ocupación secundaria
  ocupacion_secundaria: string;
  ocupacion_secundaria_otro: string;
  // P7. Participa en organización
  participa_organizacion: string; // 'Sí' | 'No'
  organizacion_cual: string;
  // P8. Tipo de asociación
  tipo_asociacion: string;
  tipo_asociacion_otro: string;
  // P9. Rol en asociación
  rol_asociacion: string;
  // P10. Vivienda ubicación
  vivienda_ubicacion: string;
  vivienda_ubicacion_otra?: string;
  // P11. Energía eléctrica
  energia_electrica: string; // 'Sí' | 'No'
  // P12. Tipo de energía
  tipo_energia: string;
  tipo_energia_otro: string;
  // P13. Agua consumo
  agua_consumo: string;
  agua_consumo_otro: string;
  // P14. Elementos tecnológicos (respuesta múltiple, separada por comas)
  elementos_tecnologicos: string;
  // P15. Señal celular
  senal_celular: string; // 'Sí' | 'No'
  // P16. Quiénes trabajan
  quienes_trabajan: string;
  quienes_trabajan_otro?: string;
  // P17. Medio de transporte
  medio_transporte: string;
  medio_transporte_otro: string;
}

export interface CaracterizacionFinca {
  nombre_finca: string;
  // P19. Coordenada de la finca (captura GPS)
  latitud: string;
  longitud: string;
  altitud: string;
  // P20. Área total (ha)
  area_total: string;
  // P21. División en hectáreas (texto oficial del ministerio)
  division_bosque: string;
  division_agricola?: string;
  division_pecuaria?: string;
  division_instalaciones?: string;
  // Campos antiguos (conservados para borradores previos — ya no se usan)
  division_cana?: string;
  division_pastos?: string;
  division_otros_cultivos?: string;
  division_rastrojo?: string;
  // P22. Medio de salida de productos
  medio_salida: string;
  medio_salida_otro: string;
  // P23. Distancia aproximada al centro poblado (km)
  distancia_km?: string;
  // P24. Observaciones descripción llegada al predio
  distancia_observaciones: string;
  // P25. Aprovechamiento productivo directo (Sí/No + porqué)
  aprovechamiento_directo: string;
  aprovechamiento_porque?: string;
  // P26. Actividades que realiza en la finca (respuesta múltiple)
  actividades_finca?: string;
  actividades_finca_otro?: string;
  actividades_agricolas: string; // sub-selección múltiple de agrícolas
  actividades_agricolas_otro?: string;
  actividades_pecuarias: string; // sub-selección múltiple de pecuarias
  actividades_pecuarias_otro?: string;
}

export interface ComponenteProductivoEncuesta {
  // P27. Actividad principal productiva (+ Cual?)
  actividad_principal: string;
  actividad_principal_cual?: string;
  acceso_agua: string;
  sistemas_riego: string;
  asistencia_tecnica: string;
  // Campos antiguos (el análisis pasó a la Sección de suelo, P32)
  analisis_suelo?: string;
  analisis_fisicoquimico?: string;
  analisis_cromatografia?: string;
}

export interface AnalisisSueloEncuesta {
  // P31. Ubicación del área de intervención del proyecto (geo)
  intervencion_latitud?: string;
  intervencion_longitud?: string;
  intervencion_altitud?: string;
  // P32. ¿Ha realizado alguna vez análisis de suelo en su predio?
  analisis_realizado?: string;
  // Campo antiguo (ya no se pregunta)
  observacion_suelo?: string;
  // P33. Textura (selección múltiple, separada por comas)
  textura: string;
  color: string;
  drenaje: string;
  profundidad: string;
  piedras: string;
  compactacion: string;
  cobertura: string;
  erosion: string;
  // P41. Grado de pendiente del terreno (°)
  pendiente: string;
}

export interface ComponenteAgroambientalEncuesta {
  procesos_erosion: string;
  fuentes_hidricas: string;
  areas_conservacion: string;
  practicas_conservacion: string;
  uso_agroquimicos: string; // 'Si' | 'No'
  tipo_agroquimicos: string;
  tipo_agroquimicos_otro?: string;
  herbicidas_cuales: string; // P48 — texto libre
  manejo_residuos: string;
}

export interface RecomendacionesEncuesta {
  recomendaciones_tecnicas: string;
  compromisos_productor: string;
  recomendaciones_ambientales: string;
}

export interface AcompaniamientoTecnico {
  // Ítems 1-7 del Desarrollo del Acompañamiento Técnico (texto oficial).
  // Los nombres de campo se conservan por compatibilidad con borradores:
  // 1. Socialización de actividades del proyecto
  actividades_realizadas_si: boolean;
  actividades_realizadas_no: boolean;
  actividades_realizadas_obs: string;
  // 2. Selección y delimitación técnica del terreno
  manejo_plagas_si: boolean;
  manejo_plagas_no: boolean;
  manejo_plagas_obs: string;
  // 3. Muestreo de suelo
  manejo_suelo_si: boolean;
  manejo_suelo_no: boolean;
  manejo_suelo_obs: string;
  // 4. Punto de georeferenciación del terreno (con captura GPS)
  manejo_agua_si: boolean;
  manejo_agua_no: boolean;
  manejo_agua_obs: string;
  georef_latitud?: string;
  georef_longitud?: string;
  georef_altitud?: string;
  // 5. Orientación sobre procesos de producción de cacao
  capacitacion_si: boolean;
  capacitacion_no: boolean;
  capacitacion_obs: string;
  // 6. Orientación manejo de preparación del terreno (limpias)
  seguimiento_si: boolean;
  seguimiento_no: boolean;
  seguimiento_obs: string;
  // 7. Orientación manejo de preparación del terreno (entresacado)
  entresacado_si?: boolean;
  entresacado_no?: boolean;
  entresacado_obs?: string;
  observaciones_generales: string;
}

/** Datos completos de la Encuesta Social AgroAmbiental */
export interface EncuestaSocialAgroAmbiental {
  // Datos generales
  municipio: string;
  fecha: string;
  vereda: string;
  productor_nombre: string;
  edad: string;
  sexo: string;
  sexo_otro: string;
  documento: string;
  telefono: string;
  tecnico_responsable: string;
  tecnico_cedula: string;
  ubicacion_predio: string;

  // Componentes
  componente_social: ComponenteSocialEncuesta;
  caracterizacion_finca: CaracterizacionFinca;
  componente_productivo: ComponenteProductivoEncuesta;
  analisis_suelo: AnalisisSueloEncuesta;
  componente_agroambiental: ComponenteAgroambientalEncuesta;
  recomendaciones: RecomendacionesEncuesta;
  acompaniamiento: AcompaniamientoTecnico;
}
