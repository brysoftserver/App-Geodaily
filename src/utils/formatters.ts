// ============================================================
// GEODAILY — Utilidades
// ============================================================

import { format, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale/es';

// --- Formateo de fechas ---
export const formatFecha = (fecha: string | Date, formato: string = 'dd/MM/yyyy'): string => {
  const date = typeof fecha === 'string' ? parseISO(fecha) : fecha;
  if (!isValid(date)) return 'Fecha inválida';
  return format(date, formato, { locale: es });
};

export const formatFechaHora = (fecha: string | Date): string => {
  return formatFecha(fecha, "dd/MM/yyyy 'a las' HH:mm");
};

export const formatFechaRelativa = (fecha: string | Date): string => {
  const date = typeof fecha === 'string' ? parseISO(fecha) : fecha;
  if (!isValid(date)) return 'Fecha inválida';
  const ahora = new Date();
  const diffMs = ahora.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHoras = Math.floor(diffMs / 3600000);
  const diffDias = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Hace un momento';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHoras < 24) return `Hace ${diffHoras}h`;
  if (diffDias < 7) return `Hace ${diffDias} días`;
  return formatFecha(fecha);
};

// --- Formateo de coordenadas ---
export const formatCoordenadas = (lat: number, lon: number, decimals: number = 6): string => {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(decimals)}°${latDir}, ${Math.abs(lon).toFixed(decimals)}°${lonDir}`;
};

export const formatUTM = (huso: number, banda: string): string => {
  return `${huso}${banda}`;
};

// --- Formateo de clima ---
export const formatTemperatura = (temp: number): string => {
  return `${temp.toFixed(1)}°C`;
};

export const formatHumedad = (hum: number): string => {
  return `${hum.toFixed(0)}%`;
};

export const formatVelocidadViento = (vel: number): string => {
  return `${vel.toFixed(1)} m/s`;
};

// --- Validación de formularios ---
export const validarRequerido = (valor: string | undefined | null, campo: string): string | null => {
  if (!valor || valor.trim().length === 0) {
    return `${campo} es requerido`;
  }
  return null;
};

export const validarCedula = (cedula: string): string | null => {
  if (!/^\d{6,10}$/.test(cedula)) {
    return 'Cédula inválida (6-10 dígitos)';
  }
  return null;
};

export const validarTelefono = (telefono: string): string | null => {
  if (!/^\d{7,10}$/.test(telefono)) {
    return 'Teléfono inválido (7-10 dígitos)';
  }
  return null;
};

export const validarEmail = (email: string): string | null => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Email inválido';
  }
  return null;
};

// --- Generación de IDs ---
export const generarId = (): string => {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
};

// --- Truncar texto ---
export const truncarTexto = (texto: string, maxLen: number = 50): string => {
  if (texto.length <= maxLen) return texto;
  return texto.substring(0, maxLen) + '...';
};

// --- Capitalizar ---
export const capitalizar = (texto: string): string => {
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
};
