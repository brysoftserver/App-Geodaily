// ============================================================
// GEODAILY — Formato Ingreso de Beneficiarios (PA. 2 FO. 31)
// ============================================================
// Planilla manual: el técnico escribe fila por fila los datos de
// beneficiarios nuevos y genera el PDF con el membrete oficial.
// El borrador se guarda localmente para no perder el trabajo si
// sale de la pantalla a mitad de llenarla.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { STORAGE_KEYS } from '../../utils/constants';
import { useAuth } from '../../store/AuthContext';
import {
  generarPDFIngresoBeneficiarios,
  FilaIngresoBeneficiario,
} from '../../services/pdfLocal.service';

type FormatoIngresoBeneficiariosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

type Fila = FilaIngresoBeneficiario & { id: string };

const filaVacia = (): Fila => ({
  id: `${Date.now()}_${Math.round(Math.random() * 1e6)}`,
  nombre: '',
  identificacion: '',
  telefono: '',
  vereda: '',
  finca: '',
  latitud: '',
  longitud: '',
});

const CAMPOS: { key: keyof FilaIngresoBeneficiario; label: string; keyboardType?: 'numeric' | 'phone-pad' | 'default' }[] = [
  { key: 'nombre', label: 'Nombre y Apellidos' },
  { key: 'identificacion', label: 'Identificación', keyboardType: 'numeric' },
  { key: 'telefono', label: 'Teléfono', keyboardType: 'phone-pad' },
  { key: 'vereda', label: 'Vereda' },
  { key: 'finca', label: 'Nombre de la Finca' },
  { key: 'latitud', label: 'Latitud', keyboardType: 'numeric' },
  { key: 'longitud', label: 'Longitud', keyboardType: 'numeric' },
];

const FormatoIngresoBeneficiariosScreen: React.FC<FormatoIngresoBeneficiariosScreenProps> = ({ navigation }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [filas, setFilas] = useState<Fila[]>([filaVacia()]);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const cargadoRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const draftStr = await AsyncStorage.getItem(STORAGE_KEYS.INGRESO_BENEFICIARIOS_DRAFT);
        if (draftStr) {
          const draft: Fila[] = JSON.parse(draftStr);
          if (Array.isArray(draft) && draft.length > 0) setFilas(draft);
        }
      } catch (e) {
        console.warn('[IngresoBeneficiarios] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!cargadoRef.current) return;
    AsyncStorage.setItem(STORAGE_KEYS.INGRESO_BENEFICIARIOS_DRAFT, JSON.stringify(filas)).catch((e) =>
      console.warn('[IngresoBeneficiarios] Error al guardar borrador:', e)
    );
  }, [filas]);

  const actualizarCampo = useCallback((id: string, campo: keyof FilaIngresoBeneficiario, valor: string) => {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }, []);

  const agregarFila = useCallback(() => {
    setFilas((prev) => [...prev, filaVacia()]);
  }, []);

  const eliminarFila = useCallback((id: string) => {
    setFilas((prev) => {
      if (prev.length === 1) return [filaVacia()];
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const vaciarPlanilla = useCallback(() => {
    Alert.alert(
      'Vaciar planilla',
      '¿Seguro que quieres borrar todas las filas escritas? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vaciar',
          style: 'destructive',
          onPress: () => setFilas([filaVacia()]),
        },
      ]
    );
  }, []);

  const generarPDF = useCallback(async () => {
    const filasConDatos = filas.filter((f) => f.nombre.trim() || f.identificacion.trim());
    if (filasConDatos.length === 0) {
      Alert.alert('Planilla vacía', 'Escribe al menos un beneficiario (nombre o identificación) antes de generar el PDF.');
      return;
    }

    setGenerando(true);
    try {
      const uri = await generarPDFIngresoBeneficiarios(filasConDatos, user?.nombre || 'Técnico');
      if (!uri) {
        Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('PDF generado', `Guardado en: ${uri}`);
      }
    } catch (e) {
      console.warn('[IngresoBeneficiarios] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [filas, user]);

  if (cargando) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.titulo}>Formato de Ingreso de Beneficiarios</Text>
        <Text style={styles.subtitulo}>
          Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal — PA. 2 FO. 31
        </Text>

        {filas.map((fila, idx) => (
          <View key={fila.id} style={styles.filaCard}>
            <View style={styles.filaHeader}>
              <Text style={styles.filaNumero}>Beneficiario {idx + 1}</Text>
              <TouchableOpacity onPress={() => eliminarFila(fila.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.eliminarIcon}>🗑️</Text>
              </TouchableOpacity>
            </View>

            {CAMPOS.map((campo) => (
              <View key={campo.key} style={styles.campoWrap}>
                <Text style={styles.campoLabel}>{campo.label}</Text>
                <TextInput
                  style={styles.input}
                  value={fila[campo.key]}
                  onChangeText={(v) => actualizarCampo(fila.id, campo.key, v)}
                  keyboardType={campo.keyboardType || 'default'}
                  placeholder={campo.label}
                  placeholderTextColor={COLORS.textLight}
                />
              </View>
            ))}
          </View>
        ))}

        <TouchableOpacity style={styles.agregarBtn} onPress={agregarFila} activeOpacity={0.7}>
          <Text style={styles.agregarBtnText}>+ Agregar beneficiario</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.vaciarBtn} onPress={vaciarPlanilla} activeOpacity={0.7}>
          <Text style={styles.vaciarBtnText}>Vaciar planilla</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <TouchableOpacity
          style={[styles.generarBtn, generando && styles.generarBtnDisabled]}
          onPress={generarPDF}
          disabled={generando}
          activeOpacity={0.8}
        >
          {generando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.generarBtnText}>📄 Generar PDF</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  titulo: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 16,
  },
  filaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  filaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.sm,
  },
  filaNumero: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  eliminarIcon: {
    fontSize: 18,
  },
  campoWrap: {
    marginBottom: SPACING.sm,
  },
  campoLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
  },
  agregarBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  agregarBtnText: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.bold,
    fontSize: FONTS.sizes.sm,
  },
  vaciarBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  vaciarBtnText: {
    color: COLORS.error,
    fontSize: FONTS.sizes.sm,
  },
  footer: {
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  generarBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generarBtnDisabled: {
    opacity: 0.6,
  },
  generarBtnText: {
    color: '#fff',
    fontWeight: FONTS.weights.bold,
    fontSize: FONTS.sizes.md,
  },
});

export default FormatoIngresoBeneficiariosScreen;
