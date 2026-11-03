// ============================================================
// GEODAILY — Torta de avance de una actividad (con leyenda)
// ============================================================
// Compartida por las pantallas de actividades (suelos, hectáreas…).
// ============================================================

import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

export const COLOR_HECHO = COLORS.success;
export const COLOR_FALTA = COLORS.error;
export const PALETA_TECNICOS = ['#1B5E20', '#1565C0', '#EF6C00', '#6A1B9A', '#00838F', '#AD1457', '#827717', '#4E342E', '#37474F', '#C62828'];

const ANCHO_TORTA = Dimensions.get('window').width - SPACING.md * 4;

export interface DatoTorta {
  etiqueta: string;
  valor: number;
  color: string;
}

interface TortaResumenProps {
  titulo: string;
  datos: DatoTorta[];
  /** Cómo mostrar cada valor en la leyenda (por defecto, tal cual). */
  formatear?: (valor: number) => string;
  /** Texto cuando todo está en cero. */
  textoVacio?: string;
}

const TortaResumen: React.FC<TortaResumenProps> = ({
  titulo,
  datos,
  formatear = (v) => String(v),
  textoVacio = 'Aún no hay avance registrado.',
}) => {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>{titulo}</Text>
      {total > 0 ? (
        <PieChart
          data={datos
            .filter((d) => d.valor > 0)
            .map((d) => ({ name: d.etiqueta, population: d.valor, color: d.color, legendFontColor: COLORS.textSecondary, legendFontSize: 11 }))}
          width={ANCHO_TORTA}
          height={150}
          chartConfig={{ color: (o = 1) => `rgba(0,0,0,${o})` }}
          accessor="population"
          backgroundColor="transparent"
          paddingLeft={String(ANCHO_TORTA / 4)}
          hasLegend={false}
          absolute
        />
      ) : (
        <Text style={styles.vacio}>{textoVacio}</Text>
      )}
      <View style={styles.leyenda}>
        {datos.map((d) => (
          <View key={d.etiqueta} style={styles.leyendaItem}>
            <View style={[styles.punto, { backgroundColor: d.color }]} />
            <Text style={styles.leyendaTxt} numberOfLines={1}>
              {d.etiqueta}: <Text style={styles.negrita}>{formatear(d.valor)}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md, ...SHADOWS.sm },
  titulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.xs },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', marginRight: SPACING.md, marginTop: 2, maxWidth: '100%' },
  leyendaTxt: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  negrita: { fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  punto: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
});

export default TortaResumen;
