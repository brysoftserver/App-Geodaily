// ============================================================
// GEODAILY — Acta de Entrega vista desde la revisión de entregas
// ============================================================
// Los roles superiores ven el acta de una entrega tal como está en el
// servidor (publicada o borrador respaldado del técnico, con las firmas de
// ambas copias). SOLO el interventor puede firmarla: la firma va al servidor
// (en todas las copias del acta) y le llega al técnico al abrir el acta.
// Nunca cambia el técnico dueño del acta.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import SignaturePad from '../SignaturePad';
import { avisar } from '../../utils/dialogos';
import { useAuth } from '../../store/AuthContext';
import {
  ActaServidor,
  firmarActaEntregaInterventoria,
  obtenerActaServidor,
} from '../../services/otrosFormatos.service';

export interface ActaARevisar {
  cedula: string;
  instancia: string;
  beneficiarioNombre?: string | null;
  titulo: string;
}

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const esFirma = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image');

const ActaEntregaRevision: React.FC<{
  acta: ActaARevisar | null;
  onClose: () => void;
  /** Tras firmar, para refrescar el estado de la lista. */
  onFirmada?: (acta: ActaARevisar) => void;
}> = ({ acta, onClose, onFirmada }) => {
  const insets = useSafeAreaInsets();
  const { user, isInterventor } = useAuth();
  const [cargando, setCargando] = useState(false);
  const [datos, setDatos] = useState<ActaServidor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [cargo, setCargo] = useState('');
  const [firmando, setFirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async (a: ActaARevisar) => {
    setCargando(true);
    setError(null);
    setDatos(null);
    try {
      const r = await obtenerActaServidor(a.cedula, a.instancia);
      setDatos(r);
      setNombre(String(r?.datos?.interventoriaNombre || user?.nombre || ''));
      setCargo(String(r?.datos?.interventoriaCargo || 'Interventor'));
    } catch (e) {
      setError(mensajeError(e, 'No se pudo cargar el acta.'));
    } finally {
      setCargando(false);
    }
  }, [user?.nombre]);

  useEffect(() => {
    if (acta) cargar(acta);
    else setFirmando(false);
  }, [acta, cargar]);

  const guardarFirma = async (firma: string) => {
    if (!acta || guardando) return;
    if (!nombre.trim()) {
      setFirmando(false);
      avisar('Falta el nombre', 'Escribe el nombre de quien firma por la interventoría.');
      return;
    }
    setGuardando(true);
    try {
      const parche = await firmarActaEntregaInterventoria({
        cedula: acta.cedula,
        instancia: acta.instancia,
        firma,
        nombre: nombre.trim(),
        cargo: cargo.trim(),
      });
      setDatos((d) => (d ? { ...d, datos: { ...d.datos, ...parche } } : d));
      setFirmando(false);
      onFirmada?.(acta);
      avisar('Firma registrada', 'La firma de interventoría quedó en el acta. El técnico la verá al abrirla.');
    } catch (e) {
      setFirmando(false);
      avisar('No se pudo firmar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  const d = datos?.datos || {};
  const actividades: any[] = Array.isArray(d.actividades) ? d.actividades.filter((x: any) => String(x?.descripcion || '').trim()) : [];

  const bloqueFirma = (titulo: string, valor: unknown, quien?: string) => (
    <View style={styles.firmaCaja} key={titulo}>
      <Text style={styles.firmaTitulo}>{titulo}</Text>
      {esFirma(valor) ? (
        <Image source={{ uri: valor }} style={styles.firmaImg} resizeMode="contain" />
      ) : (
        <Text style={styles.pendiente}>Pendiente</Text>
      )}
      {quien ? <Text style={styles.dato}>{quien}</Text> : null}
    </View>
  );

  return (
    <Modal visible={acta !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.cabecera}>
          <Text style={styles.cabeceraTitulo} numberOfLines={1}>{firmando ? '🖊️ Firma de la Interventoría' : acta?.titulo || 'Acta'}</Text>
          {!firmando && (
            <TouchableOpacity onPress={onClose} style={styles.cerrar}>
              <Text style={styles.cerrarTxt}>Cerrar</Text>
            </TouchableOpacity>
          )}
        </View>

        {firmando ? (
          <View style={{ flex: 1 }}>
            <SignaturePad description="Firma de la Interventoría" onOK={guardarFirma} />
            {guardando ? (
              <ActivityIndicator style={{ margin: SPACING.md }} color={COLORS.primary} />
            ) : (
              <TouchableOpacity style={[styles.btnSec, { margin: SPACING.md, marginBottom: insets.bottom + SPACING.md }]} onPress={() => setFirmando(false)}>
                <Text style={styles.btnSecTxt}>Cancelar</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : cargando ? (
          <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
        ) : error ? (
          <View style={styles.centro}>
            <Text style={styles.dato}>{error}</Text>
            <TouchableOpacity style={[styles.btnSec, { marginTop: SPACING.md }]} onPress={() => acta && cargar(acta)}>
              <Text style={styles.btnSecTxt}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : !datos ? (
          <View style={styles.centro}>
            <Text style={styles.dato}>
              El acta de esta entrega aún no está en el servidor. Aparecerá aquí cuando el teléfono del técnico sincronice.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.estado, { color: datos.estado === 'publicada' ? COLORS.success : COLORS.warning }]}>
              {datos.estado === 'publicada' ? '✓ Acta completada por el técnico' : '⏳ Borrador del técnico (aún sin completar)'}
            </Text>

            <Text style={styles.seccion}>Beneficiario</Text>
            <Text style={styles.nombre}>{d.nombre || acta?.beneficiarioNombre || '—'}</Text>
            <Text style={styles.dato}>{d.tipoDocumento || 'CC'} {d.cedula || acta?.cedula}</Text>
            <Text style={styles.dato}>
              {[d.predio && `Predio ${d.predio}`, d.vereda && `Vereda ${d.vereda}`, d.corregimiento && `Corregimiento ${d.corregimiento}`].filter(Boolean).join(' · ') || 'Ubicación sin registrar'}
            </Text>

            <Text style={styles.seccion}>Actividades entregadas</Text>
            {actividades.length === 0 ? (
              <Text style={styles.pendiente}>Sin actividades registradas</Text>
            ) : (
              actividades.map((a, i) => (
                <View key={i} style={styles.actividad}>
                  <Text style={styles.datoFuerte}>{a.descripcion}</Text>
                  <Text style={styles.dato}>
                    {[a.actividad && `Actividad ${a.actividad}`, (a.cantidad || a.unidad) && `${a.cantidad || ''} ${a.unidad || ''}`.trim()].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.seccion}>Firmas</Text>
            {bloqueFirma('Beneficiario', d.firmaBeneficiario, d.nombre)}
            {bloqueFirma('Contratista (técnico)', d.firmaTecnico, [d.contratistaNombre, d.contratistaCargo].filter(Boolean).join(' · '))}
            {bloqueFirma('Interventoría', d.firmaInterventoria, [d.interventoriaNombre, d.interventoriaCargo].filter(Boolean).join(' · '))}

            {isInterventor ? (
              <View style={styles.firmarCaja}>
                <Text style={styles.seccion}>Firmar por la interventoría</Text>
                <Text style={styles.label}>Nombre</Text>
                <TextInput style={styles.input} value={nombre} onChangeText={setNombre} placeholder="Nombre" placeholderTextColor={COLORS.textLight} />
                <Text style={styles.label}>Cargo</Text>
                <TextInput style={styles.input} value={cargo} onChangeText={setCargo} placeholder="Cargo" placeholderTextColor={COLORS.textLight} />
                <TouchableOpacity
                  style={styles.btnPrimario}
                  onPress={() => (nombre.trim() ? setFirmando(true) : avisar('Falta el nombre', 'Escribe el nombre de quien firma por la interventoría.'))}
                >
                  <Text style={styles.btnPrimarioTxt}>{esFirma(d.firmaInterventoria) ? '✍️ Cambiar firma de interventoría' : '✍️ Firmar acta'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.dato, { marginTop: SPACING.md }]}>Solo la interventoría puede firmar esta acta.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  cabecera: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cabeceraTitulo: { flex: 1, fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  cerrar: { paddingVertical: 6, paddingHorizontal: SPACING.sm },
  cerrarTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  content: { padding: SPACING.md },
  estado: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, marginBottom: SPACING.sm },
  seccion: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.xs },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1, textAlign: 'left' },
  datoFuerte: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.semibold },
  actividad: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.xs },
  pendiente: { fontSize: FONTS.sizes.sm, color: COLORS.warning, fontWeight: FONTS.weights.semibold },
  firmaCaja: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  firmaTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: 4 },
  firmaImg: { width: '100%', height: 110, backgroundColor: '#fff' },
  firmarCaja: { marginTop: SPACING.sm },
  label: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: 2 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.textPrimary },
  btnPrimario: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  btnSec: { borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  btnSecTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
});

export default ActaEntregaRevision;
