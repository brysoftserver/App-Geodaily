// ============================================================
// GEODAILY — Detalle de Formulario (Read-Only + PDF)
// ============================================================
// Muestra todos los datos de un formulario completado,
// con miniaturas de evidencias y opciones de PDF.
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  Platform,
  Linking,
  Dimensions,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario } from '../../types';
import { formatFecha, formatCoordenadas } from '../../utils/formatters';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { convertirFotosAHTML, generarSelloBiometrico } from '../../services/pdfLocal.service';

type FormularioDetailScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ params: { formulario: Formulario } }, 'params'>;
};

const FormularioDetailScreen: React.FC<FormularioDetailScreenProps> = ({ route, navigation }) => {
  const { formulario } = route.params;
  const insets = useSafeAreaInsets();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');
  const PDF_HEIGHT = SCREEN_HEIGHT * 0.55;

  const generarHtml = async (): Promise<string> => {
    const f = formulario;

    // Convertir fotos con redimensionamiento (async)
    const fotosHtml = await convertirFotosAHTML(f.fotos || []);

    // Firmas (ya están en base64 data URIs)
    const firmaBenefHtml = f.firma_beneficiario
      ? `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(f.beneficiario.nombre)}</strong> (C.C. ${escapeHtml(f.beneficiario.cedula || '—')})</p><img src="${f.firma_beneficiario}" alt="Firma del beneficiario" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

    const firmaTecHtml = f.firma_tecnico
      ? `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico — <strong>${escapeHtml(f.tecnico.nombre)}</strong> (C.C. ${escapeHtml(f.tecnico.cedula || '—')})</p><img src="${f.firma_tecnico}" alt="Firma del técnico" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

    // Sello biométrico con gráfico de huella SVG (async-safe)
    const huellaHtml = f.huella_beneficiario
      ? generarSelloBiometrico(f.beneficiario.nombre)
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Huella Biométrica</p><p class="no-data">No registrada</p></div>`;

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Formulario ${f.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2d3436; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #1B5E20; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #1B5E20; font-size: 24px; margin-bottom: 4px; }
  .header p { color: #636e72; font-size: 13px; }
  .section { margin: 20px 0; padding: 16px 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; }
  .section h2 { color: #1B5E20; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .row { display: flex; margin: 3px 0; font-size: 13px; }
  .label { font-weight: bold; color: #555; min-width: 140px; }
  .value { flex: 1; color: #2d3436; }
  .foto-item { margin: 16px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .foto-img { width: 100%; max-width: 350px; max-height: 240px; height: auto; border-radius: 4px; margin: 8px auto; display: block; object-fit: cover; }
  .foto-coords { font-size: 11px; color: #636e72; font-family: monospace; }
  .foto-heading { font-size: 11px; color: #0984e3; font-family: monospace; }
  .firma-item { display: inline-block; vertical-align: top; margin: 8px; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; width: calc(50% - 16px); min-width: 200px; }
  .firmas-contiguo { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .evidencia-item { margin: 12px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
  .firma-img { max-width: 100%; max-height: 100px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 8px; background: #fff; }
  /* --- Sello de verificación biométrica --- */
  .huella-sello { margin: 16px 0; page-break-inside: avoid; }
  .huella-sello-inner { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #1B5E20; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(27,94,32,0.15); }
  .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
  .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
  .huella-sello-titles { flex: 1; }
  .huella-sello-verificado { font-size: 20px; font-weight: bold; color: #15803d; }
  .huella-sello-label { font-size: 13px; color: #16a34a; }
  .huella-sello-body { margin-bottom: 14px; }
  .huella-sello-table { width: 100%; border-collapse: collapse; }
  .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
  .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
  .huella-sello-value-cell { color: #2d3436; }
  .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
  .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 12px; }
  .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
  /* --- Fin sello biométrico --- */
  .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
  @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
</style></head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — Formulario de Campo</h1>
    <p><strong>ID:</strong> ${escapeHtml(f.id)} | <strong>Tipo:</strong> ${f.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Plantación'} | <strong>Fecha:</strong> ${formatFecha(f.created_at)}</p>
  </div>

  <div class="section">
    <h2>👤 Datos del Técnico</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.tecnico.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.tecnico.cedula)}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.tecnico.telefono || '—')}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${escapeHtml(f.tecnico.email || '—')}</span></div>
  </div>

  <div class="section">
    <h2>👥 Datos del Beneficiario</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.beneficiario.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.beneficiario.cedula || '—')}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.beneficiario.telefono || '—')}</span></div>
    <div class="row"><span class="label">Departamento:</span><span class="value">${escapeHtml(f.beneficiario.departamento || '—')}</span></div>
    <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(f.beneficiario.municipio || '—')}</span></div>
    <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(f.beneficiario.vereda || '—')}</span></div>
    <div class="row"><span class="label">Finca:</span><span class="value">${escapeHtml(f.beneficiario.finca || '—')}</span></div>
  </div>

  <div class="section">
    <h2>📋 Actividad Realizada</h2>
    <div class="row"><span class="label">Tipo:</span><span class="value">${escapeHtml(f.actividad.descripcion || '—')}</span></div>
    ${f.actividad.descripcion_detallada ? `<div class="row"><span class="label">Descripción detallada:</span></div><div class="desc-detallada">${escapeHtml(f.actividad.descripcion_detallada)}</div>` : ''}
    <div class="row" style="margin-top:8px;"><span class="label">Observaciones:</span><span class="value">${escapeHtml(f.actividad.observaciones || '—')}</span></div>
    <div class="row"><span class="label">Recomendaciones:</span><span class="value">${escapeHtml(f.actividad.recomendaciones || '—')}</span></div>
  </div>

  <div class="section">
    <h2>📍 Ubicación Geográfica</h2>
    <div class="row"><span class="label">Latitud:</span><span class="value">${f.coordenadas?.latitud?.toFixed(6) || '—'}</span></div>
    <div class="row"><span class="label">Longitud:</span><span class="value">${f.coordenadas?.longitud?.toFixed(6) || '—'}</span></div>
    ${f.coordenadas?.altitud ? `<div class="row"><span class="label">Altitud:</span><span class="value">${f.coordenadas.altitud.toFixed(1)} m</span></div>` : ''}
    ${f.coordenadas?.precision_gps ? `<div class="row"><span class="label">Precisión:</span><span class="value">±${f.coordenadas.precision_gps} m</span></div>` : ''}
  </div>

  ${f.clima?.actual ? `
  <div class="section">
    <h2>🌤 Condiciones Ambientales</h2>
    <div class="row"><span class="label">Ubicación:</span><span class="value">${escapeHtml(f.clima.actual.ubicacion?.nombre || f.clima.ubicacion?.latitud?.toFixed(4) + ', ' + f.clima.ubicacion?.longitud?.toFixed(4) || '—')}</span></div>
    <div class="row"><span class="label">Temperatura:</span><span class="value">${f.clima.actual.temperatura?.actual != null ? Math.round(f.clima.actual.temperatura.actual) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Sensación térmica:</span><span class="value">${f.clima.actual.temperatura?.sensacion_termica != null ? Math.round(f.clima.actual.temperatura.sensacion_termica) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Humedad:</span><span class="value">${f.clima.actual.humedad != null ? f.clima.actual.humedad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Viento:</span><span class="value">${f.clima.actual.viento?.velocidad != null ? Math.round(f.clima.actual.viento.velocidad) + ' m/s' : '—'}</span></div>
    <div class="row"><span class="label">Nubosidad:</span><span class="value">${f.clima.actual.nubosidad != null ? f.clima.actual.nubosidad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Presión:</span><span class="value">${f.clima.actual.presion != null ? f.clima.actual.presion + ' hPa' : '—'}</span></div>
    <div class="row"><span class="label">Visibilidad:</span><span class="value">${f.clima.actual.visibilidad != null ? f.clima.actual.visibilidad + ' km' : '—'}</span></div>
  </div>
  ` : ''}

  <!-- EVIDENCIAS AL FINAL (como documentos oficiales) -->
  <div class="section">
    <h2>📸 Evidencias de Campo</h2>

    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    <div class="firmas-contiguo">
      ${firmaBenefHtml}
      ${firmaTecHtml}
    </div>

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
</body></html>`;
  };

  // Helper escapeHtml
  function escapeHtml(text: string): string {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  const handleViewPDF = async () => {
    if (formulario.pdf_url) {
      const url = formulario.pdf_url.startsWith('http')
        ? formulario.pdf_url
        : `http://192.168.1.20:8089${formulario.pdf_url}`;
      // Descargar PDF remoto para mostrarlo embebido en lugar de abrir navegador
      setGeneratingPdf(true);
      try {
        const { uri: localUri } = await FileSystem.downloadAsync(url, FileSystem.documentDirectory + 'pdf_preview.pdf');
        setPdfUri(localUri);
        setShowPdf(true);
      } catch {
        // Fallback: abrir en navegador si no se puede descargar
        try {
          await Linking.openURL(url);
        } catch {
          Alert.alert('Error', 'No se pudo abrir el PDF');
        }
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }

    // Generar PDF local con expo-print y mostrarlo embebido
    setGeneratingPdf(true);
    try {
      const html = await generarHtml();
      const { uri } = await Print.printToFileAsync({ html });
      setPdfUri(uri);
      setShowPdf(true);
    } catch (e) {
      Alert.alert('Error', 'No se pudo generar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleClosePdf = () => {
    setShowPdf(false);
    setPdfUri(null);
  };

  const handleSharePDF = async () => {
    if (!pdfUri) {
      // Si no hay pdfUri, generar primero
      setGeneratingPdf(true);
      try {
        const html = await generarHtml();
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
        }
      } catch {
        Alert.alert('Error', 'No se pudo generar el PDF');
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfUri);
    } else {
      Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
    }
  };

  const handleDownloadPDF = async () => {
    setGeneratingPdf(true);
    try {
      const html = await generarHtml();
      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('PDF generado', `PDF disponible en: ${uri}`);
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo descargar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const evidenciaCount = [
    ...(formulario.fotos || []),
    ...(formulario.firma_beneficiario ? [true] : []),
    ...(formulario.firma_tecnico ? [true] : []),
    ...(formulario.huella_beneficiario ? [true] : []),
  ].length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xxl }]}>
        {/* Estado del formulario */}
        <View style={styles.statusBar}>
          <Text style={styles.statusTipo}>
            {formulario.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Plantación'}
          </Text>
          <Text style={[styles.statusSync, formulario.sincronizado && styles.statusSyncOk]}>
            {formulario.sincronizado ? '✓ Sincronizado' : '⏳ Pendiente'}
          </Text>
        </View>

        {/* Resumen de evidencias */}
        <View style={styles.evidenciasSummary}>
          <Text style={styles.evidenciasSummaryTitle}>📸 Evidencias ({evidenciaCount})</Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {formulario.fotos?.filter(f => f.tipo !== 'video').length || 0} foto(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {formulario.fotos?.filter(f => f.tipo === 'video').length || 0} video(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma beneficiario: {formulario.firma_beneficiario ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma técnico: {formulario.firma_tecnico ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Huella biométrica: {formulario.huella_beneficiario ? '✓' : '✗'}
          </Text>
        </View>

        {/* Fotos/Videos en miniatura */}
        {formulario.fotos && formulario.fotos.length > 0 && (
          <View style={styles.fotosSection}>
            <Text style={styles.sectionTitle}>Evidencias capturadas ({formulario.fotos.length})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {formulario.fotos.map((foto) => (
                <View key={foto.id} style={styles.fotoThumbContainer}>
                  {foto.tipo === 'video' ? (
                    <View style={styles.videoThumb}>
                      <Text style={styles.videoThumbIcon}>▶️</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: foto.uri }}
                      style={styles.fotoThumb}
                    />
                  )}
                  {foto.tipo === 'video' && (
                    <Text style={styles.videoThumbLabel}>🎥</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Datos del Técnico */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Datos del Técnico</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.tecnico.nombre}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.tecnico.cedula}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.tecnico.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email:</Text><Text style={styles.value}>{formulario.tecnico.email || '—'}</Text></View>
        </View>

        {/* Datos del Beneficiario */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👥 Datos del Beneficiario</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.beneficiario.nombre}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.beneficiario.cedula || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.beneficiario.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Depto:</Text><Text style={styles.value}>{formulario.beneficiario.departamento || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Municipio:</Text><Text style={styles.value}>{formulario.beneficiario.municipio || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Vereda:</Text><Text style={styles.value}>{formulario.beneficiario.vereda || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Finca:</Text><Text style={styles.value}>{formulario.beneficiario.finca || '—'}</Text></View>
        </View>

        {/* Actividad */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 Actividad Realizada</Text>
          <View style={styles.row}><Text style={styles.label}>Descripción:</Text><Text style={styles.value}>{formulario.actividad.descripcion || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Observaciones:</Text><Text style={styles.value}>{formulario.actividad.observaciones || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Recomendaciones:</Text><Text style={styles.value}>{formulario.actividad.recomendaciones || '—'}</Text></View>
        </View>

        {/* Coordenadas */}
        {formulario.coordenadas && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Ubicación</Text>
            <View style={styles.row}><Text style={styles.label}>Latitud:</Text><Text style={styles.value}>{formulario.coordenadas.latitud.toFixed(6)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Longitud:</Text><Text style={styles.value}>{formulario.coordenadas.longitud.toFixed(6)}</Text></View>
            {formulario.coordenadas.altitud && (
              <View style={styles.row}><Text style={styles.label}>Altitud:</Text><Text style={styles.value}>{formulario.coordenadas.altitud.toFixed(1)} m</Text></View>
            )}
          </View>
        )}

        {/* Fecha */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Fechas</Text>
          <View style={styles.row}><Text style={styles.label}>Creado:</Text><Text style={styles.value}>{formatFecha(formulario.created_at)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Actualizado:</Text><Text style={styles.value}>{formatFecha(formulario.updated_at)}</Text></View>
        </View>
      </ScrollView>

      {/* 📄 Visor PDF embebido */}
      {showPdf && pdfUri && (
        <View style={[styles.pdfEmbedContainer, { height: PDF_HEIGHT }]}>
          <View style={styles.pdfEmbedHeader}>
            <Text style={styles.pdfEmbedTitle}>📄 Vista previa del PDF</Text>
            <View style={styles.pdfEmbedActions}>
              <TouchableOpacity onPress={handleSharePDF} style={styles.pdfEmbedActionBtn}>
                <Text style={styles.pdfEmbedActionText}>Compartir</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClosePdf} style={styles.pdfEmbedCloseBtn}>
                <Text style={styles.pdfEmbedCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <WebView
            source={{ uri: pdfUri }}
            style={styles.webview}
            originWhitelist={['file://', 'http://', 'https://']}
            allowFileAccess={true}
            javaScriptEnabled={false}
            scalesPageToFit={Platform.OS === 'android'}
          />
        </View>
      )}

      {/* Botones inferiores */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity
          style={styles.pdfButton}
          onPress={showPdf ? handleClosePdf : handleViewPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.pdfButtonText}>
            {generatingPdf ? 'Generando...' : showPdf ? '✕ Cerrar PDF' : '📄 Ver PDF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.downloadButton}
          onPress={handleDownloadPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.downloadButtonText}>
            {generatingPdf ? 'Generando...' : '⬇️ Descargar PDF'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  statusTipo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusSync: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
  },
  statusSyncOk: {
    color: COLORS.success,
  },
  evidenciasSummary: {
    backgroundColor: COLORS.info + '12',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  evidenciasSummaryTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.info,
    marginBottom: SPACING.xs,
  },
  evidenciasSummaryItem: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginLeft: SPACING.sm,
  },
  fotosSection: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  fotoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    marginRight: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
  },
  fotoThumbContainer: {
    position: 'relative',
    marginRight: SPACING.sm,
  },
  videoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbIcon: {
    fontSize: 32,
  },
  videoThumbLabel: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    fontSize: 16,
  },
  section: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    width: 110,
  },
  value: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  pdfButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  downloadButton: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  downloadButtonText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  // ---- Visor PDF embebido ----
  pdfEmbedContainer: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfEmbedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  pdfEmbedTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  pdfEmbedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pdfEmbedActionBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '20',
    borderRadius: BORDER_RADIUS.sm,
  },
  pdfEmbedActionText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  pdfEmbedCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.error + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfEmbedCloseText: {
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
});

export default FormularioDetailScreen;
