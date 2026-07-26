// ============================================================
// GEODAILY — Visitas por corregimiento (torta + tabla)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

export interface ConteoCorregimiento {
  nombre: string;
  total: number;
  color: string;
}

interface PieChartCorregimientosProps {
  datos: ConteoCorregimiento[];
}

const screenWidth = Dimensions.get('window').width;

const PieChartCorregimientos: React.FC<PieChartCorregimientosProps> = ({ datos }) => {
  const total = datos.reduce((acc, d) => acc + d.total, 0);

  if (total === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.titulo}>Visitas por corregimiento</Text>
        <Text style={styles.vacio}>Aún no hay visitas registradas por corregimiento.</Text>
      </View>
    );
  }

  const datosChart = datos
    .filter((d) => d.total > 0)
    .map((d) => ({
      name: d.nombre,
      population: d.total,
      color: d.color,
      legendFontColor: COLORS.textSecondary,
      legendFontSize: 11,
    }));

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>Visitas por corregimiento</Text>
      <Text style={styles.subtitulo}>Distribución del total de visitas entre los 6 corregimientos</Text>

      <PieChart
        data={datosChart}
        width={screenWidth - SPACING.lg * 2 - SPACING.md * 2}
        height={200}
        chartConfig={{
          color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
        }}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="8"
        absolute
      />

      <View style={styles.tabla}>
        <View style={[styles.filaTabla, styles.filaCabecera]}>
          <Text style={[styles.celdaTexto, styles.celdaCabeceraTexto, { flex: 2 }]}>Corregimiento</Text>
          <Text style={[styles.celdaTexto, styles.celdaCabeceraTexto, styles.celdaNumero]}>Visitas</Text>
          <Text style={[styles.celdaTexto, styles.celdaCabeceraTexto, styles.celdaNumero]}>%</Text>
        </View>
        {datos.map((d) => (
          <View key={d.nombre} style={styles.filaTabla}>
            <View style={[styles.celdaNombre, { flex: 2 }]}>
              <View style={[styles.puntoColor, { backgroundColor: d.color }]} />
              <Text style={styles.celdaTexto}>{d.nombre}</Text>
            </View>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>{d.total}</Text>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>
              {total > 0 ? `${((d.total / total) * 100).toFixed(0)}%` : '0%'}
            </Text>
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
  tabla: {
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  filaTabla: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  filaCabecera: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  celdaNombre: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  puntoColor: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: SPACING.xs,
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

export default PieChartCorregimientos;
