// ============================================================
// GEODAILY — Componente de Pad de Firma (WebView personalizado)
// Los botones "Confirmar" y "Limpiar" son componentes nativos
// de React Native, SIEMPRE visibles y tocables.
// ============================================================

import React, { useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS, SPACING, BORDER_RADIUS, FONTS, SHADOWS } from '../theme';

interface SignaturePadProps {
  onOK: (signature: string) => void;
  onEmpty?: () => void;
  containerStyle?: ViewStyle;
  description?: string;
}

// Generamos el HTML inline con un canvas y JS para dibujar la firma
const generarHTML = (desc: string): string => `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #fff;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    font-family: sans-serif;
  }
  .header {
    text-align: center;
    padding: 6px;
    font-size: 13px;
    color: #888;
    background: #fafafa;
    border-bottom: 1px solid #eee;
  }
  canvas {
    flex: 1;
    width: 100%;
    touch-action: none;
    cursor: crosshair;
    display: block;
  }
  .placeholder {
    position: absolute;
    bottom: 16px;
    left: 0;
    right: 0;
    text-align: center;
    color: #ccc;
    font-size: 14px;
    pointer-events: none;
    user-select: none;
  }
</style>
</head>
<body>
<div class="header">${desc}</div>
<canvas id="sigCanvas"></canvas>
<div class="placeholder" id="placeholder">━━ Firma aquí ━━</div>
<script>
  (function(){
    var canvas = document.getElementById('sigCanvas');
    var placeholder = document.getElementById('placeholder');
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var lastX = 0, lastY = 0;
    var hasDrawn = false;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    window.addEventListener('resize', resize);

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDrawing(e) {
      e.preventDefault();
      var pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
      drawing = true;
      hasDrawn = true;
      placeholder.style.display = 'none';
    }

    function draw(e) {
      e.preventDefault();
      if (!drawing) return;
      var pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    }

    function stopDrawing(e) {
      e.preventDefault();
      drawing = false;
    }

    // Touch events
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // API expuesta para RN
    window.clearSignature = function() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
      placeholder.style.display = 'block';
    };

    window.confirmSignature = function() {
      if (!hasDrawn) {
        window.ReactNativeWebView.postMessage('__EMPTY__');
        return;
      }
      var dataUrl = canvas.toDataURL('image/png');
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(dataUrl);
      }
    };

    resize();
  })();
</script>
</body>
</html>
`;

const SignaturePad: React.FC<SignaturePadProps> = ({
  onOK,
  onEmpty,
  containerStyle,
  description = 'Firma aquí',
}) => {
  const webviewRef = useRef<WebView>(null);

  const handleMessage = useCallback(
    (event: any) => {
      const data = event.nativeEvent.data;
      if (data === '__EMPTY__') {
        onEmpty?.();
      } else if (data && data.startsWith('data:image/')) {
        onOK(data);
      }
    },
    [onOK, onEmpty]
  );

  const handleClear = () => {
    webviewRef.current?.injectJavaScript('window.clearSignature(); true;');
  };

  const handleConfirm = () => {
    webviewRef.current?.injectJavaScript('window.confirmSignature(); true;');
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.webviewWrapper}>
        <WebView
          ref={webviewRef}
          source={{ html: generarHTML(description) }}
          onMessage={handleMessage}
          style={styles.webview}
          javaScriptEnabled={true}
          scrollEnabled={false}
          bounces={false}
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
        />
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Text style={styles.clearBtnText}>🗑 Limpiar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={handleConfirm}
          activeOpacity={0.7}
        >
          <Text style={styles.confirmBtnText}>✅ Confirmar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...SHADOWS.sm,
  },
  webviewWrapper: {
    height: 220,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderTopLeftRadius: BORDER_RADIUS.md,
    borderTopRightRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: SPACING.sm,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: COLORS.border,
    borderBottomLeftRadius: BORDER_RADIUS.md,
    borderBottomRightRadius: BORDER_RADIUS.md,
    gap: SPACING.sm,
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  clearBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  confirmBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
});

export default SignaturePad;
