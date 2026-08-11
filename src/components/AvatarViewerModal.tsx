// ============================================================
// GEODAILY — Visor de foto de perfil (ver grande / cambiar / quitar)
// ============================================================
// Estilo WhatsApp: tocar el avatar del menú abre este modal con la foto
// grande, y desde aquí se puede cambiar o quitar. Compartido por las 5
// pantallas de menú (técnico, supervisor, interventor, gerente, admin).
// ============================================================

import React from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

interface AvatarViewerModalProps {
  visible: boolean;
  avatarUri: string | null;
  nombre?: string;
  cambiando: boolean;
  onClose: () => void;
  onCambiar: () => void;
  onQuitar: () => void;
}

const AvatarViewerModal: React.FC<AvatarViewerModalProps> = ({
  visible,
  avatarUri,
  nombre,
  cambiando,
  onClose,
  onCambiar,
  onQuitar,
}) => {
  const confirmarQuitar = () => {
    Alert.alert('Quitar foto de perfil', '¿Quitar tu foto de perfil actual?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: onQuitar },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.contenido} onPress={() => {}}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.fotoGrande} />
          ) : (
            <View style={[styles.fotoGrande, styles.sinFoto]}>
              <Text style={styles.inicial}>{nombre?.charAt(0)?.toUpperCase() || '?'}</Text>
            </View>
          )}

          <View style={styles.botones}>
            <TouchableOpacity style={styles.boton} disabled={cambiando} onPress={onCambiar}>
              {cambiando ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.botonTexto}>📷 {avatarUri ? 'Cambiar foto' : 'Agregar foto'}</Text>
              )}
            </TouchableOpacity>

            {avatarUri && (
              <TouchableOpacity style={styles.boton} disabled={cambiando} onPress={confirmarQuitar}>
                <Text style={styles.botonQuitarTexto}>🗑 Quitar foto</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.boton} onPress={onClose}>
              <Text style={styles.botonTexto}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  contenido: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  fotoGrande: {
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: COLORS.surface,
  },
  sinFoto: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  inicial: {
    fontSize: 96,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textSecondary,
  },
  botones: {
    marginTop: SPACING.xl,
    width: '100%',
    gap: SPACING.sm,
  },
  boton: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  botonTexto: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  botonQuitarTexto: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.error,
  },
});

export default AvatarViewerModal;
