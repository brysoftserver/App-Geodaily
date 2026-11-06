// ============================================================
// GEODAILY — Bitácora del Beneficiario: lista de beneficiarios
// ============================================================
// Todos los beneficiarios del proyecto, con buscador. Al elegir uno se abre su
// ficha completa (BitacoraBeneficiarioScreen).
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { avisar } from '../../utils/dialogos';
import { useAuth } from '../../store/AuthContext';
import { BitacoraResumen, listarBitacora } from '../../services/bitacora.service';
import { generarYAbrirInformeGeneral } from '../../services/bitacoraPdf.service';

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const BitacoraListScreen: React.FC<any> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [generando, setGenerando] = useState(false);
  const [lista, setLista] = useState<BitacoraResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      setLista(await listarBitacora());
    } catch (e: any) {
      avisar(
        'No se pudo cargar',
        e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : 'Inténtalo de nuevo.')
      );
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Botón del encabezado: PDF con todos los beneficiarios (membrete de interventoría).
  const generarInforme = useCallback(async () => {
    if (generando) return;
    setGenerando(true);
    try {
      await generarYAbrirInformeGeneral(user?.nombre || '', user?.rol);
    } finally {
      setGenerando(false);
    }
  }, [generando, user?.nombre, user?.rol]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity style={[styles.btnHeader, generando && { opacity: 0.6 }]} onPress={generarInforme} disabled={generando} activeOpacity={0.8}>
          {generando ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnHeaderTxt} numberOfLines={2}>Generar Informe General PDF</Text>}
        </TouchableOpacity>
      ),
    });
  }, [navigation, generarInforme, generando]);

  const filtrada = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    if (!q) return lista;
    return lista.filter((b) =>
      sinTildes(`${b.nombre} ${b.cedula} ${b.vereda} ${b.corregimiento} ${b.tecnico ?? ''}`).includes(q)
    );
  }, [lista, busqueda]);

  return (
    <View style={styles.container}>
      <View style={styles.buscador}>
        <TextInput
          style={styles.input}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar por nombre, cédula, vereda o técnico"
          placeholderTextColor={COLORS.textLight}
          autoCorrect={false}
        />
      </View>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <FlatList
          data={filtrada}
          keyExtractor={(b) => String(b.item)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
          ListHeaderComponent={
            <Text style={styles.contador}>
              {filtrada.length === lista.length ? `${lista.length} beneficiarios` : `${filtrada.length} de ${lista.length} beneficiarios`}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.vacio}>No hay beneficiarios que coincidan.</Text>}
          renderItem={({ item: b }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('BitacoraBeneficiario', { item: b.item, nombre: b.nombre })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{b.nombre}</Text>
                <Text style={styles.dato}>C.C. {b.cedula}</Text>
                <Text style={styles.dato}>{b.corregimiento} · {b.vereda}</Text>
                {b.tecnico ? <Text style={styles.dato}>Técnico: {b.tecnico}</Text> : <Text style={styles.sinTecnico}>Sin técnico asignado</Text>}
                <View style={styles.chips}>
                  <Text style={[styles.chip, b.visitas > 0 ? styles.chipOk : styles.chipNo]}>
                    {b.visitas > 0 ? `✓ ${b.visitas} ${b.visitas === 1 ? 'visita' : 'visitas'}` : 'Sin visitas'}
                  </Text>
                  <Text style={[styles.chip, b.suelos ? styles.chipOk : styles.chipNo]}>
                    {b.suelos ? '🧪 Suelos' : 'Suelos pendiente'}
                  </Text>
                </View>
              </View>
              <Text style={styles.flecha}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  buscador: { padding: SPACING.md, paddingBottom: SPACING.xs },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.textPrimary },
  lista: { padding: SPACING.md },
  contador: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  sinTecnico: { fontSize: FONTS.sizes.sm, color: COLORS.warning, marginTop: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
  chip: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: BORDER_RADIUS.md, overflow: 'hidden' },
  chipOk: { color: COLORS.success, backgroundColor: '#E8F5E9' },
  chipNo: { color: COLORS.textSecondary, backgroundColor: COLORS.background },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  btnHeader: { backgroundColor: COLORS.roleInterventor, borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, maxWidth: 130, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  btnHeaderTxt: { color: '#fff', fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, textAlign: 'center' },
});

export default BitacoraListScreen;
