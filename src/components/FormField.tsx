// ============================================================
// GEODAILY — Componente de Campo de Formulario
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ViewStyle,
  TextInputProps,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  required?: boolean;
  containerStyle?: ViewStyle;
  icon?: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  required = false,
  containerStyle,
  icon,
  ...inputProps
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputFocused,
          error && styles.inputError,
        ]}
      >
        {icon && <View style={styles.iconContainer}>{icon}</View>}
        <TextInput
          style={[styles.input, !!icon && styles.inputWithIcon]}
          placeholderTextColor={COLORS.textLight}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...inputProps}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: COLORS.error,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  inputFocused: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  iconContainer: {
    paddingLeft: SPACING.sm,
  },
  input: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  inputWithIcon: {
    paddingLeft: SPACING.sm,
  },
  errorText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: SPACING.xs,
    marginLeft: SPACING.xs,
  },
});

export default FormField;
