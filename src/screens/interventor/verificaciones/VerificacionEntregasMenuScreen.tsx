// ============================================================
// GEODAILY — Verificación de Entregas: elegir el material
// ============================================================

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../../theme';
import { MATERIALES_VERIFICACION } from '../../../data/verificacionesEntrega';
import { avisar } from '../../../utils/dialogos';

const VerificacionEntregasMenuScreen: React.FC<any> = ({ navigation }) => (
  <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <Text style={styles.intro}>
      Registra la recepción y verificación del material vegetal que llega al punto de acopio. Funciona sin conexión.
    </Text>
    {MATERIALES_VERIFICACION.map((m) => (
      <TouchableOpacity
        key={m.id}
        style={[styles.card, !m.disponible && styles.cardPendiente]}
        activeOpacity={0.7}
        onPress={() =>
          m.disponible
            ? navigation.navigate('VerificacionMaterial', { material: m.id })
            : avisar('Formato pendiente', `El formato de ${m.nombreCorto} aún no está definido. Se habilitará cuando se cargue.`)
        }
      >
        <Text style={styles.icon}>{m.icono}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{m.titulo}</Text>
          {!m.disponible && <Text style={styles.pendiente}>Formato pendiente</Text>}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, gap: SPACING.sm },
  intro: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm, lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  cardPendiente: { opacity: 0.6 },
  icon: { fontSize: 28, marginRight: SPACING.md },
  title: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  pendiente: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.warning, marginTop: 2 },
  chevron: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
});

export default VerificacionEntregasMenuScreen;
