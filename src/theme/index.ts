// ============================================================
// GEODAILY — Tema Global (Colores, Tipografía, Espaciados)
// ============================================================

export const COLORS = {
  // Colores primarios - Verde institucional (cacao)
  primary: '#1B5E20',
  primaryLight: '#388E3C',
  primaryDark: '#0D3B0F',

  // Colores secundarios - Ámbar/Dorado
  secondary: '#F9A825',
  secondaryLight: '#FFD54F',
  secondaryDark: '#C17900',

  // Colores de fondo
  background: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceAlt: '#E8F5E9',

  // Texto
  textPrimary: '#212121',
  textSecondary: '#616161',
  textLight: '#9E9E9E',
  textOnPrimary: '#FFFFFF',
  textOnSecondary: '#1B5E20',

  // Estados
  success: '#2E7D32',
  warning: '#F57F17',
  error: '#C62828',
  info: '#1565C0',

  // Roles
  roleTecnico: '#1565C0',
  roleSupervisor: '#6A1B9A',
  roleGerente: '#E65100',
  roleAdmin: '#C62828',

  // Bordes y dividers
  border: '#E0E0E0',
  divider: '#EEEEEE',

  // Mapas
  mapTileBackground: '#F1F8E9',

  // Transparencias
  overlay: 'rgba(0,0,0,0.5)',
  shadow: 'rgba(0,0,0,0.1)',
} as const;

export const FONTS = {
  sizes: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
    title: 26,
    hero: 32,
  },
  weights: {
    light: '300' as const,
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  families: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;

export const API_CONFIG = {
  BASE_URL: process.env.BACKEND_URL || 'http://192.168.1.20:8089',
  TIMEOUT: Number(process.env.API_TIMEOUT) || 15000,
  ENDPOINTS: {
    GEOREFERENCE: '/api/georeference',
    CLIMATE: '/api/climate',
    MAPS: '/api/maps',
    PHOTOS: '/api/photos',
    HEALTH: '/health',
    PDF: '/api/pdfs',
    FORMS: '/api/formularios',
    AUTH: '/api/auth',
  },
};
