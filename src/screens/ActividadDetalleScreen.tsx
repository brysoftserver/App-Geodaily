// ============================================================
// GEODAILY — Detalle de una actividad 
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { buscarActividad, ModoActividades, verboActividad } from '../data/actividades';
import { COLORS, FONTS, SPACING } from '../theme';
import AnalisisSuelosScreen from './actividades/AnalisisSuelosScreen';
import HectareasActividadScreen from './actividades/HectareasActividadScreen';
import AsistenciaTecnicaScreen from './actividades/AsistenciaTecnicaScreen';
import FortalecimientoScreen from './actividades/FortalecimientoScreen';
import { ACTIVIDADES_EN_HECTAREAS } from '../data/actividades';

const ActividadDetalleScreen: React.FC<any> = (props) => {
  const { route } = props;
  if (route?.params?.actividadId === 'analisis_suelos') return <AnalisisSuelosScreen {...props} />;
  if (route?.params?.actividadId === 'asistencia_tecnica') return <AsistenciaTecnicaScreen {...props} />;
  if (route?.params?.actividadId === 'fortalecimiento_capacidades') return <FortalecimientoScreen {...props} />;
  if (ACTIVIDADES_EN_HECTAREAS.includes(route?.params?.actividadId)) return <HectareasActividadScreen {...props} />;

  const modo: ModoActividades = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const actividad = buscarActividad(route?.params?.actividadId);

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{actividad?.icon ?? '📋'}</Text>
      <Text style={styles.title}>
        {actividad ? `${verboActividad(modo)} ${actividad.nombre}` : 'Actividad'}
      </Text>
      <Text style={styles.subtitle}>Pendiente de los futuros formularios y visitas</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  icon: { fontSize: 56, marginBottom: SPACING.md },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  subtitle: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, marginTop: SPACING.sm },
});

export default ActividadDetalleScreen;
