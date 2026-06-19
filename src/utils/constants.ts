// ============================================================
// GEODAILY — Constantes Globales
// ============================================================

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'geodaily.auth_token',
  USER_DATA: 'geodaily.user_data',
  PENDING_FORMS: 'geodaily.pending_forms',
  SYNC_QUEUE: 'geodaily.sync_queue',
  LAST_SYNC: 'geodaily.last_sync',
  SETTINGS: 'geodaily.settings',
  TECNICO_CEDULA: 'geodaily.tecnico_cedula',
  VISITAS_PLANIFICADAS: 'geodaily.visitas_planificadas',
  FORM_DRAFTS: 'geodaily.form_drafts',
} as const;

// ============================================================
// DATOS DE COLOMBIA — 32 Departamentos con Municipios y Veredas
// ============================================================
// Cada municipio tiene veredas con formato "Vereda / Corregimiento"
// ============================================================

export interface DepartamentoInfo {
  municipios: Record<string, string[]>;
}

export const DEPARTAMENTOS_COLOMBIA: Record<string, DepartamentoInfo> = {
  'Amazonas': {
    municipios: {
      'Leticia': ['San Antonio / Corregimiento San Antonio', 'Los Lagos / Corregimiento Los Lagos', 'La Victoria / Corregimiento La Victoria', 'Nazareth / Corregimiento Nazareth', 'El Dorado / Corregimiento El Dorado'],
      'Puerto Nariño': ['San Pedro / Corregimiento San Pedro', 'Macedonia / Corregimiento Macedonia', 'Valencia / Corregimiento Valencia', 'San Francisco / Corregimiento San Francisco', 'Villa Andrea / Corregimiento Villa Andrea'],
      'El Encanto': ['San José / Corregimiento San José', 'La Unión / Corregimiento La Unión', 'Puerto Rico / Corregimiento Puerto Rico'],
      'La Chorrera': ['San Luis / Corregimiento San Luis', 'San Rafael / Corregimiento San Rafael'],
      'La Pedrera': ['San Miguel / Corregimiento San Miguel', 'San José / Corregimiento San José'],
    },
  },
  'Antioquia': {
    municipios: {
      'Medellín': ['San Sebastián / Corregimiento San Sebastián', 'Santa Elena / Corregimiento Santa Elena', 'Palmitas / Corregimiento Palmitas', 'Altavista / Corregimiento Altavista', 'San Antonio de Prado / Corregimiento San Antonio'],
      'Rionegro': ['San José / Corregimiento San José', 'El Tablazo / Corregimiento El Tablazo', 'San Antonio / Corregimiento San Antonio', 'La Ceja / Corregimiento La Ceja'],
      'Turbo': ['El Tres / Corregimiento El Tres', 'San Vicente / Corregimiento San Vicente', 'Currulao / Corregimiento Currulao', 'Nueva Antioquia / Corregimiento Nueva Antioquia'],
      'Apartadó': ['Churidó / Corregimiento Churidó', 'San José de Apartadó / Corregimiento San José', 'El Reposo / Corregimiento El Reposo'],
      'Caucasia': ['Puerto Colombia / Corregimiento Puerto Colombia', 'El Pando / Corregimiento El Pando', 'El Caimán / Corregimiento El Caimán'],
    },
  },
  'Arauca': {
    municipios: {
      'Arauca': ['El Caracol / Corregimiento El Caracol', 'La Esmeralda / Corregimiento La Esmeralda', 'San José de Lipa / Corregimiento San José', 'Puerto Contreras / Corregimiento Puerto Contreras'],
      'Saravena': ['La Primavera / Corregimiento La Primavera', 'Puerto Nariño / Corregimiento Puerto Nariño', 'Caño Seco / Corregimiento Caño Seco'],
      'Tame': ['Puerto López / Corregimiento Puerto López', 'San Lope / Corregimiento San Lope', 'El Corozo / Corregimiento El Corozo', 'Betoyes / Corregimiento Betoyes'],
      'Fortul': ['San Ignacio / Corregimiento San Ignacio', 'Caño Verde / Corregimiento Caño Verde'],
      'Arauquita': ['La Pesquera / Corregimiento La Pesquera', 'Puerto Lara / Corregimiento Puerto Lara'],
    },
  },
  'Atlántico': {
    municipios: {
      'Barranquilla': ['La Playa / Corregimiento La Playa', 'El Bosque / Corregimiento El Bosque', 'Suelta / Corregimiento Suelta'],
      'Soledad': ['El Manguito / Corregimiento El Manguito', 'La Central / Corregimiento La Central'],
      'Malambo': ['Caracolí / Corregimiento Caracolí', 'La Isabel / Corregimiento La Isabel'],
      'Puerto Colombia': ['Sabanilla / Corregimiento Sabanilla', 'Salgar / Corregimiento Salgar'],
      'Baranoa': ['Pitalito / Corregimiento Pitalito', 'Campeche / Corregimiento Campeche'],
    },
  },
  'Bolívar': {
    municipios: {
      'Cartagena': ['Bocachica / Corregimiento Bocachica', 'Punta Canoa / Corregimiento Punta Canoa', 'Caño del Oro / Corregimiento Caño del Oro', 'La Boquilla / Corregimiento La Boquilla', 'Bayunca / Corregimiento Bayunca'],
      'Magangué': ['San José de los Troncos / Corregimiento San José', 'El Retiro / Corregimiento El Retiro', 'Barbosa / Corregimiento Barbosa'],
      'El Carmen de Bolívar': ['San José / Corregimiento San José', 'El Salado / Corregimiento El Salado', 'Macayepo / Corregimiento Macayepo'],
      'Turbaco': ['El Rodeo / Corregimiento El Rodeo', 'Cañaveral / Corregimiento Cañaveral'],
      'Arjona': ['San Juan / Corregimiento San Juan', 'Gamero / Corregimiento Gamero'],
    },
  },
  'Boyacá': {
    municipios: {
      'Tunja': ['Piranguata / Corregimiento Piranguata', 'La Hoya / Corregimiento La Hoya', 'Runta / Corregimiento Runta', 'El Porvenir / Corregimiento El Porvenir'],
      'Sogamoso': ['San José / Corregimiento San José', 'Morcá / Corregimiento Morcá', 'Pedregal / Corregimiento Pedregal'],
      'Duitama': ['Santa Ana / Corregimiento Santa Ana', 'Surba / Corregimiento Surba', 'La Trinidad / Corregimiento La Trinidad'],
      'Paipa': ['El Palmar / Corregimiento El Palmar', 'Tobar / Corregimiento Tobar'],
      'Chiquinquirá': ['Santa Sofía / Corregimiento Santa Sofía', 'El Molino / Corregimiento El Molino'],
    },
  },
  'Caldas': {
    municipios: {
      'Manizales': ['El Aventino / Corregimiento El Aventino', 'La Cabaña / Corregimiento La Cabaña', 'La Fuente / Corregimiento La Fuente', 'Río Blanco / Corregimiento Río Blanco'],
      'Villamaría': ['La Floresta / Corregimiento La Floresta', 'El Rosario / Corregimiento El Rosario'],
      'Chinchiná': ['El Trébol / Corregimiento El Trébol', 'La Linda / Corregimiento La Linda'],
      'Pereira (Caldas)': ['San Juan / Corregimiento San Juan', 'El Bosque / Corregimiento El Bosque'],
    },
  },
  'Caquetá': {
    municipios: {
      'Puerto Rico': [
        'Aguila 1',
        'Alto Riecito',
        'Arenoso Oriente',
        'Blanca Nieves',
        'Brillante Bajo',
        'Brisas de La Cristalina',
        'Caimancito Medio Jordan',
        'Costa Rica Alta',
        'Costa Rica Baja',
        'El Libano Alto',
        'El Lobo',
        'El Nutrio',
        'El Porvenir',
        'La Aurora del Guayas',
        'La Floresta No 5',
        'La Florida Cimitarra',
        'La Independencia',
        'La Nutria',
        'La Victoria',
        'Lindanay',
        'Lobo No 2',
        'Monte Bello',
        'Monterrey',
        'Palestina 2',
        'Retorno',
        'San Marcos',
        'Siberia Alta',
        'Siberia Baja',
        'Villa Martha',
        'Villa Nueva',
        'Yarumal Bajo',
        'Yarumal Medio',
      ],
    },
  },
  'Casanare': {
    municipios: {
      'Yopal': ['El Morro / Corregimiento El Morro', 'La Chaparrera / Corregimiento La Chaparrera', 'Pauto / Corregimiento Pauto', 'Tilodirán / Corregimiento Tilodirán'],
      'Aguazul': ['Cupira / Corregimiento Cupira', 'San José del Bubuy / Corregimiento San José', 'Cagüí / Corregimiento Cagüí'],
      'Paz de Ariporo': ['La Aurora / Corregimiento La Aurora', 'Monterralo / Corregimiento Monterralo'],
      'Villanueva': ['Santa Helena / Corregimiento Santa Helena', 'San Miguel / Corregimiento San Miguel'],
    },
  },
  'Cauca': {
    municipios: {
      'Popayán': ['Puelenje / Corregimiento Puelenje', 'Julumito / Corregimiento Julumito', 'La Yunga / Corregimiento La Yunga', 'San Rafael / Corregimiento San Rafael'],
      'Santander de Quilichao': ['La Paloma / Corregimiento La Paloma', 'San Pedro / Corregimiento San Pedro', 'Quinamayó / Corregimiento Quinamayó'],
      'Puerto Tejada': ['La Balsa / Corregimiento La Balsa', 'San José / Corregimiento San José'],
      'El Tambo': ['Piagua / Corregimiento Piagua', 'Santa Marta / Corregimiento Santa Marta'],
    },
  },
  'Cesar': {
    municipios: {
      'Valledupar': ['El Perro / Corregimiento El Perro', 'Los Venados / Corregimiento Los Venados', 'Guatapurí / Corregimiento Guatapurí', 'Patillal / Corregimiento Patillal'],
      'Aguachica': ['La Yuca / Corregimiento La Yuca', 'San José / Corregimiento San José', 'El Juncal / Corregimiento El Juncal'],
      'Codazzi': ['San José de Oriente / Corregimiento San José', 'El Hatico / Corregimiento El Hatico'],
      'La Jagua de Ibirico': ['Las Palmitas / Corregimiento Las Palmitas', 'La Victoria / Corregimiento La Victoria'],
    },
  },
  'Chocó': {
    municipios: {
      'Quibdó': ['San Antonio / Corregimiento San Antonio', 'La Troje / Corregimiento La Troje', 'Tutunendo / Corregimiento Tutunendo', 'Guingambó / Corregimiento Guingambó'],
      'Istmina': ['San Pablo / Corregimiento San Pablo', 'Piedrasentada / Corregimiento Piedrasentada'],
      'Condoto': ['San José / Corregimiento San José', 'La Toma / Corregimiento La Toma'],
      'Bahía Solano': ['El Valle / Corregimiento El Valle', 'Huarapales / Corregimiento Huarapales'],
    },
  },
  'Córdoba': {
    municipios: {
      'Montería': ['La Apartada / Corregimiento La Apartada', 'El Sabanal / Corregimiento El Sabanal', 'Jaraquiel / Corregimiento Jaraquiel', 'Santa Isabel / Corregimiento Santa Isabel'],
      'Lorica': ['El Rodeo / Corregimiento El Rodeo', 'San José / Corregimiento San José', 'Los Córdobas / Corregimiento Los Córdobas'],
      'Cereté': ['San Anterito / Corregimiento San Anterito', 'Martínez / Corregimiento Martínez'],
      'Tierralta': ['San José / Corregimiento San José', 'El Caramelo / Corregimiento El Caramelo'],
    },
  },
  'Cundinamarca': {
    municipios: {
      'Bogotá D.C.': ['Usme / Corregimiento Usme', 'Sumapaz / Corregimiento Sumapaz', 'La Unión / Corregimiento La Unión', 'San Juan / Corregimiento San Juan'],
      'Soacha': ['Altos de Cazucá / Corregimiento Cazucá', 'San Jorge / Corregimiento San Jorge'],
      'Facatativá': ['La Selva / Corregimiento La Selva', 'San Rafael / Corregimiento San Rafael'],
      'Zipaquirá': ['Barandillas / Corregimiento Barandillas', 'San José / Corregimiento San José', 'El Empalizado / Corregimiento El Empalizado'],
      'Girardot': ['La Esmeralda / Corregimiento La Esmeralda', 'San José / Corregimiento San José'],
    },
  },
  'Guainía': {
    municipios: {
      'Inírida': ['San José / Corregimiento San José', 'La Ceiba / Corregimiento La Ceiba', 'El Porvenir / Corregimiento El Porvenir'],
      'Barrancominas': ['La Paz / Corregimiento La Paz', 'Santa Rosa / Corregimiento Santa Rosa'],
    },
  },
  'Guaviare': {
    municipios: {
      'San José del Guaviare': ['La Sombra / Corregimiento La Sombra', 'El Capricho / Corregimiento El Capricho', 'Tomachipán / Corregimiento Tomachipán'],
      'El Retorno': ['San Lucas / Corregimiento San Lucas', 'La Libertad / Corregimiento La Libertad'],
      'Calamar': ['La Paz / Corregimiento La Paz', 'San José / Corregimiento San José'],
    },
  },
  'Huila': {
    municipios: {
      'Neiva': ['El Caguán / Corregimiento El Caguán', 'San Luis / Corregimiento San Luis', 'Guacirco / Corregimiento Guacirco', 'Ríoloro / Corregimiento Ríoloro'],
      'Pitalito': ['Bruselas / Corregimiento Bruselas', 'La Laguna / Corregimiento La Laguna', 'San José / Corregimiento San José'],
      'Garzón': ['San Antonio / Corregimiento San Antonio', 'El Recreo / Corregimiento El Recreo'],
      'La Plata': ['San Vicente / Corregimiento San Vicente', 'El Carmen / Corregimiento El Carmen'],
    },
  },
  'La Guajira': {
    municipios: {
      'Riohacha': ['Barbosa / Corregimiento Barbosa', 'Tomarrazón / Corregimiento Tomarrazón', 'Camarones / Corregimiento Camarones', 'Manaure / Corregimiento Manaure'],
      'Maicao': ['Carraipía / Corregimiento Carraipía', 'Paraguachón / Corregimiento Paraguachón'],
      'Uribia': ['Nazareth / Corregimiento Nazareth', 'Puerto Estrella / Corregimiento Puerto Estrella'],
      'San Juan del Cesar': ['Los Haticos / Corregimiento Los Haticos', 'El Hato / Corregimiento El Hato'],
    },
  },
  'Magdalena': {
    municipios: {
      'Santa Marta': ['Minca / Corregimiento Minca', 'Bonda / Corregimiento Bonda', 'Taganga / Corregimiento Taganga', 'Guachaca / Corregimiento Guachaca'],
      'Ciénaga': ['San Javier / Corregimiento San Javier', 'Salamina / Corregimiento Salamina', 'Sevilla / Corregimiento Sevilla'],
      'Fundación': ['Santa Clara / Corregimiento Santa Clara', 'La Meseta / Corregimiento La Meseta'],
      'El Banco': ['San José / Corregimiento San José', 'El Peñón / Corregimiento El Peñón'],
    },
  },
  'Meta': {
    municipios: {
      'Villavicencio': ['El Pinal / Corregimiento El Pinal', 'La Cuncia / Corregimiento La Cuncia', 'Buenavista / Corregimiento Buenavista', 'Vanguardia / Corregimiento Vanguardia'],
      'Acacías': ['San Isidro / Corregimiento San Isidro', 'Dinamarca / Corregimiento Dinamarca', 'La California / Corregimiento La California'],
      'Granada': ['San José / Corregimiento San José', 'El Porvenir / Corregimiento El Porvenir'],
      'Puerto López': ['Remolino / Corregimiento Remolino', 'San Pedro / Corregimiento San Pedro'],
    },
  },
  'Nariño': {
    municipios: {
      'Pasto': ['Catambuco / Corregimiento Catambuco', 'Jamondino / Corregimiento Jamondino', 'La Laguna / Corregimiento La Laguna', 'Mocondino / Corregimiento Mocondino'],
      'Tumaco': ['El Morro / Corregimiento El Morro', 'La Guayacana / Corregimiento La Guayacana', 'San Luis / Corregimiento San Luis'],
      'Ipiales': ['San Juan / Corregimiento San Juan', 'La Victoria / Corregimiento La Victoria'],
      'Barbacoas': ['El Diviso / Corregimiento El Diviso', 'San José / Corregimiento San José'],
    },
  },
  'Norte de Santander': {
    municipios: {
      'Cúcuta': ['San Isidro / Corregimiento San Isidro', 'Aguaclara / Corregimiento Aguaclara', 'La Garita / Corregimiento La Garita', 'El Diamante / Corregimiento El Diamante'],
      'Ocaña': ['Buenavista / Corregimiento Buenavista', 'La Floresta / Corregimiento La Floresta'],
      'Pamplona': ['El Diamante / Corregimiento El Diamante', 'San José / Corregimiento San José'],
      'Tibú': ['La Gabarra / Corregimiento La Gabarra', 'San José / Corregimiento San José'],
    },
  },
  'Putumayo': {
    municipios: {
      'Mocoa': ['San Antonio / Corregimiento San Antonio', 'El Pepino / Corregimiento El Pepino', 'La Tebaida / Corregimiento La Tebaida'],
      'Puerto Asís': ['La Carmelita / Corregimiento La Carmelita', 'Santana / Corregimiento Santana', 'Brisas del Amazonas / Corregimiento Brisas'],
      'Orito': ['La Dorada / Corregimiento La Dorada', 'San José / Corregimiento San José'],
      'Valle del Guamuez': ['El Placer / Corregimiento El Placer', 'La Libertad / Corregimiento La Libertad'],
      'Puerto Caicedo': ['San Pedro / Corregimiento San Pedro', 'El Jardín / Corregimiento El Jardín'],
      'San Miguel': ['La Nueva Unión / Corregimiento La Nueva Unión', 'El Retorno / Corregimiento El Retorno'],
      'Puerto Guzmán': ['San Luis / Corregimiento San Luis', 'La Tagua / Corregimiento La Tagua'],
    },
  },
  'Quindío': {
    municipios: {
      'Armenia': ['El Caimo / Corregimiento El Caimo', 'Génova / Corregimiento Génova', 'Barcelona / Corregimiento Barcelona'],
      'Calarcá': ['La Virginia / Corregimiento La Virginia', 'Quebradanegra / Corregimiento Quebradanegra'],
      'Montenegro': ['El Edén / Corregimiento El Edén', 'La María / Corregimiento La María'],
      'Salento': ['Boquía / Corregimiento Boquía', 'Cocora / Corregimiento Cocora'],
    },
  },
  'Risaralda': {
    municipios: {
      'Pereira': ['Caimalito / Corregimiento Caimalito', 'La Florida / Corregimiento La Florida', 'Altavista / Corregimiento Altavista'],
      'Dosquebradas': ['La Unión / Corregimiento La Unión', 'El Español / Corregimiento El Español'],
      'Santa Rosa de Cabal': ['San José / Corregimiento San José', 'El Retiro / Corregimiento El Retiro'],
      'La Virginia': ['El Bosque / Corregimiento El Bosque', 'La Esperanza / Corregimiento La Esperanza'],
    },
  },
  'San Andrés y Providencia': {
    municipios: {
      'San Andrés': ['La Loma / Corregimiento La Loma', 'San Luis / Corregimiento San Luis', 'El Cove / Corregimiento El Cove'],
      'Providencia': ['Santa Isabel / Corregimiento Santa Isabel', 'San José / Corregimiento San José'],
    },
  },
  'Santander': {
    municipios: {
      'Bucaramanga': ['San José / Corregimiento San José', 'La Fuente / Corregimiento La Fuente', 'Vijagual / Corregimiento Vijagual'],
      'Barrancabermeja': ['El Llanito / Corregimiento El Llanito', 'La Fortuna / Corregimiento La Fortuna', 'San Rafael / Corregimiento San Rafael'],
      'San Gil': ['El Barro / Corregimiento El Barro', 'San José / Corregimiento San José'],
      'Socorro': ['El Retiro / Corregimiento El Retiro', 'La Granja / Corregimiento La Granja'],
    },
  },
  'Sucre': {
    municipios: {
      'Sincelejo': ['La Gallera / Corregimiento La Gallera', 'San Rafael / Corregimiento San Rafael', 'Las Palmas / Corregimiento Las Palmas'],
      'Corozal': ['San José / Corregimiento San José', 'El Piñal / Corregimiento El Piñal'],
      'San Marcos': ['El Limón / Corregimiento El Limón', 'San Fernando / Corregimiento San Fernando'],
      'Tolú': ['La Inmaculada / Corregimiento La Inmaculada', 'El Rincón / Corregimiento El Rincón'],
    },
  },
  'Tolima': {
    municipios: {
      'Ibagué': ['El Totumo / Corregimiento El Totumo', 'San Bernardo / Corregimiento San Bernardo', 'La Pedregosa / Corregimiento La Pedregosa', 'El Salado / Corregimiento El Salado'],
      'Espinal': ['San José / Corregimiento San José', 'Buenavista / Corregimiento Buenavista'],
      'Líbano': ['San Fernando / Corregimiento San Fernando', 'La Honda / Corregimiento La Honda'],
      'Mariquita': ['San José / Corregimiento San José', 'El Triunfo / Corregimiento El Triunfo'],
    },
  },
  'Valle del Cauca': {
    municipios: {
      'Cali': ['La Buitrera / Corregimiento La Buitrera', 'El Hormiguero / Corregimiento El Hormiguero', 'Pance / Corregimiento Pance', 'Los Andes / Corregimiento Los Andes'],
      'Buenaventura': ['San Isidro / Corregimiento San Isidro', 'La Bocana / Corregimiento La Bocana', 'Córdoba / Corregimiento Córdoba'],
      'Palmira': ['La Acequia / Corregimiento La Acequia', 'El Carmelo / Corregimiento El Carmelo'],
      'Tuluá': ['San José / Corregimiento San José', 'La Marina / Corregimiento La Marina'],
    },
  },
  'Vaupés': {
    municipios: {
      'Mitú': ['San José / Corregimiento San José', 'Puerto Colombia / Corregimiento Puerto Colombia', 'La Unión / Corregimiento La Unión'],
      'Carurú': ['San Luis / Corregimiento San Luis', 'El Encanto / Corregimiento El Encanto'],
    },
  },
  'Vichada': {
    municipios: {
      'Puerto Carreño': ['Santa Bárbara / Corregimiento Santa Bárbara', 'La Venturosa / Corregimiento La Venturosa', 'Puerto Nariño / Corregimiento Puerto Nariño'],
      'La Primavera': ['San José / Corregimiento San José', 'El Porvenir / Corregimiento El Porvenir'],
    },
  },
};

