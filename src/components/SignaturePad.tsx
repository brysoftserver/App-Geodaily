// ============================================================
// GEODAILY — Componente de Pad de Firma
// ============================================================

import React, { useRef } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import SignatureCapture from 'react-native-signature-canvas';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme';

interface SignaturePadProps {
  onOK: (signature: string) => void;
  onEmpty?: () => void;
  containerStyle?: ViewStyle;
  description?: string;
}

const SignaturePad: React.FC<SignaturePadProps> = ({
  onOK,
  onEmpty,
  containerStyle,
  description = 'Firma aquí',
}) => {
  const ref = useRef<any>(null);

  const handleOK = (signature: string) => {
    onOK(signature);
  };

  const handleEmpty = () => {
    onEmpty?.();
  };

  const handleClear = () => {
    ref.current?.clearImage();
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <SignatureCapture
        ref={ref}
        onOK={handleOK}
        onEmpty={handleEmpty}
        descriptionText={description}
        clearText="Limpiar"
        confirmText="Confirmar"
        webStyle={`
          .m-signature-pad {
            border: 1px solid ${COLORS.border};
            border-radius: ${BORDER_RADIUS.md}px;
          }
          .m-signature-pad--footer {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
          }
          .m-signature-pad--footer .button {
            padding: 8px 24px;
            border-radius: ${BORDER_RADIUS.md}px;
            font-size: 14px;
          }
          .m-signature-pad--footer .button.clear {
            background-color: ${COLORS.surface};
            color: ${COLORS.textSecondary};
            border: 1px solid ${COLORS.border};
          }
          .m-signature-pad--footer .button.save {
            background-color: ${COLORS.primary};
            color: ${COLORS.textOnPrimary};
          }
        `}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 250,
    marginVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
});

export default SignaturePad;
