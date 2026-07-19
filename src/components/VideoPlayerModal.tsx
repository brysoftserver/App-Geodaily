// ============================================================
// GEODAILY — Reproductor de Video en Modal
// ============================================================
// Visor de videos de evidencia. Se usa desde la cámara (revisar
// lo recién grabado) y desde el detalle del formulario (revisar
// la evidencia de una visita ya completada).
//
// Antes los videos se capturaban y subían correctamente pero no
// existía forma de reproducirlos dentro de la app.
// ============================================================

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

type VideoPlayerModalProps = {
  /** URI del video (file:// local o https:// remoto). null cierra el modal. */
  uri: string | null;
  visible: boolean;
  onClose: () => void;
  /** Texto opcional bajo el video (fecha, coordenadas...) */
  subtitulo?: string;
  /** Cabeceras HTTP para videos servidos por la API (Authorization) */
  headers?: Record<string, string>;
};

const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  uri,
  visible,
  onClose,
  subtitulo,
  headers,
}) => {
  const [error, setError] = React.useState(false);
  const [listo, setListo] = React.useState(false);

  // El player se recrea cuando cambia el URI. Se reproduce en bucle
  // porque los videos de evidencia son cortos (máx. 30 s).
  // Los videos servidos por la API necesitan la cabecera Authorization;
  // los locales (file://) se abren directamente.
  const fuente = React.useMemo(() => {
    if (!uri) return null;
    return uri.startsWith('http') && headers && Object.keys(headers).length > 0
      ? { uri, headers }
      : { uri };
  }, [uri, headers]);

  const player = useVideoPlayer(fuente, (p) => {
    p.loop = true;
  });

  // Reproducir al abrir, pausar al cerrar — evita audio de fondo
  React.useEffect(() => {
    if (!player) return;
    setError(false);
    setListo(false);
    if (visible && uri) {
      try {
        player.play();
        setListo(true);
      } catch (e) {
        console.warn('[VideoPlayer] No se pudo reproducir:', e);
        setError(true);
      }
    } else {
      try {
        player.pause();
      } catch {
        // el player ya pudo ser liberado
      }
    }
  }, [visible, uri, player]);

  return (
    <Modal
      visible={visible && !!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>🎥 Video de evidencia</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.playerWrapper}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>
                No se pudo reproducir este video.
              </Text>
              <Text style={styles.errorHint}>
                El archivo puede haberse movido del dispositivo. Sigue
                disponible en el servidor del proyecto.
              </Text>
            </View>
          ) : (
            <>
              {!listo && (
                <ActivityIndicator
                  size="large"
                  color={COLORS.surface}
                  style={styles.loader}
                />
              )}
              <VideoView
                player={player}
                style={styles.video}
                nativeControls
                allowsFullscreen
                contentFit="contain"
              />
            </>
          )}
        </View>

        {!!subtitulo && <Text style={styles.subtitulo}>{subtitulo}</Text>}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  title: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  playerWrapper: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: '75%',
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  loader: {
    position: 'absolute',
    zIndex: 1,
  },
  errorBox: {
    padding: SPACING.lg,
    alignItems: 'center',
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    textAlign: 'center',
  },
  errorHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  subtitulo: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});

export default VideoPlayerModal;
