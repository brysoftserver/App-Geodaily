// ============================================================
// GEODAILY — Torta genérica de resultados de la Encuesta Social
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import { EncuestaChartSpec } from '../../utils/encuestaStats';

interface EncuestaPieChartProps {
  spec: EncuestaChartSpec;
}

const screenWidth = Dimensions.get('window').width;

const EncuestaPieChart: React.FC<EncuestaPieChartProps> = ({ spec }) => {
  const { titulo, datos, totalRespuestas, unidad } = spec;

  if (datos.length === 0 || totalRespuestas === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.vacio}>Aún no hay datos suficientes para esta pregunta.</Text>
      </View>
    );
  }

  const datosChart = datos.map((d) => ({
    name: d.etiqueta,
    population: d.valor,
    color: d.color,
    legendFontColor: COLORS.textSecondary,
    legendFontSize: 11,
  }));

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>{titulo}</Text>

      <PieChart
        data={datosChart}
        width={screenWidth - SPACING.lg * 2 - SPACING.md * 2}
        height={190}
        chartConfig={{ color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})` }}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="8"
        absolute
        hasLegend={false}
      />

      <View style={styles.tabla}>
        {datos.map((d) => (
          <View key={d.etiqueta} style={styles.filaTabla}>
            <View style={styles.celdaNombre}>
              <View style={[styles.puntoColor, { backgroundColor: d.color }]} />
              <Text style={styles.celdaTexto} numberOfLines={2}>{d.etiqueta}</Text>
            </View>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>
              {d.valor}{unidad ? ` ${unidad}` : ''}
            </Text>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>
              {totalRespuestas > 0 ? `${((d.valor / totalRespuestas) * 100).toFixed(0)}%` : '0%'}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.pieDeTabla}>
        {unidad ? `Total: ${totalRespuestas} ${unidad}` : `Base: ${totalRespuestas} respuestas`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    width: screenWidth - SPACING.lg * 2,
  },
  titulo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  vacio: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
  },
  tabla: {
    marginTop: SPACING.sm,
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
  celdaNombre: {
    flex: 2,
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
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    flexShrink: 1,
  },
  celdaNumero: {
    flex: 1,
    textAlign: 'right',
    fontWeight: FONTS.weights.medium,
  },
  pieDeTabla: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
    textAlign: 'right',
  },
});

export default EncuestaPieChart;
