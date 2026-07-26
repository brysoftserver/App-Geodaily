// ============================================================
// GEODAILY — Campana de notificaciones en-app (badge + bandeja)
// ============================================================
// Ícono de campana con contador de no leídas — al tocar abre una lista de
// notificaciones (ej. novedades marcadas por un revisor sobre un
// formulario). Tocar una notificación la marca como leída y, si trae
// formulario_id, intenta abrir el detalle de ese formulario.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import {
  fetchNotificaciones,
  fetchContadorNoLeidas,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  NotificacionApp,
} from '../services/notificaciones.service';
import { fetchFormularioDelServidor } from '../services/formularios.service';

const REFRESCO_MS = 60000;

interface NotificacionBellProps {
  /** Nombre de la ruta de detalle de formulario en el stack de este rol (ej. 'SupervisionFormularioDetail') */
  formularioDetailScreen?: string;
  navigation?: { navigate: (screen: string, params?: any) => void };
}

const formatFechaRelativa = (iso: string): string => {
  try {
    const fecha = new Date(iso);
    return fecha.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const NotificacionBell: React.FC<NotificacionBellProps> = ({ formularioDetailScreen, navigation }) => {
  const [visible, setVisible] = useState(false);
  const [notificaciones, setNotificaciones] = useState<NotificacionApp[]>([]);
  const [contador, setContador] = useState(0);
  const [cargandoDetalle, setCargandoDetalle] = useState<number | null>(null);

  const cargarContador = useCallback(async () => {
    const total = await fetchContadorNoLeidas();
    setContador(total);
  }, []);

  useEffect(() => {
    cargarContador();
    const intervalo = setInterval(cargarContador, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargarContador]);

  useFocusEffect(useCallback(() => { cargarContador(); }, [cargarContador]));

  const abrirBandeja = useCallback(async () => {
    setVisible(true);
    const lista = await fetchNotificaciones();
    setNotificaciones(lista);
  }, []);

  const onPressNotificacion = useCallback(async (n: NotificacionApp) => {
    if (!n.leida) {
      await marcarNotificacionLeida(n.id);
      setNotificaciones((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      setContador((prev) => Math.max(0, prev - 1));
    }
    if (n.formulario_id && formularioDetailScreen && navigation) {
      setCargandoDetalle(n.id);
      const formulario = await fetchFormularioDelServidor(n.formulario_id);
      setCargandoDetalle(null);
      if (formulario) {
        setVisible(false);
        navigation.navigate(formularioDetailScreen, { formulario });
      }
    }
  }, [formularioDetailScreen, navigation]);

  const onMarcarTodas = useCallback(async () => {
    await marcarTodasLeidas();
    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    setContador(0);
  }, []);

  return (
    <>
      <TouchableOpacity onPress={abrirBandeja} activeOpacity={0.7} style={styles.bellBtn}>
        <Text style={styles.bellIcon}>🔔</Text>
        {contador > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{contador > 9 ? '9+' : contador}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable style={styles.panel} onPress={() => {}}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Notificaciones</Text>
              {notificaciones.some((n) => !n.leida) && (
                <TouchableOpacity onPress={onMarcarTodas}>
                  <Text style={styles.marcarTodas}>Marcar todas leídas</Text>
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={notificaciones}
              keyExtractor={(item) => String(item.id)}
              style={styles.lista}
              ListEmptyComponent={<Text style={styles.emptyText}>No tienes notificaciones.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.item, !item.leida && styles.itemNoLeida]}
                  onPress={() => onPressNotificacion(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.itemHeader}>
                    {!item.leida && <View style={styles.dot} />}
                    <Text style={styles.itemTitulo}>{item.titulo}</Text>
                  </View>
                  {!!item.mensaje && <Text style={styles.itemMensaje}>{item.mensaje}</Text>}
                  <View style={styles.itemFooter}>
                    <Text style={styles.itemFecha}>{formatFechaRelativa(item.created_at)}</Text>
                    {cargandoDetalle === item.id && <ActivityIndicator size="small" color={COLORS.primary} />}
                  </View>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.cerrarBtn} onPress={() => setVisible(false)}>
              <Text style={styles.cerrarBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellIcon: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: FONTS.weights.bold },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  panelTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  marcarTodas: { fontSize: FONTS.sizes.xs, color: COLORS.info, fontWeight: FONTS.weights.medium },
  lista: { flexGrow: 0 },
  emptyText: { color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.xl },
  item: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
  },
  itemNoLeida: { backgroundColor: COLORS.background },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.error },
  itemTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, flexShrink: 1 },
  itemMensaje: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  itemFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  itemFecha: { fontSize: FONTS.sizes.xs, color: COLORS.textLight },
  cerrarBtn: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  cerrarBtnText: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold },
});

export default NotificacionBell;
