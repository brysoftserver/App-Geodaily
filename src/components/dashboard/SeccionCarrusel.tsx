// ============================================================
// GEODAILY — Carrusel horizontal paginado de gráficas por sección
// ============================================================
// Cabecera de sección + una tarjeta por pregunta, deslizable de
// izquierda a derecha, con puntos de paginación debajo (uno por
// gráfica) que indican cuál tarjeta está activa.
// ============================================================

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { EncuestaSeccionStats } from '../../utils/encuestaStats';
import EncuestaPieChart from './EncuestaPieChart';
import EncuestaBarChart from './EncuestaBarChart';

interface SeccionCarruselProps {
  seccion: EncuestaSeccionStats;
}

const screenWidth = Dimensions.get('window').width;
const ANCHO_PAGINA = screenWidth - SPACING.lg * 2;

const SeccionCarrusel: React.FC<SeccionCarruselProps> = ({ seccion }) => {
  const [indiceActivo, setIndiceActivo] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.x;
    const indice = Math.round(offset / ANCHO_PAGINA);
    setIndiceActivo(indice);
  }, []);

  if (seccion.graficas.length === 0) return null;

  return (
    <View style={styles.contenedor}>
      <View style={styles.header}>
        <View style={[styles.iconoContainer, { backgroundColor: seccion.color + '15' }]}>
          <Text style={styles.icono}>{seccion.icono}</Text>
        </View>
        <Text style={[styles.titulo, { color: seccion.color }]}>{seccion.titulo}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        decelerationRate="fast"
        snapToInterval={ANCHO_PAGINA}
        snapToAlignment="start"
      >
        {seccion.graficas.map((spec) => (
          <View key={spec.id} style={{ width: ANCHO_PAGINA }}>
            {spec.tipo === 'pie' ? <EncuestaPieChart spec={spec} /> : <EncuestaBarChart spec={spec} />}
          </View>
        ))}
      </ScrollView>

      {seccion.graficas.length > 1 && (
        <View style={styles.puntos}>
          {seccion.graficas.map((spec, i) => (
            <View
              key={spec.id}
              style={[
                styles.punto,
                i === indiceActivo ? { backgroundColor: seccion.color, width: 16 } : styles.puntoInactivo,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  contenedor: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    ...SHADOWS.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  iconoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  icono: {
    fontSize: 16,
  },
  titulo: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    flexShrink: 1,
  },
  puntos: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: 6,
  },
  punto: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  puntoInactivo: {
    backgroundColor: COLORS.border,
  },
});

export default SeccionCarrusel;
