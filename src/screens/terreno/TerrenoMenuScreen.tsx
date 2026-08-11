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
import { useAvatar } from '../../hooks/useAvatar';
import CambiarContrasenaModal from '../../components/CambiarContrasenaModal';
import SincronizacionModal from '../../components/SincronizacionModal';
import AjustesMenu from '../../components/AjustesMenu';
import NotificacionBell from '../../components/NotificacionBell';
import AvatarViewerModal from '../../components/AvatarViewerModal';
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
  const { avatarUri, cambiarAvatar, quitarAvatar, cambiando } = useAvatar();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showAvatarViewer, setShowAvatarViewer] = useState(false);

  const handlePress = (item: (typeof MENU_ITEMS)[0]) => {
    navigation.navigate(item.screen as string);
  };

  // Obtener cédula del usuario
  const cedula = (user as any)?.cedula || '';

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
          <View style={[styles.campanaWrapper, { top: Math.max(insets.top, SPACING.md) }]}>
            <NotificacionBell navigation={navigation} formularioDetailScreen="FormularioDetail" />
          </View>
          <View style={[styles.ajustesWrapper, { top: Math.max(insets.top, SPACING.md) }]}>
            <AjustesMenu
              opciones={[
                { id: 'sync', label: 'Sincronización', icon: '📤', onPress: () => setShowSyncModal(true) },
                { id: 'contrasena', label: 'Cambiar Contraseña', icon: '🔑', onPress: () => setShowPasswordModal(true) },
                { id: 'cerrar', label: 'Cerrar Sesión', icon: '🚪', onPress: logout, destructivo: true },
              ]}
            />
          </View>
          <TouchableOpacity onPress={() => setShowAvatarViewer(true)} activeOpacity={0.7} disabled={cambiando}>
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

      </ScrollView>
      <CambiarContrasenaModal visible={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
      <SincronizacionModal visible={showSyncModal} onClose={() => setShowSyncModal(false)} />
      <AvatarViewerModal
        visible={showAvatarViewer}
        avatarUri={avatarUri}
        nombre={user?.nombre}
        cambiando={cambiando}
        onClose={() => setShowAvatarViewer(false)}
        onCambiar={cambiarAvatar}
        onQuitar={quitarAvatar}
      />
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
  ajustesWrapper: {
    position: 'absolute',
    right: SPACING.md,
    zIndex: 1,
  },
  campanaWrapper: {
    position: 'absolute',
    left: SPACING.md,
    zIndex: 1,
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
});

export default TerrenoMenuScreen;
