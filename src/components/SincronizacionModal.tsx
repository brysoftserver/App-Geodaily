// ============================================================
// GEODAILY — Modal de Sincronización
// ============================================================
// Antes vivía como una tarjeta grande fija en el menú del técnico; ahora
// se abre desde el menú de ajustes (⚙️) para no ocupar espacio permanente.

import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';

interface SincronizacionModalProps {
  visible: boolean;
  onClose: () => void;
}

const SincronizacionModal: React.FC<SincronizacionModalProps> = ({ visible, onClose }) => {
  const { syncNow, status, pendingCount, lastSync } = useOfflineSync();
  const isSyncing = status === 'syncing';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{isSyncing ? '🔄 Sincronizando...' : '📤 Sincronización'}</Text>
            {pendingCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.subtitle}>
            {pendingCount === 0 ? '✅ Todo sincronizado' : `⏳ ${pendingCount} registro(s) pendiente(s)`}
          </Text>
          {lastSync && (
            <Text style={styles.last}>Última sincronización: {new Date(lastSync).toLocaleString('es-CO')}</Text>
          )}
          {status === 'error' && <Text style={styles.error}>Error al sincronizar. Reintentando...</Text>}

          <TouchableOpacity
            style={[styles.button, isSyncing && styles.buttonDisabled]}
            onPress={syncNow}
            disabled={isSyncing}
            activeOpacity={0.7}
          >
            {isSyncing ? (
              <ActivityIndicator color={COLORS.textOnPrimary} size="small" />
            ) : (
              <Text style={styles.buttonText}>{pendingCount > 0 ? 'Sincronizar ahora' : 'Verificar'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  badge: {
    backgroundColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.full,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  last: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 4,
  },
  error: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: 4,
  },
  button: {
    backgroundColor: COLORS.info,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
  },
  closeButton: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  closeButtonText: {
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
});

export default SincronizacionModal;
