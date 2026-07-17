// ============================================================
// GEODAILY — Tarjeta de detalle de ítem del mapa
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

/** Formatear timestamp ISO a "hace X tiempo" */
const timeAgo = (iso?: string): string => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'ahora';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
};

interface MapItemDetailCardProps {
  item: Record<string, any>;
  plantaciones: Record<string, any>[];
  mediciones: Record<string, any>[];
  posiciones: Record<string, any>[];
  canViewAll: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onDelete: (tipo: 'plantación' | 'medición', id: string) => void;
}

const MapItemDetailCard: React.FC<MapItemDetailCardProps> = ({
  item,
  plantaciones,
  mediciones,
  posiciones,
  canViewAll,
  isAdmin,
  onClose,
  onDelete,
}) => {
  // La tarjeta es position:absolute bottom:0 — necesita su propia
  // safe-area para no quedar debajo de la barra de navegación del teléfono
  const insets = useSafeAreaInsets();

  if (!item) return null;

  const isPlantacion = item.id.startsWith('plant-');
  const isMedicion = item.id.startsWith('med-');
  const isTecnico = item.id.startsWith('tec-');
  const realId = item.id.replace(/^(plant-|med-|tec-)/, '');

  return (
    <View style={[styles.card, { paddingBottom: SPACING.md + insets.bottom }]}>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      {isPlantacion && (
        <>
          <Text style={styles.title}>🌱 Plantación</Text>
          <DetailRow
            label="Especie"
            value={`${item.icon} ${plantaciones.find((p: Record<string, any>) => p.id === realId)?.especie || '—'}`}
          />
          <DetailRow
            label="Cantidad"
            value={String(plantaciones.find((p: Record<string, any>) => p.id === realId)?.cantidad || '—')}
          />
          {canViewAll && (
            <DetailRow
              label="Técnico"
              value={plantaciones.find((p: Record<string, any>) => p.id === realId)?.usuario_nombre || '—'}
            />
          )}
          {isAdmin && (
            <DeleteButton label="🗑 Eliminar plantación" onPress={() => onDelete('plantación', realId)} />
          )}
        </>
      )}

      {isMedicion && (
        <>
          <Text style={styles.title}>📐 Medición de Terreno</Text>
          <DetailRow
            label="Área"
            value={`${mediciones.find((m: Record<string, any>) => m.id === realId)?.area_hectareas?.toFixed(2) || '?'} ha`}
          />
          <DetailRow
            label="Perímetro"
            value={`${mediciones.find((m: Record<string, any>) => m.id === realId)?.perimetro_metros?.toFixed(1) || '?'} m`}
          />
          {canViewAll && (
            <DetailRow
              label="Técnico"
              value={mediciones.find((m: Record<string, any>) => m.id === realId)?.usuario_nombre || '—'}
            />
          )}
          {isAdmin && (
            <DeleteButton label="🗑 Eliminar medición" onPress={() => onDelete('medición', realId)} />
          )}
        </>
      )}

      {isTecnico && (
        <>
          <Text style={styles.title}>👤 Técnico</Text>
          <DetailRow
            label="Nombre"
            value={posiciones.find((p: Record<string, any>) => p.id === realId)?.usuario_nombre || realId}
          />
          <DetailRow label="ID" value={realId} />
          <DetailRow
            label="Estado"
            value={
              timeAgo(posiciones.find((p: Record<string, any>) => p.id === realId)?.timestamp) === 'ahora'
                ? '🟢 En vivo'
                : `⏹ ${timeAgo(posiciones.find((p: Record<string, any>) => p.id === realId)?.timestamp)}`
            }
            valueColor={
              timeAgo(posiciones.find((p: Record<string, any>) => p.id === realId)?.timestamp) === 'ahora'
                ? '#2E7D32'
                : COLORS.textSecondary
            }
          />
          <DetailRow
            label="Última actualización"
            value={
              posiciones.find((p: Record<string, any>) => p.id === realId)?.timestamp
                ? new Date(posiciones.find((p: Record<string, any>) => p.id === realId)?.timestamp).toLocaleString()
                : '—'
            }
          />
        </>
      )}
    </View>
  );
};

const DetailRow: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor,
}) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}:</Text>
    <Text style={[styles.value, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
  </View>
);

const DeleteButton: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <TouchableOpacity style={styles.deleteBtn} onPress={onPress}>
    <Text style={styles.deleteText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  closeBtn: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: FONTS.weights.bold },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  label: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  value: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  deleteBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.error + '15',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  deleteText: { color: COLORS.error, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold },
});

export default MapItemDetailCard;
