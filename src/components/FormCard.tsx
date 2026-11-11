// ============================================================
// GEODAILY — Componente de Tarjeta de Formulario
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { Formulario } from '../types';
import { formatFecha, formatCoordenadas, truncarTexto } from '../utils/formatters';
import { tituloVisitaTecnica } from '../utils/visitaTecnica';

export interface EstadoRevisionCard {
  coordinador: 'ok' | 'novedades' | null;
  interventor: 'ok' | 'novedades' | null;
  novedades_total: number;
  /** De novedades_total, cuántas ya corrigió el técnico (por verificar). */
  por_verificar?: number;
  /** Estado del flujo calculado por el servidor (lib/estadoRevision.js). */
  estado_flujo?: string;
  rol_flujo?: 'coordinador' | 'interventor' | null;
  novedades_fase?: number;
  por_verificar_fase?: number;
  secciones_aprobadas?: number;
}

const ROL_FASE: Record<string, string> = { coordinador: 'Coordinador/a', interventor: 'interventoría' };

/**
 * Texto y color del estado del flujo. Devuelve null si el servidor no envió
 * `estado_flujo` (backend anterior): entonces se usa la lógica de respaldo.
 */
const estadoFlujoVisual = (
  e: EstadoRevisionCard
): { texto: string; estilo: 'ok' | 'novedades' | 'verificar' | 'pendiente' } | null => {
  if (!e.estado_flujo) return null;
  const quien = ROL_FASE[e.rol_flujo || ''] || 'revisor';
  const nov = e.novedades_fase ?? e.novedades_total;
  const ver = e.por_verificar_fase ?? e.por_verificar ?? 0;
  switch (e.estado_flujo) {
    case 'aprobado':
      return { texto: '✅ Aprobado por Coordinador/a e interventoría', estilo: 'ok' };
    case 'en_interventoria':
      return { texto: '🏛️ Revisión del Coordinador/a cerrada — en interventoría', estilo: 'ok' };
    case 'por_verificar':
      return { texto: `🔄 Corregido — por verificar (${quien})`, estilo: 'verificar' };
    case 'por_corregir':
      return {
        texto: `⚠️ ${nov - ver} novedad(es) de ${quien} por corregir` + (ver > 0 ? ` · 🔄 ${ver} por verificar` : ''),
        estilo: 'novedades',
      };
    case 'por_cerrar':
      return {
        texto:
          `🔍 En revisión de ${quien}` +
          (e.secciones_aprobadas ? ` · ${e.secciones_aprobadas} sección(es) aprobada(s)` : '') +
          ' — falta cerrar',
        estilo: 'pendiente',
      };
    case 'sin_revisar':
    default:
      return { texto: '🕓 Sin revisar', estilo: 'pendiente' };
  }
};

interface FormCardProps {
  formulario: Formulario;
  onPress: (formulario: Formulario) => void;
  onViewPDF?: (formulario: Formulario) => void;
  /** true si el último intento de sync falló (requiere atención del técnico) */
  failed?: boolean;
  /** Reintento manual — solo se usa cuando `failed` es true */
  onRetry?: (formulario: Formulario) => void;
  /** Estado de revisión jerárquica (novedades / vistos buenos) */
  estadoRevision?: EstadoRevisionCard;
  /** Descargar fotos/videos del formulario como .zip — solo si ya sincronizó */
  onDownloadMedia?: (formulario: Formulario) => void;
  /** true mientras se arma el paquete de este formulario (deshabilita el botón) */
  downloadingMedia?: boolean;
}

/** ¿Las novedades abiertas son de interventoría (con el OK del coordinador ya dado)? */
const novedadesDeInterventoriaRol = (e?: EstadoRevisionCard): boolean =>
  e?.interventor === 'novedades' && e?.coordinador === 'ok';

