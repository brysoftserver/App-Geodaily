// ============================================================
// GEODAILY — Menú de ajustes (botón de tuerca + desplegable)
// ============================================================
// Botón compacto (⚙️) para colocar en la esquina superior de cualquier
// pantalla de menú de rol. Al tocarlo despliega una lista corta de
// acciones (cambiar contraseña, cerrar sesión, sincronización, etc.) en
// vez de dejarlas como tarjetas grandes ocupando toda la pantalla.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';

export interface OpcionAjustes {
  id: string;
  label: string;
  icon: string;
  onPress: () => void;
  /** Pinta la opción en rojo (ej. Cerrar Sesión). */
  destructivo?: boolean;
}

interface AjustesMenuProps {
  opciones: OpcionAjustes[];
}

const AjustesMenu: React.FC<AjustesMenuProps> = ({ opciones }) => {
  const [abierto, setAbierto] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      <TouchableOpacity
        style={styles.boton}
        onPress={() => setAbierto(true)}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.icono}>⚙️</Text>
      </TouchableOpacity>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.overlay} onPress={() => setAbierto(false)}>
          <View style={[styles.dropdown, { top: insets.top + 52 }]}>
            {opciones.map((op, i) => (
              <TouchableOpacity
                key={op.id}
                style={[styles.opcion, i < opciones.length - 1 && styles.opcionBorde]}
                onPress={() => {
                  setAbierto(false);
                  op.onPress();
                }}
                activeOpacity={0.6}
              >
                <Text style={styles.opcionIcono}>{op.icon}</Text>
                <Text style={[styles.opcionTexto, op.destructivo && styles.opcionTextoDestructivo]}>
                  {op.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  boton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  icono: {
    fontSize: 18,
  },
  overlay: {
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    right: SPACING.md,
    minWidth: 210,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.xs,
    ...SHADOWS.md,
  },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
  },
  opcionBorde: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  opcionIcono: {
    fontSize: 18,
    marginRight: SPACING.sm,
    width: 22,
    textAlign: 'center',
  },
  opcionTexto: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  opcionTextoDestructivo: {
    color: COLORS.error,
  },
});

export default AjustesMenu;
