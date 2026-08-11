// ============================================================
// GEODAILY — Barras genéricas de resultados de la Encuesta Social
// ============================================================
// A diferencia de BarChartTecnicos (que scrollea horizontalmente),
// estas barras viven dentro de un carrusel horizontal por sección
// (SeccionCarrusel) — un segundo scroll horizontal anidado generaría
// conflicto de gestos, así que el ancho es fijo (ancho de la tarjeta)
// y las categorías se limitan a las 10 más frecuentes + "Otras"
// (ya recortado en encuestaStats.ts). El desglose completo siempre
// queda legible en la tabla de abajo.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import { EncuestaChartSpec } from '../../utils/encuestaStats';
import { COLOR_BARRA_ACENTO, hexARgb } from '../../utils/chartPalette';

const { r: R_ACENTO, g: G_ACENTO, b: B_ACENTO } = hexARgb(COLOR_BARRA_ACENTO);

interface EncuestaBarChartProps {
  spec: EncuestaChartSpec;
}

const screenWidth = Dimensions.get('window').width;
const ANCHO_DISPONIBLE = screenWidth - SPACING.lg * 2 - SPACING.md * 2;

/** Etiqueta corta para el eje X — el nombre completo siempre está en la tabla de abajo. */
const etiquetaCorta = (texto: string): string => {
  const primera = texto.trim().split(/\s+/)[0] || texto;
  return primera.length > 8 ? `${primera.slice(0, 7)}…` : primera;
};

const EncuestaBarChart: React.FC<EncuestaBarChartProps> = ({ spec }) => {
  const { titulo, datos, totalRespuestas, unidad } = spec;

  if (datos.length === 0 || totalRespuestas === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.vacio}>Aún no hay datos suficientes para esta pregunta.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>{titulo}</Text>

      <BarChart
        data={{
          labels: datos.map((d) => etiquetaCorta(d.etiqueta)),
          datasets: [{ data: datos.map((d) => d.valor) }],
        }}
        width={ANCHO_DISPONIBLE}
        height={200}
        fromZero
        chartConfig={{
          backgroundColor: COLORS.surface,
          backgroundGradientFrom: COLORS.surface,
          backgroundGradientTo: COLORS.surface,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(${R_ACENTO}, ${G_ACENTO}, ${B_ACENTO}, ${opacity})`,
          labelColor: () => COLORS.textSecondary,
          style: { borderRadius: BORDER_RADIUS.md },
          propsForLabels: { fontSize: 8 },
        }}
        yAxisLabel=""
        yAxisSuffix=""
        showValuesOnTopOfBars
        style={styles.chart}
      />

      <ScrollView style={styles.tabla} nestedScrollEnabled>
        {datos.map((d) => (
          <View key={d.etiqueta} style={styles.filaTabla}>
            <Text style={styles.celdaTexto} numberOfLines={2}>{d.etiqueta}</Text>
            <Text style={[styles.celdaTexto, styles.celdaNumero]}>
              {d.valor}{unidad ? ` ${unidad}` : ''}
            </Text>
          </View>
        ))}
      </ScrollView>
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
  chart: {
    borderRadius: BORDER_RADIUS.md,
  },
  tabla: {
    marginTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    maxHeight: 160,
  },
  filaTabla: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  celdaTexto: {
    flex: 2,
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
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

export default EncuestaBarChart;
