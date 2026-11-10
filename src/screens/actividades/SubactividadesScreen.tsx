// ============================================================
// GEODAILY — Subactividades de una actividad (técnico)
// ============================================================
// Ej.: Realizar Siembra de Plátano → Entrega de Colinos, Trazado/Ahoyado/
// Encalado, Siembra de los Colinos, Fertilización. Las que aún no tienen
// pantalla se muestran como "Pendiente".
// ============================================================

import React, { useLayoutEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { buscarActividad, SUBACTIVIDADES, verboActividad } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';

const SubactividadesScreen: React.FC<any> = ({ navigation, route }) => {
  const actividadId: string = route?.params?.actividadId;
  const actividad = buscarActividad(actividadId);
  const subs = SUBACTIVIDADES[actividadId] ?? [];

  useLayoutEffect(() => {
    navigation.setOptions({ title: actividad ? `${verboActividad('ejecutar')} ${actividad.nombre}` : 'Actividad' });
  }, [navigation, actividad]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {subs.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.card, !s.pantalla && styles.cardPendiente]}
          activeOpacity={0.7}
          onPress={() =>
            s.pantalla
              ? navigation.navigate(s.pantalla, { actividadId, subactividadId: s.id })
              : avisar('Pendiente', `"${s.nombre}" se habilitará próximamente.`)
          }
        >
          <Text style={styles.icon}>{s.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{s.nombre}</Text>
            {!s.pantalla && <Text style={styles.pendiente}>Pendiente</Text>}
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, gap: SPACING.sm },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  cardPendiente: { opacity: 0.6 },
  icon: { fontSize: 28, marginRight: SPACING.md },
  title: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  pendiente: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.warning, marginTop: 2 },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
});

export default SubactividadesScreen;
