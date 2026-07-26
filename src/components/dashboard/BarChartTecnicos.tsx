// ============================================================
// GEODAILY — Visitas por técnico (barras + tabla)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

export interface ConteoTecnico {
  nombre: string;
  total: number;
}

interface BarChartTecnicosProps {
  datos: ConteoTecnico[];
}

const screenWidth = Dimensions.get('window').width;
const ANCHO_POR_BARRA = 68;

const primerNombre = (nombreCompleto: string) => nombreCompleto.trim().split(/\s+/)[0] || nombreCompleto;

const BarChartTecnicos: React.FC<BarChartTecnicosProps> = ({ datos }) => {
  if (datos.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.titulo}>Visitas por técnico</Text>
        <Text style={styles.vacio}>Aún no hay visitas registradas por técnico.</Text>
      </View>
    );
  }

  const anchoChart = Math.max(screenWidth - SPACING.lg * 2 - SPACING.md * 2, datos.length * ANCHO_POR_BARRA);

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>Visitas por técnico</Text>
      <Text style={styles.subtitulo}>Total de visitas (Formulario 1 + Formulario 2) realizadas por cada técnico</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <BarChart
          data={{
            labels: datos.map((d) => primerNombre(d.nombre)),
            datasets: [{ data: datos.map((d) => d.total) }],
          }}
          width={anchoChart}
          height={240}
          fromZero
          chartConfig={{
            backgroundColor: COLORS.surface,
            backgroundGradientFrom: COLORS.surface,
            backgroundGradientTo: COLORS.surface,
            decimalPlaces: 0,
            color: (opacity = 1) => `rgba(21, 101, 192, ${opacity})`,
            labelColor: () => COLORS.textSecondary,
            style: { borderRadius: BORDER_RADIUS.md },
            propsForLabels: { fontSize: 10 },
          }}
          yAxisLabel=""
          yAxisSuffix=""
          style={styles.chart}
        />
      </ScrollView>

      <View style={styles.tabla}>
        <View style={[styles.filaTabla, styles.filaCabecera]}>
          <Text style={[styles.celdaTexto, styles.celdaCabeceraTexto, { flex: 2 }]}>Técnico</Text>
          <Text style={[styles.celdaTexto, styles.celdaCabeceraTexto, styles.celdaNumero]}>Visitas</Text>
        </View>
        {datos.map((d) => (
          <View key={d.nombre} style={styles.filaTabla}>
            <Text style={[styles.celdaTexto, { flex: 2 }]}>{d.nombre}</Text>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>{d.total}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  vacio: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
  },
  chart: {
    borderRadius: BORDER_RADIUS.md,
  },
  tabla: {
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  filaTabla: {
    flexDirection: 'row',
    paddingVertical: SPACING.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  filaCabecera: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  celdaTexto: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  celdaCabeceraTexto: {
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    fontSize: FONTS.sizes.xs,
    textTransform: 'uppercase',
  },
  celdaNumero: {
    flex: 1,
    textAlign: 'right',
    fontWeight: FONTS.weights.medium,
  },
});

export default BarChartTecnicos;
