// ============================================================
// GEODAILY — Listado de actividades
// Técnico: "Listado de Actividades" (Realizar …).
// Roles superiores: "Revisión de Actividades" (Revisar …).
// ============================================================

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { obtenerAvanceSuelos } from '../services/analisisSuelos.service';
import { formatearHectareas, obtenerAvanceHectareas } from '../services/actividadesHectareas.service';
import { ACTIVIDADES, ACTIVIDADES_CONECTADAS, ModoActividades, verboActividad } from '../data/actividades';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const ActividadesListScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const modo: ModoActividades = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const verbo = verboActividad(modo);

  // Valor actual por actividad. Las que aún no registran avance quedan en 0;
  // sin conexión se muestra 0 en vez de bloquear la lista.
  const [avance, setAvance] = useState<Record<string, number>>({});
  // Mientras llega el avance se muestra "…" en vez de un 0 que parecería real.
  const [cargado, setCargado] = useState(false);
  const cargarAvance = useCallback(
    () =>
      Promise.allSettled([
        obtenerAvanceSuelos().then((total) => setAvance((a) => ({ ...a, analisis_suelos: total }))),
        obtenerAvanceHectareas().then((porActividad) => setAvance((a) => ({ ...a, ...porActividad }))),
      ]).then(() => setCargado(true)),
    []
  );
  useFocusEffect(
    useCallback(() => {
      cargarAvance();
    }, [cargarAvance])
  );
  // Recarga automática del avance (volver a la app/pestaña, red, periódica).
  useAutoRefresh(cargarAvance);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}
    >
      {ACTIVIDADES.map((actividad) => (
        <TouchableOpacity
          key={actividad.id}
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ActividadDetalle', { actividadId: actividad.id, modo })}
        >
          <Text style={styles.icon}>{actividad.icon}</Text>
          <Text style={styles.title}>{`${verbo} ${actividad.nombre}`}</Text>
          {actividad.meta !== undefined && (
            <View style={styles.derecha}>
              <Text style={[styles.valor, !ACTIVIDADES_CONECTADAS.includes(actividad.id) && styles.valorPendiente]}>
                {`${cargado ? formatearHectareas(avance[actividad.id] ?? 0) : '…'}/${actividad.meta} ${actividad.unidad}`}
              </Text>
              {!ACTIVIDADES_CONECTADAS.includes(actividad.id) && <Text style={styles.pendiente}>Pendiente</Text>}
            </View>
          )}
          {actividad.meta === undefined && !ACTIVIDADES_CONECTADAS.includes(actividad.id) && (
            <Text style={styles.pendiente}>Pendiente</Text>
          )}
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, gap: SPACING.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    ...SHADOWS.sm,
  },
  icon: { fontSize: 28, marginRight: SPACING.md },
  title: {
    flex: 1,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  derecha: { alignItems: 'flex-end' },
  valorPendiente: { color: COLORS.textLight },
  pendiente: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.warning, marginLeft: SPACING.sm },
  valor: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginLeft: SPACING.sm,
  },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
});

export default ActividadesListScreen;
