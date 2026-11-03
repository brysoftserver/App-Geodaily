// ============================================================
// GEODAILY — Botón "Guardar" de los Otros Formatos
// ============================================================
// Los formatos ya se autoguardan al escribir, pero el técnico no tenía forma
// de saberlo ni de confirmarlo. Este botón guarda el borrador (con sus firmas)
// en el dispositivo y lo avisa. NO publica el formato a supervisión: eso sigue
// siendo "Generar PDF".
// ============================================================

import React, { useCallback, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { guardarDatosOtroFormato, TipoOtroFormato } from '../store/OtrosFormatosDraftStore';

const avisar = (titulo: string, mensaje: string) => {
  // `Alert.alert` de react-native-web es un no-op.
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(`${titulo}\n${mensaje}`);
  else Alert.alert(titulo, mensaje);
};

/**
 * Devuelve `guardar()` listo para el botón. Recibe el estado ACTUAL del
 * formulario en cada render (se lee por ref para no guardar valores viejos).
 */
export const useGuardarBorrador = (
  tipo: TipoOtroFormato,
  cedula: string | undefined | null,
  borrador: Record<string, any>
) => {
  const ref = useRef(borrador);
  ref.current = borrador;
  const [guardando, setGuardando] = useState(false);

  const guardar = useCallback(async () => {
    if (!cedula) {
      avisar('No se pudo guardar', 'Abre el formato desde la ficha de un beneficiario para poder guardarlo.');
      return;
    }
    setGuardando(true);
    const ok = await guardarDatosOtroFormato(tipo, cedula, ref.current);
    setGuardando(false);
    if (ok) avisar('Borrador guardado', 'Se guardó en este dispositivo. Podrás continuarlo cuando quieras.');
    else avisar('No se pudo guardar', 'Revisa el espacio del dispositivo e intenta de nuevo.');
  }, [tipo, cedula]);

  return { guardar, guardando };
};

type Props = { onPress: () => void; guardando?: boolean };

const BotonGuardarBorrador: React.FC<Props> = ({ onPress, guardando }) => (
  <TouchableOpacity
    style={[styles.btn, guardando && styles.btnDisabled]}
    onPress={onPress}
    disabled={guardando}
    activeOpacity={0.8}
  >
    {guardando ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.texto}>💾 Guardar</Text>}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  btnDisabled: { opacity: 0.6 },
  texto: { color: COLORS.primary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
});

export default BotonGuardarBorrador;
