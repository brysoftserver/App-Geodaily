// ============================================================
// GEODAILY — Verificación de un material: Nueva / Borradores / Completas
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../../theme';
import { useAuth } from '../../../store/AuthContext';
import { buscarMaterialVerificacion } from '../../../data/verificacionesEntrega';
import { getVerificacionesNoSincronizadas, listarVerificacionesLocales } from '../../../services/verificacionesEntrega.service';

const VerificacionMaterialScreen: React.FC<any> = ({ navigation, route }) => {
  const { user } = useAuth();
  const material = buscarMaterialVerificacion(route?.params?.material);
  const [borradores, setBorradores] = useState(0);
  const [completas, setCompletas] = useState(0);
  const [porSubir, setPorSubir] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: material?.nombreCorto ?? 'Verificación' });
  }, [navigation, material?.nombreCorto]);

  useFocusEffect(
    useCallback(() => {
      if (!material) return;
      (async () => {
        setBorradores((await listarVerificacionesLocales({ material: material.id, autorId: user?.id, completado: false })).length);
        setCompletas((await listarVerificacionesLocales({ material: material.id, autorId: user?.id, completado: true })).length);
        setPorSubir((await getVerificacionesNoSincronizadas()).filter((v) => v.material === material.id && v.autor_id === user?.id).length);
      })();
    }, [material, user?.id])
  );

  if (!material) return <View style={styles.container} />;

  const tarjeta = (icono: string, titulo: string, subtitulo: string, onPress: () => void, badge?: number) => (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <Text style={styles.icon}>{icono}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{titulo}</Text>
        <Text style={styles.subtitle}>{subtitulo}</Text>
      </View>
      {badge ? <View style={styles.badge}><Text style={styles.badgeTxt}>{badge}</Text></View> : null}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.formato}>{material.titulo}</Text>
      {tarjeta('📝', 'Nueva Verificación', 'Formulario en blanco', () => navigation.navigate('VerificacionForm', { material: material.id }))}
      {tarjeta('🗂️', 'Borradores', borradores ? `${borradores} sin completar — retómalos aquí` : 'Verificaciones sin completar', () =>
        navigation.navigate('VerificacionLista', { material: material.id, tipo: 'borradores' }), borradores)}
      {tarjeta('✅', 'Verificaciones Completas', completas ? `${completas} completada(s)` : 'Las verificaciones que completaste', () =>
        navigation.navigate('VerificacionLista', { material: material.id, tipo: 'completas' }))}
      {porSubir > 0 && (
        <Text style={styles.aviso}>📴 {porSubir} verificación(es) completada(s) pendiente(s) de subir: se suben solas cuando haya señal.</Text>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, gap: SPACING.sm },
  formato: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.roleInterventor, marginBottom: SPACING.sm },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  icon: { fontSize: 26, marginRight: SPACING.md },
  title: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  badge: { backgroundColor: COLORS.warning, borderRadius: 12, minWidth: 24, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center', marginLeft: SPACING.sm },
  badgeTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.xs },
  chevron: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  aviso: { fontSize: FONTS.sizes.sm, color: COLORS.warning, marginTop: SPACING.sm },
});

export default VerificacionMaterialScreen;
