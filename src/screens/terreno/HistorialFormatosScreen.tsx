// ============================================================
// GEODAILY — Historial de formatos completados de un beneficiario
// ============================================================
// Todo formato cuyo PDF se generó queda aquí para volver a abrirlo o
// compartirlo cuando se necesite: el beneficiario puede firmar varias actas de
// entrega y antes cada PDF se perdía al compartirlo. Los PDF viven en el
// servidor (y en una copia local), así que también se ven desde otro celular.
// ============================================================

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator, Modal, Platform, RefreshControl,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { DatosBeneficiario } from '../../types';
import type { OtroFormatoLocal } from '../../services/database';
import {
  obtenerOtrosFormatosBeneficiario,
  resolverPdfFormato,
  construirHtmlDeFormato,
  etiquetaOtroFormato,
  tituloDocumentoFormato,
  resumenDocumentoFormato,
} from '../../services/otrosFormatos.service';
import PdfViewer from '../../components/PdfViewer';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';

type Props = {
  route?: { params?: { beneficiario?: DatosBeneficiario } };
};

const HistorialFormatosScreen: React.FC<Props> = ({ route }) => {
  const beneficiario = route?.params?.beneficiario;
  const [formatos, setFormatos] = useState<OtroFormatoLocal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ uri: string; titulo: string; key: string } | null>(null);

  const cargar = useCallback(async () => {
    if (!beneficiario?.cedula) {
      setCargando(false);
      return;
    }
    try {
      setFormatos(await obtenerOtrosFormatosBeneficiario(beneficiario.cedula));
    } catch (e) {
      console.warn('[HistorialFormatos] No se pudo cargar:', e);
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [beneficiario?.cedula]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrir = async (f: OtroFormatoLocal, compartir: boolean) => {
    if (ocupadoId) return;

    // En web la pestaña de impresión debe abrirse SÍNCRONA, antes de cualquier await.
    if (Platform.OS === 'web') {
      const ventana = abrirVentanaDeCarga();
      const html = construirHtmlDeFormato(f.tipo, f.datos || {});
      if (!html) ventana?.close();
      else imprimirHtmlEnVentana(ventana, html);
      return;
    }

    setOcupadoId(f.id);
    try {
      const uri = await resolverPdfFormato(f);
      if (!uri) {
        Alert.alert('Error', 'No se pudo preparar el PDF. Intenta de nuevo.');
        return;
      }
      if (compartir) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
        } else {
          Alert.alert('PDF', `Guardado en: ${uri}`);
        }
      } else {
        setVisor({ uri, titulo: tituloDocumentoFormato(f), key: `${f.id}-${f.updated_at}` });
      }
    } catch (e) {
      console.warn('[HistorialFormatos] Error al abrir:', e);
      Alert.alert('Error', 'No se pudo abrir el PDF.');
    } finally {
      setOcupadoId(null);
    }
  };

  const renderItem = ({ item }: { item: OtroFormatoLocal }) => {
    const etiqueta = etiquetaOtroFormato(item.tipo);
    const resumen = resumenDocumentoFormato(item);
    const ocupado = ocupadoId === item.id;
    const firmadaInterventoria = item.tipo === 'acta_entrega_individual' && !!item.datos?.firmaInterventoria;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.icono}>{etiqueta.icono}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitulo}>{tituloDocumentoFormato(item)}</Text>
            <Text style={styles.cardCodigo}>{etiqueta.codigo}</Text>
            {resumen ? <Text style={styles.cardResumen} numberOfLines={2}>{resumen}</Text> : null}
            {item.tipo === 'acta_entrega_individual' && (
              <Text style={[styles.estado, { color: firmadaInterventoria ? COLORS.success : COLORS.warning }]}>
                {firmadaInterventoria ? '✓ Firmada por interventoría' : '⏳ Pendiente de firma de interventoría'}
              </Text>
            )}
            <Text style={[styles.estado, { color: item.sincronizado ? COLORS.success : COLORS.warning }]}>
              {item.sincronizado ? '☁️ En el servidor' : '📱 Solo en este dispositivo · se subirá con señal'}
            </Text>
          </View>
        </View>
        <View style={styles.acciones}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimario]} onPress={() => abrir(item, false)} disabled={ocupado}>
            {ocupado ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimarioTxt}>👁 Abrir</Text>}
          </TouchableOpacity>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={[styles.btn, styles.btnSecundario]} onPress={() => abrir(item, true)} disabled={ocupado}>
              <Text style={styles.btnSecundarioTxt}>📤 Compartir</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
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
    <View style={styles.container}>
      <FlatList
        data={formatos}
        keyExtractor={(f) => f.id}
        renderItem={renderItem}
        contentContainerStyle={styles.lista}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar(); }} colors={[COLORS.primary]} />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.titulo}>Historial de formatos</Text>
            <Text style={styles.subtitulo}>
              {beneficiario?.nombre ? `${beneficiario.nombre} — ` : ''}documentos completados, listos para abrir o compartir
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.vacio}>
            <Text style={styles.vacioTxt}>Aún no hay formatos completados</Text>
            <Text style={styles.vacioSub}>Cada formato aparece aquí cuando generas su PDF.</Text>
          </View>
        }
      />

      <Modal visible={visor !== null} animationType="slide" onRequestClose={() => setVisor(null)}>
        {visor && (
          <PdfViewer
            archivo={visor.uri}
            titulo={visor.titulo}
            cacheKey={visor.key}
            onClose={() => setVisor(null)}
            onFallback={async () => {
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(visor.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
              }
            }}
          />
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centrado: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  lista: { padding: SPACING.lg },
  titulo: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  subtitulo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary,
    ...SHADOWS.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  icono: { fontSize: 28, marginRight: SPACING.md },
  cardTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  cardCodigo: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginBottom: 2 },
  cardResumen: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, marginBottom: 2 },
  estado: { fontSize: FONTS.sizes.xs, marginTop: 2, fontWeight: FONTS.weights.medium },
  acciones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  btn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  btnPrimario: { backgroundColor: COLORS.primary },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  btnSecundario: { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  btnSecundarioTxt: { color: COLORS.primary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  vacio: { alignItems: 'center', paddingVertical: SPACING.xl },
  vacioTxt: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, fontWeight: FONTS.weights.bold },
  vacioSub: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },
});

export default HistorialFormatosScreen;
