// ============================================================
// GEODAILY — Submenú de Seguimiento (Coordinación / Interventoría)
// ============================================================
// Card compartida entre coordinador e interventor: cada uno ve su propio
// rol reflejado en el título y en el membrete del PDF, pero la pantalla
// y la lógica son las mismas (mismo patrón que BaseDatosBeneficiariosScreen).
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { getSeguimientosIncompletos } from '../../services/database';
import SincronizacionModal from '../../components/SincronizacionModal';

type SeguimientoMenuScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const SeguimientoMenuScreen: React.FC<SeguimientoMenuScreenProps> = ({ navigation }) => {
  const { isInterventor, user } = useAuth();
  const rolColor = isInterventor ? COLORS.roleInterventor : COLORS.roleCoordinador;
  const rolLabel = isInterventor ? 'Interventoría' : 'Coordinación';
  const [incompletos, setIncompletos] = useState(0);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const cargarIncompletos = useCallback(async () => {
    const borradores = await getSeguimientosIncompletos(user?.id);
    setIncompletos(borradores.length);
  }, [user?.id]);

  useEffect(() => {
    cargarIncompletos();
    const unsubscribe = navigation.addListener('focus', cargarIncompletos);
    return unsubscribe;
  }, [navigation, cargarIncompletos]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerSubtitle}>
        Registra tu acompañamiento en campo como {rolLabel}, sin depender de que el técnico
        haya terminado su propio formulario.
      </Text>

      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('SeguimientoForm')}
      >
        <View style={[styles.iconContainer, { backgroundColor: rolColor + '15' }]}>
          <Text style={styles.icon}>📝</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Realizar Seguimiento</Text>
          <Text style={styles.cardSubtitle}>Registrar actividad, objetivo, descripción y evidencias</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('SeguimientoList')}
      >
        <View style={[styles.iconContainer, { backgroundColor: rolColor + '15' }]}>
          <Text style={styles.icon}>📋</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Listado de seguimientos realizados</Text>
          <Text style={styles.cardSubtitle}>Historial y exportación en PDF</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('SeguimientoIncompletos')}
      >
        <View style={[styles.iconContainer, { backgroundColor: COLORS.warning + '15' }]}>
          <Text style={styles.icon}>📝</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Seguimientos Incompletos</Text>
          <Text style={styles.cardSubtitle}>
            {incompletos > 0 ? `${incompletos} borrador(es) sin terminar` : 'Borradores autoguardados sin terminar'}
          </Text>
        </View>
        {incompletos > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{incompletos}</Text>
          </View>
        )}
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => setShowSyncModal(true)}
      >
        <View style={[styles.iconContainer, { backgroundColor: COLORS.info + '15' }]}>
          <Text style={styles.icon}>🔄</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>Sincronizar ahora</Text>
          <Text style={styles.cardSubtitle}>Subir al servidor los seguimientos pendientes</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <SincronizacionModal visible={showSyncModal} onClose={() => setShowSyncModal(false)} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
  },
  headerSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  icon: {
    fontSize: 26,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  chevron: {
    fontSize: 24,
    color: COLORS.textSecondary,
  },
  badge: {
    backgroundColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.full,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.xs,
  },
  badgeText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
  },
});

export default SeguimientoMenuScreen;