// ============================================================
// Helper: lista plana de todos los municipios (para compatibilidad)
// ============================================================
export const MUNICIPIOS_COLOMBIA: readonly string[] = Object.values(DEPARTAMENTOS_COLOMBIA)
  .flatMap(d => Object.keys(d.municipios));

// ============================================================
// Helper: zonas rurales agrupadas por municipio (para compatibilidad)
// ============================================================
export const ZONAS_RURALES: Record<string, readonly string[]> = {};
Object.entries(DEPARTAMENTOS_COLOMBIA).forEach(([_depto, info]) => {
  Object.entries(info.municipios).forEach(([municipio, veredas]) => {
    ZONAS_RURALES[municipio] = veredas;
  });
});

// ============================================================
// Helper: obtener municipios de un departamento
// ============================================================
export const getMunicipiosByDepartamento = (departamento: string): string[] => {
  return Object.keys(DEPARTAMENTOS_COLOMBIA[departamento]?.municipios || {});
};

// ============================================================
// Helper: obtener veredas de un municipio en un departamento
// ============================================================
export const getVeredasByMunicipio = (departamento: string, municipio: string): string[] => {
  return DEPARTAMENTOS_COLOMBIA[departamento]?.municipios[municipio] || [];
};

// ============================================================
// Lista de departamentos
// ============================================================
export const DEPARTAMENTOS_LIST: readonly string[] = Object.keys(DEPARTAMENTOS_COLOMBIA);

export const TIPOS_ACTIVIDAD = [
  'Visita de seguimiento',
  'Capacitación técnica',
  'Evaluación de plantación',
  'Control fitosanitario',
  'Toma de muestras de suelo',
  'Instalación de sistema de riego',
  'Poda y mantenimiento',
  'Cosecha',
  'Fertilización',
  'Otra',
] as const;

export const ERROR_MESSAGES = {
  NETWORK: 'Sin conexión a internet. Los datos se guardarán localmente.',
  GPS: 'No se pudo obtener la ubicación GPS. Verifica que esté activado.',
  CAMERA: 'No se pudo acceder a la cámara. Verifica los permisos.',
  AUTH: 'Usuario o contraseña incorrectos.',
  GENERIC: 'Ha ocurrido un error. Por favor intenta de nuevo.',
  SYNC: 'Error de sincronización. Los datos permanecen guardados localmente.',
} as const;