const FormCard: React.FC<FormCardProps> = ({
  formulario,
  onPress,
  onViewPDF,
  failed,
  onRetry,
  estadoRevision,
  onDownloadMedia,
  downloadingMedia,
}) => {
  const getTipoColor = () => {
    return formulario.tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.primary;
  };

  // Novedades que el técnico todavía debe atender. Se exige que el rol que
  // las marcó siga en 'novedades' (su último movimiento), para no pintar en
  // rojo novedades ya resueltas por el mismo rol.
  const hayNovedadesPendientes =
    !!estadoRevision &&
    estadoRevision.novedades_total > 0 &&
    (estadoRevision.coordinador === 'novedades' || estadoRevision.interventor === 'novedades');
  // Novedades que el técnico YA corrigió y esperan la verificación del
  // revisor. Si las corrigió todas, la tarjeta deja de estar en rojo: ya no
  // es trabajo del técnico sino del revisor (antes seguía "por corregir" y
  // nadie sabía que la pelota estaba del lado del coordinador).
  const porVerificar = hayNovedadesPendientes ? Math.min(estadoRevision?.por_verificar || 0, estadoRevision!.novedades_total) : 0;
  const porCorregir = hayNovedadesPendientes ? estadoRevision!.novedades_total - porVerificar : 0;
  const todoCorregido = hayNovedadesPendientes && porVerificar > 0 && porCorregir === 0;
  const revisorPendiente = novedadesDeInterventoriaRol(estadoRevision) ? 'interventoría' : 'Coordinador/a';
  const aprobadoPorAmbos =
    estadoRevision?.coordinador === 'ok' && estadoRevision?.interventor === 'ok';
  // Después del OK del coordinador, el turno es de interventoría: si es ella
  // la que observa, el técnico debe saberlo (antes decía "Todo OK del
  // Coordinador/a — en interventoría" y ocultaba las novedades del interventor).
  const novedadesDeInterventoria =
    hayNovedadesPendientes &&
    estadoRevision?.interventor === 'novedades' &&
    estadoRevision?.coordinador === 'ok';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(formulario)}
      activeOpacity={0.7}
    >
      <View style={[styles.tipoBadge, { backgroundColor: getTipoColor() }]}>
        <Text style={styles.tipoText}>
          {formulario.tipo === 'caracterizacion'
            ? 'Caracterización'
            : tituloVisitaTecnica(formulario.actividad?.visita_numero)}
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.beneficiario}>
          {truncarTexto(formulario.beneficiario.nombre, 40)}
        </Text>

        <Text style={styles.detalle}>
          {formulario.beneficiario.municipio}
          {formulario.beneficiario.vereda && ` — ${formulario.beneficiario.vereda}`}
        </Text>

        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={styles.fecha}>
              {formatFecha(formulario.created_at)}
            </Text>
            <Text
              style={[styles.huellaIcon, !formulario.huella_beneficiario && styles.huellaIconAusente]}
            >
              {formulario.huella_beneficiario ? '🖐️' : '🖐️🚫'}
            </Text>
          </View>
          <Text style={styles.coordenadas}>
            {formatCoordenadas(
              formulario.coordenadas.latitud,
              formulario.coordenadas.longitud,
              4
            )}
          </Text>
        </View>

        {/* Estado de revisión jerárquica (visible para el técnico) */}
        {estadoRevision && estadoFlujoVisual(estadoRevision) && (() => {
          const v = estadoFlujoVisual(estadoRevision)!;
          return (
            <View
              style={[
                styles.revisionBadge,
                v.estilo === 'ok'
                  ? styles.revisionAprobada
                  : v.estilo === 'novedades'
                    ? styles.revisionNovedades
                    : v.estilo === 'verificar'
                      ? styles.revisionPorVerificar
                      : styles.revisionPendiente,
              ]}
            >
              <Text style={styles.revisionText}>{v.texto}</Text>
            </View>
          );
        })()}
        {/* Respaldo: backend anterior sin estado_flujo */}
        {estadoRevision && !estadoFlujoVisual(estadoRevision) && (
          <View
            style={[
              styles.revisionBadge,
              aprobadoPorAmbos
                ? styles.revisionAprobada
                : todoCorregido
                  ? styles.revisionPorVerificar
                  : hayNovedadesPendientes
                  ? styles.revisionNovedades
                  : estadoRevision.coordinador === 'ok'
                    ? styles.revisionAprobada
                    : styles.revisionPendiente,
            ]}
          >
            <Text style={styles.revisionText}>
              {aprobadoPorAmbos
                ? '✅ Aprobado por Coordinador/a e interventoría'
                : todoCorregido
                  ? `🔄 Corregido — por verificar (${revisorPendiente})`
                  : hayNovedadesPendientes
                  ? (novedadesDeInterventoria
                      ? `⚠️ ${porCorregir} novedad(es) de interventoría por corregir`
                      : `⚠️ ${porCorregir} novedad(es) por corregir`) +
                    (porVerificar > 0 ? ` · 🔄 ${porVerificar} por verificar` : '')
                  : estadoRevision.coordinador === 'ok'
                    ? '✅ Todo OK del Coordinador/a — en interventoría'
                    : '🕓 En revisión'}
            </Text>
          </View>
        )}

        {!formulario.sincronizado && failed && (
          <TouchableOpacity
            style={styles.failedBadge}
            onPress={() => onRetry?.(formulario)}
          >
            <Text style={styles.failedText}>⚠️ Falló la sincronización — toca para reintentar</Text>
          </TouchableOpacity>
        )}
        {!formulario.sincronizado && !failed && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>Pendiente de sincronizar</Text>
          </View>
        )}
      </View>

      {((onViewPDF && formulario.pdf_url) || (onDownloadMedia && formulario.sincronizado)) && (
        <View style={styles.sideActions}>
          {onViewPDF && formulario.pdf_url && (
            <TouchableOpacity
              style={styles.pdfButton}
              onPress={() => onViewPDF(formulario)}
            >
              <Text style={styles.pdfButtonText}>PDF</Text>
            </TouchableOpacity>
          )}
          {onDownloadMedia && formulario.sincronizado && (
            <TouchableOpacity
              style={[
                styles.mediaButton,
                onViewPDF && formulario.pdf_url && styles.mediaButtonConDivisor,
              ]}
              onPress={() => onDownloadMedia(formulario)}
              disabled={downloadingMedia}
            >
              {downloadingMedia ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.mediaButtonText}>📦{'\n'}Media</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    ...SHADOWS.sm,
    overflow: 'hidden',
  },
  tipoBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
  },
  tipoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
    transform: [{ rotate: '-90deg' }],
    width: 80,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: SPACING.md,
  },
  beneficiario: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  detalle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  huellaIcon: {
    fontSize: FONTS.sizes.xs,
  },
  huellaIconAusente: {
    opacity: 0.4,
  },
  coordenadas: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  pendingBadge: {
    backgroundColor: COLORS.warning + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
  },
  pendingText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
  },
  failedBadge: {
    backgroundColor: COLORS.error + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
  },
  revisionBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
  },
  revisionAprobada: { backgroundColor: COLORS.success + '20' },
  revisionNovedades: { backgroundColor: COLORS.error + '20' },
  revisionPorVerificar: { backgroundColor: COLORS.info + '20' },
  revisionPendiente: { backgroundColor: COLORS.divider },
  revisionText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  failedText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    fontWeight: FONTS.weights.semibold,
  },
  sideActions: {
    width: 56,
  },
  pdfButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.error + '10',
  },
  pdfButtonText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
  mediaButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
    backgroundColor: COLORS.primary + '10',
  },
  mediaButtonConDivisor: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.divider,
  },
  mediaButtonText: {
    fontSize: 10,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    textAlign: 'center',
    lineHeight: 12,
  },
});

export default FormCard;
