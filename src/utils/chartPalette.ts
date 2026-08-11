// ============================================================
// GEODAILY — Paleta categórica para gráficas de estadísticas
// ============================================================
// Orden fijo validado por la skill dataviz (adjacent CVD ΔE ≥ 8,
// normal-vision floor ≥ 15 en los 8 slots). Los primeros 6 tonos
// son los mismos que ya usa `corregimientos.ts` — no son un color
// nuevo, es el mismo orden reutilizado para que la app tenga una
// sola paleta categórica.
// ============================================================

export const CATEGORICAL_PALETTE: string[] = [
  '#2A78D6', // 1 azul
  '#EB6834', // 2 naranja
  '#1BAF7A', // 3 aqua
  '#EDA100', // 4 amarillo
  '#E87BA4', // 5 magenta
  '#008300', // 6 verde
  '#4A3AA7', // 7 violeta
  '#E34948', // 8 rojo
];

/** Gris neutro para el balde "Otros" — no compite con los 8 tonos categóricos. */
export const COLOR_OTROS = '#9E9E9E';

/** Color de acento único para gráficas de barras (magnitud, no identidad). */
export const COLOR_BARRA_ACENTO = CATEGORICAL_PALETTE[0];

/** Devuelve el color categórico en el slot `indice`, ciclando solo como último recurso. */
export const colorParaIndice = (indice: number): string =>
  CATEGORICAL_PALETTE[indice % CATEGORICAL_PALETTE.length];

/** `rgb(r, g, b)` de un color en formato `#RRGGBB` — para `chartConfig.color(opacity)` de react-native-chart-kit. */
export const hexARgb = (hex: string): { r: number; g: number; b: number } => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
