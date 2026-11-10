// ============================================================
// GEODAILY — Entregas de una actividad (Entrega 1, Entrega 2…)
// ============================================================
// Si aún no hay entregas se muestra "Entrega 1" (se crea al abrirla).
// "Agregar Entrega" crea la siguiente del consecutivo. Cada entrega guarda su
// información por separado.
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { SUBACTIVIDADES } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import {
  crearEntrega,
  EntregaLocal,
  importarEntregasDelServidor,
  listarEntregasLocales,
} from '../../services/actividadesEntregas.service';

const EntregasActividadScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actividadId: string = route?.params?.actividadId;
  const sub = (SUBACTIVIDADES[actividadId] ?? []).find((s) => s.id === route?.params?.subactividadId);
  const [entregas, setEntregas] = useState<EntregaLocal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [creando, setCreando] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: sub?.nombre ?? 'Entregas' });
  }, [navigation, sub?.nombre]);

  const cargar = useCallback(async (esRefresh = false) => {
    if (!user?.id) return;
    if (esRefresh) setRefrescando(true);
    setEntregas(await listarEntregasLocales(actividadId, user.id));
    setCargando(false);
    // Con red: trae las hechas en otro teléfono y vuelve a listar.
    if (await importarEntregasDelServidor(actividadId, user.id)) {
      setEntregas(await listarEntregasLocales(actividadId, user.id));
    }
    setRefrescando(false);
  }, [actividadId, user?.id]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrir = (e: EntregaLocal) => navigation.navigate('EntregaDetalle', { actividadId, entregaId: e.id });

  const agregar = async () => {
    if (!user?.id || creando) return;
    setCreando(true);
    try {
      const nueva = await crearEntrega(actividadId, user.id);
      if (!nueva) return avisar('No se pudo crear', 'Revisa el espacio del dispositivo e inténtalo de nuevo.');
      abrir(nueva);
    } finally {
      setCreando(false);
    }
  };

  const resumen = (e: EntregaLocal) =>
    [e.datos.lugar?.trim() || 'Lugar sin registrar', e.datos.beneficiario?.nombre].filter(Boolean).join(' · ');

  if (cargando) return <View style={styles.container}><ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={entregas}
        keyExtractor={(e) => e.id}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        ListEmptyComponent={
          // Sin entregas todavía: "Entrega 1" se crea al tocarla.
          <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={agregar} disabled={creando}>
            <Text style={styles.icon}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.titulo}>Entrega 1</Text>
              <Text style={styles.dato}>Sin diligenciar</Text>
            </View>
            {creando ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.arrow}>›</Text>}
          </TouchableOpacity>
        }
        renderItem={({ item: e }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => abrir(e)}>
            <Text style={styles.icon}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.titulo}>Entrega {e.numero}</Text>
              <Text style={styles.dato} numberOfLines={1}>{resumen(e)}</Text>
              <Text style={styles.dato}>📷 {e.datos.fotos.length} foto(s)</Text>
              <Text style={[styles.estado, { color: e.sincronizado ? COLORS.success : COLORS.warning }]}>
                {e.sincronizado ? '☁️ En el servidor' : '📱 Pendiente de subir · se subirá con señal'}
              </Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          entregas.length > 0 ? (
            <TouchableOpacity style={[styles.btnAgregar, creando && { opacity: 0.6 }]} onPress={agregar} disabled={creando}>
              {creando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnAgregarTxt}>＋ Agregar Entrega</Text>}
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  lista: { padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  icon: { fontSize: 26, marginRight: SPACING.md },
  titulo: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  btnAgregar: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnAgregarTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
});

export default EntregasActividadScreen;
