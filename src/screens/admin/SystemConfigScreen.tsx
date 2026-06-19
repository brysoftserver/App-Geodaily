// ============================================================
// GEODAILY — Configuración del Sistema (Admin)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

const CONFIG_ITEMS = [
  {
    id: 'version',
    title: 'Versión de la App',
    value: 'GEODAILY v1.0.0',
    icon: '📱',
  },
  {
    id: 'api',
    title: 'API Backend',
    value: 'http://localhost:8089/api',
    icon: '🔌',
  },
  {
    id: 'qgis',
    title: 'Servidor QGIS',
    value: 'http://localhost:8081',
    icon: '🗺️',
  },
  {
    id: 'database',
    title: 'Base de Datos',
    value: 'PostgreSQL / PostGIS',
    icon: '🗄️',
  },
  {
    id: 'auth',
    title: 'Autenticación',
    value: 'JWT (bcrypt + jsonwebtoken)',
    icon: '🔐',
  },
];

const SystemConfigScreen: React.FC = () => {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>Configuración del Sistema</Text>
      <Text style={styles.sectionSubtitle}>
        Parámetros generales, estado de servicios y opciones de auditoría
      </Text>

      {/* Estado de servicios */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Estado de Servicios</Text>
        {CONFIG_ITEMS.map((item) => (
          <View key={item.id} style={styles.configRow}>
            <Text style={styles.configIcon}>{item.icon}</Text>
            <View style={styles.configContent}>
              <Text style={styles.configLabel}>{item.title}</Text>
              <Text style={styles.configValue}>{item.value}</Text>
            </View>
            <View style={styles.dotActive} />
          </View>
        ))}
      </View>

      {/* Auditoría */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Registro de Auditoría</Text>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>📋</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Inicios de sesión</Text>
            <Text style={styles.auditText}>12 intentos hoy · 3 administradores activos</Text>
          </View>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>📄</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Formularios generados</Text>
            <Text style={styles.auditText}>48 formularios en la última semana</Text>
          </View>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>🔄</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Sincronización QGIS</Text>
            <Text style={styles.auditText}>Ultima sincronización: hoy 10:30 AM</Text>
          </View>
        </View>
      </View>

      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>📊</Text>
        <Text style={styles.placeholderTitle}>Panel de Auditoría</Text>
        <Text style={styles.placeholderText}>
          Los reportes detallados de auditoría, respaldos y configuración avanzada
          estarán disponibles en el panel web de administración.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  configIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  configContent: {
    flex: 1,
  },
  configLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  configValue: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  dotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
    marginLeft: SPACING.sm,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  auditIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
    marginTop: 2,
  },
  auditContent: {
    flex: 1,
  },
  auditTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  auditText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  placeholder: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 40,
    marginBottom: SPACING.sm,
  },
  placeholderTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  placeholderText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default SystemConfigScreen;
