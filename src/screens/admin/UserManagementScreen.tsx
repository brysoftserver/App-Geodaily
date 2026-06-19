// ============================================================
// GEODAILY — Gestión de Usuarios (Admin)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

const MOCK_USERS = [
  {
    id: 'tec-001',
    nombre: 'Carlos Martínez',
    usuario: 'tecnico1',
    rol: 'Técnico de Campo',
    email: 'carlos@geodaily.app',
    telefono: '3151234567',
    estado: 'Activo',
    color: COLORS.roleTecnico,
  },
  {
    id: 'sup-001',
    nombre: 'María Gómez',
    usuario: 'supervisor1',
    rol: 'Supervisor',
    email: 'maria@geodaily.app',
    telefono: '3157654321',
    estado: 'Activo',
    color: COLORS.roleSupervisor,
  },
  {
    id: 'adm-001',
    nombre: 'Admin GEODAILY',
    usuario: 'admin1',
    rol: 'Administrador',
    email: 'admin@geodaily.app',
    telefono: '3109876543',
    estado: 'Activo',
    color: COLORS.roleAdmin,
  },
];

const UserManagementScreen: React.FC = () => {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>Usuarios Registrados</Text>
      <Text style={styles.sectionSubtitle}>
        Gestión de roles, permisos y cuentas del sistema
      </Text>

      {MOCK_USERS.map((user) => (
        <View key={user.id} style={styles.userCard}>
          <View style={styles.userHeader}>
            <View style={[styles.avatar, { backgroundColor: user.color }]}>
              <Text style={styles.avatarText}>
                {user.nombre.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{user.nombre}</Text>
              <Text style={styles.userUsername}>@{user.usuario}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: user.color + '20' }]}>
              <Text style={[styles.statusText, { color: user.color }]}>
                {user.estado}
              </Text>
            </View>
          </View>
          <View style={styles.userDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Rol</Text>
              <Text style={styles.detailValue}>{user.rol}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Email</Text>
              <Text style={styles.detailValue}>{user.email}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Teléfono</Text>
              <Text style={styles.detailValue}>{user.telefono}</Text>
            </View>
          </View>
        </View>
      ))}

      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>🔧</Text>
        <Text style={styles.placeholderTitle}>Gestión de Roles</Text>
        <Text style={styles.placeholderText}>
          La funcionalidad completa de creación, edición y asignación de roles estará
          disponible en la versión web de la consola administrativa.
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
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  userUsername: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  userDetails: {
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    paddingTop: SPACING.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  detailLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  placeholder: {
    marginTop: SPACING.lg,
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

export default UserManagementScreen;
