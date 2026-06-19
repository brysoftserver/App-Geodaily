// ============================================================
// GEODAILY — Menú Principal de Supervisión
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';

type SupervisionMenuScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const MENU_ITEMS = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Métricas y estadísticas generales',
    icon: '📊',
    color: COLORS.info,
    screen: 'Dashboard',
  },
  {
    id: 'listado',
    title: 'Listado de Visitas',
    subtitle: 'Todos los formularios registrados',
    icon: '📋',
    color: COLORS.primary,
    screen: 'SupervisionFormularioList',
  },
  {
    id: 'calendario',
    title: 'Calendario',
    subtitle: 'Vista general del cronograma',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'SupervisionCalendario',
  },
];

const SupervisionMenuScreen: React.FC<SupervisionMenuScreenProps> = ({ navigation }) => {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header de usuario */}
      <View style={styles.userHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.nombre?.charAt(0)?.toUpperCase() || 'S'}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.nombre || 'Supervisor'}</Text>
          <Text style={styles.userRole}>Supervisor a Terreno</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Menú */}
      <View style={styles.menuGrid}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.menuCard}
            onPress={() => navigation.navigate(item.screen)}
          >
            <View style={[styles.menuIconContainer, { backgroundColor: item.color + '15' }]}>
              <Text style={styles.menuIcon}>{item.icon}</Text>
            </View>
            <Text style={styles.menuTitle}>{item.title}</Text>
            <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>
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
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    ...SHADOWS.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  userRole: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  logoutButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  logoutText: {
    color: COLORS.error,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
  },
  menuGrid: {
    gap: SPACING.md,
  },
  menuCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  menuIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  menuIcon: {
    fontSize: 28,
  },
  menuTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  menuSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
});

export default SupervisionMenuScreen;
