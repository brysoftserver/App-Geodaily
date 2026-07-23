// ============================================================
// GEODAILY — Menú Principal Técnico de Campo
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../store/AuthContext';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAvatar } from '../../hooks/useAvatar';
import CambiarContrasenaModal from '../../components/CambiarContrasenaModal';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type TerrenoMenuProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const MENU_ITEMS = [
  {
    id: 'beneficiarios',
    title: 'Listado de Beneficiarios',
    subtitle: 'Selecciona un beneficiario y diligencia su formulario',
    icon: '👥',
    color: COLORS.secondary,
    screen: 'BeneficiariosList',
  },
  {
    id: 'mapa',
    title: 'Mapa y Ubicación',
    subtitle: 'Mapa interactivo con GPS y mediciones',
    icon: '🗺️',
    color: COLORS.success,
    screen: 'TerrenoMapa',
  },
  {
    id: 'listado',
    title: 'Listado de Formularios',
    subtitle: 'Historial y PDFs generados',
    icon: '📄',
    color: COLORS.info,
    screen: 'TerrenoFormularioList',
  },
  {
    id: 'calendario',
    title: 'Calendario',
    subtitle: 'Visitas realizadas y pendientes',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'TerrenoCalendario',
  },
  {
    id: 'capacitacion',
    title: 'Capacitaciones',
    subtitle: 'Guias y material de formación',
    icon: '📚',
    color: COLORS.info,
    screen: 'TerrenoCapacitacion',
  },
  // cerrar se renderiza por separado (después del panel de sincronización)
];

const TerrenoMenuScreen: React.FC<TerrenoMenuProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { avatarUri, cambiarAvatar, cambiando } = useAvatar(user?.id);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handlePress = (item: (typeof MENU_ITEMS)[0]) => {
    navigation.navigate(item.screen as string);
  };

  // Obtener cédula del usuario
  const cedula = (user as any)?.cedula || '';

  const { syncNow, status, pendingCount, lastSync } = useOfflineSync();
  const isSyncing = status === 'syncing';

  return (
    // El fondo cubre TODA la pantalla (encabezado + submódulos), no solo el
    // encabezado como antes. Al ir en el contenedor exterior (no dentro del
    // ScrollView) queda fijo mientras el contenido se desplaza encima.
    <ImageBackground
      source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlayOscuro} pointerEvents="none" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SPACING.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Encabezado — ya no lleva su propio fondo, ahora se ve el de toda la pantalla */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.xxl) }]}>
          <TouchableOpacity onPress={cambiarAvatar} activeOpacity={0.7} disabled={cambiando}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>
                  {user?.nombre?.charAt(0)?.toUpperCase() || 'U'}
                </Text>
              )}
              <View style={styles.cameraIcon}>
                {cambiando ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Text style={styles.cameraIconText}>📷</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.welcomeText}>Bienvenido,</Text>
          <Text style={styles.userName}>{user?.nombre || 'Usuario'}</Text>
          {cedula ? (
            <Text style={styles.userCedula}>C.C. {cedula}</Text>
          ) : null}
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>Técnico de Campo</Text>
          </View>
        </View>

        {/* Menú — tarjetas blancas para contraste sobre el fondo */}
        <View style={styles.menuContainer}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.menuItem, { borderLeftColor: item.color }]}
              onPress={() => handlePress(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <View style={styles.menuContent}>
                <Text style={styles.menuTitle}>{item.title}</Text>
                <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Estado de sincronización */}
        <View style={styles.syncCard}>
          <View style={styles.syncHeader}>
            <Text style={styles.syncTitle}>
              {isSyncing ? '🔄 Sincronizando...' : '📤 Sincronización'}
            </Text>
            {pendingCount > 0 && (
              <View style={styles.pendingSyncBadge}>
                <Text style={styles.pendingSyncText}>{pendingCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.syncSubtitle}>
            {pendingCount === 0
              ? '✅ Todo sincronizado'
              : `⏳ ${pendingCount} registro(s) pendiente(s)`}
          </Text>
          {lastSync && (
            <Text style={styles.syncLast}>
              Última sincronización: {new Date(lastSync).toLocaleString('es-CO')}
            </Text>
          )}
          {status === 'error' && (
            <Text style={styles.syncError}>Error al sincronizar. Reintentando...</Text>
          )}
          <TouchableOpacity
            style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
            onPress={syncNow}
            disabled={isSyncing}
            activeOpacity={0.7}
          >
            {isSyncing ? (
              <ActivityIndicator color={COLORS.textOnPrimary} size="small" />
            ) : (
              <Text style={styles.syncButtonText}>
                {pendingCount > 0 ? 'Sincronizar ahora' : 'Verificar'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Cambiar Contraseña */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => setShowPasswordModal(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.menuIcon}>🔑</Text>
          <View style={styles.menuContent}>
            <Text style={styles.menuTitle}>Cambiar Contraseña</Text>
            <Text style={styles.menuSubtitle}>Actualizar tu contraseña de acceso</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        {/* Cerrar Sesión */}
        <TouchableOpacity
          style={[styles.menuItem, styles.logoutItem]}
          onPress={logout}
          activeOpacity={0.7}
        >
          <Text style={styles.menuIcon}>🚪</Text>
          <View style={styles.menuContent}>
            <Text style={styles.menuTitle}>Cerrar Sesión</Text>
            <Text style={styles.menuSubtitle}>Salir de la aplicación</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
      <CambiarContrasenaModal visible={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Vela suave sobre el fondo para que el texto blanco del encabezado siga
  // siendo legible ahora que la imagen se ve detrás de toda la pantalla,
  // no solo detrás de una franja superior más controlada.
  overlayOscuro: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },
  header: {
    padding: SPACING.lg,
    paddingTop: SPACING.xxl,
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    ...SHADOWS.md,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  cameraIcon: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  cameraIconText: {
    fontSize: 12,
  },
  userCedula: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textOnPrimary + 'BB',
    fontWeight: FONTS.weights.medium,
    marginTop: 2,
  },
  avatarText: {
    fontSize: FONTS.sizes.title,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnSecondary,
  },
  welcomeText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textOnPrimary + 'CC',
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  roleBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    marginTop: SPACING.sm,
  },
  roleText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
  menuContainer: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  menuIcon: {
    fontSize: 28,
    marginRight: SPACING.md,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  menuSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  menuArrow: {
    fontSize: 24,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
  },
  logoutItem: {
    borderLeftColor: COLORS.error,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
  },

  // --- Sincronización ---
  syncCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  pendingSyncBadge: {
    backgroundColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.full,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingSyncText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
  },
  syncSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  syncLast: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 4,
  },
  syncError: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: 4,
  },
  syncButton: {
    backgroundColor: COLORS.info,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
  },
});

export default TerrenoMenuScreen;
