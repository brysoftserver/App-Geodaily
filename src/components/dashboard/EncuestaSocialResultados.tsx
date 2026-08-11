// ============================================================
// GEODAILY — Resultados de la Encuesta Social AgroAmbiental
// ============================================================
// Bloque de estadísticas del Formulario 1, para los dashboards de
// Supervisor, Interventor y Gerente. Una sección por bloque del
// formulario (Datos Generales → Componente Agroambiental), cada una
// como un carrusel horizontal de gráficas (torta o barras).
// ============================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario } from '../../types';
import { construirEstadisticasEncuesta, contarEncuestasSociales } from '../../utils/encuestaStats';
import SeccionCarrusel from './SeccionCarrusel';

interface EncuestaSocialResultadosProps {
  formularios: Formulario[];
}

const EncuestaSocialResultados: React.FC<EncuestaSocialResultadosProps> = ({ formularios }) => {
  const secciones = useMemo(() => construirEstadisticasEncuesta(formularios), [formularios]);
  const totalEncuestas = useMemo(() => contarEncuestasSociales(formularios), [formularios]);

  return (
    <View style={styles.contenedor}>
      <Text style={styles.titulo}>Resultados Encuesta Social AgroAmbiental</Text>
      <Text style={styles.subtitulo}>
        {totalEncuestas > 0
          ? `Estadísticas del Formulario 1 · ${totalEncuestas} encuesta${totalEncuestas === 1 ? '' : 's'} registrada${totalEncuestas === 1 ? '' : 's'}`
          : 'Formulario 1 · aún no hay encuestas registradas'}
      </Text>

      {totalEncuestas === 0 ? (
        <View style={styles.vacioCard}>
          <Text style={styles.vacioIcono}>📊</Text>
          <Text style={styles.vacioTexto}>
            Cuando los técnicos registren encuestas del Formulario 1, sus resultados se graficarán aquí
            automáticamente.
          </Text>
        </View>
      ) : (
        secciones.map((seccion) => <SeccionCarrusel key={seccion.id} seccion={seccion} />)
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  contenedor: {
    marginTop: SPACING.md,
  },
  titulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  vacioCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  vacioIcono: {
    fontSize: 36,
    marginBottom: SPACING.sm,
  },
  vacioTexto: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default EncuestaSocialResultados;
