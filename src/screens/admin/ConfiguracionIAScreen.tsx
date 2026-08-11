// ============================================================
// GEODAILY — Configuración de IA (DeepSeek)
// ============================================================
// El admin configura aquí la API key de DeepSeek que el backend usa para
// generar el análisis en texto de cada gráfica del PDF del Dashboard. La
// key nunca se muestra completa una vez guardada — solo se ve si ya hay
// una configurada (últimos 4 dígitos) o si se está por reemplazar.
// ============================================================

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { getConfigIA, guardarApiKeyIA, eliminarApiKeyIA } from '../../services/ia.service';

const ConfiguracionIAScreen: React.FC = () => {
  const [cargando, setCargando] = useState(true);
  const [configurado, setConfigurado] = useState(false);
  const [ultimosDigitos, setUltimosDigitos] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const config = await getConfigIA();
      setConfigurado(config.configurado);
      setUltimosDigitos(config.ultimosDigitos);
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo consultar la configuración de IA.');
    } finally {
      setCargando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  const guardar = async () => {
    if (!apiKey.trim()) {
      Alert.alert('API key requerida', 'Escribe la API key de DeepSeek antes de guardar.');
      return;
    }
    setGuardando(true);
    try {
      await guardarApiKeyIA(apiKey.trim());
      setApiKey('');
      await cargar();
      Alert.alert('Listo', 'La API key de DeepSeek quedó guardada. El análisis de IA en el PDF ya está activo.');
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo guardar la API key. Verifica tu conexión e inténtalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = () => {
    Alert.alert(
      'Desactivar análisis con IA',
      '¿Seguro que quieres eliminar la API key? El PDF del Dashboard seguirá generándose normalmente, pero sin el análisis en texto de cada gráfica.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setEliminando(true);
            try {
              await eliminarApiKeyIA();
              await cargar();
            } catch (error: any) {
              Alert.alert('Error', 'No se pudo eliminar la API key.');
            } finally {
              setEliminando(false);
            }
          },
        },
      ]
    );
  };

  if (cargando) {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.titulo}>Análisis de gráficas con IA</Text>
      <Text style={styles.descripcion}>
        Con una API key de DeepSeek configurada, el PDF del Dashboard incluye un análisis en texto (1 a 3 párrafos)
        por cada gráfica que se exporte. Si no hay internet al momento de generar el PDF, o si DeepSeek falla, esa
        gráfica se imprime sin análisis — el PDF nunca se interrumpe por esto.
      </Text>

      <View style={styles.estadoCard}>
        <Text style={styles.estadoLabel}>Estado actual</Text>
        {configurado ? (
          <Text style={styles.estadoValorOk}>✅ Configurada (termina en ····{ultimosDigitos})</Text>
        ) : (
          <Text style={styles.estadoValorVacio}>⚪ Sin configurar — el PDF se genera sin análisis de IA</Text>
        )}
      </View>

      <Text style={styles.fieldLabel}>{configurado ? 'Reemplazar API key' : 'API key de DeepSeek'}</Text>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="sk-..."
        placeholderTextColor={COLORS.textLight}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity style={[styles.boton, styles.botonGuardar]} onPress={guardar} disabled={guardando} activeOpacity={0.8}>
        {guardando ? (
          <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
        ) : (
          <Text style={styles.botonGuardarTexto}>{configurado ? 'Reemplazar API key' : 'Guardar API key'}</Text>
        )}
      </TouchableOpacity>

      {configurado && (
        <TouchableOpacity style={[styles.boton, styles.botonEliminar]} onPress={eliminar} disabled={eliminando} activeOpacity={0.8}>
          {eliminando ? (
            <ActivityIndicator size="small" color={COLORS.error} />
          ) : (
            <Text style={styles.botonEliminarTexto}>Eliminar API key</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  titulo: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  descripcion: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    lineHeight: 20,
  },
  estadoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    ...SHADOWS.sm,
  },
  estadoLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  estadoValorOk: {
    fontSize: FONTS.sizes.md,
    color: COLORS.success,
    fontWeight: FONTS.weights.semibold,
  },
  estadoValorVacio: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  boton: {
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm + 4,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  botonGuardar: {
    backgroundColor: COLORS.primary,
  },
  botonGuardarTexto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.md,
  },
  botonEliminar: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.error,
    marginTop: SPACING.sm,
  },
  botonEliminarTexto: {
    color: COLORS.error,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.md,
  },
});

export default ConfiguracionIAScreen;
