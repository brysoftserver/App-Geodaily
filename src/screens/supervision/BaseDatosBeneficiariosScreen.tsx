// ============================================================
// GEODAILY — Base de Datos de Beneficiarios
// Roles: Supervisor, Interventor, Gerente, Admin
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { BeneficiarioDB } from '../../types';
import * as BeneficiariosDB from '../../services/beneficiariosDB.service';
import { getTecnicos, UsuarioBackend } from '../../services/admin.service';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const HEADER_COLORS = ['#1B5E20', '#00695C', '#E65100', '#C62828'];
const ASSIGNED_COLOR = '#E8F5E9';
const ITEM_COLORS = ['#FFFFFF', '#F5F5F5'];

// Anchos fijos de columnas para scroll horizontal
const COL_W = { item: 60, correg: 180, vereda: 170, nombre: 300, cedula: 150, tecnico: 190 };
const TABLE_WIDTH = COL_W.item + COL_W.correg + COL_W.vereda + COL_W.nombre + COL_W.cedula + COL_W.tecnico;

const BaseDatosBeneficiariosScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioDB[]>([]);
  const [tecnicos, setTecnicos] = useState<UsuarioBackend[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal de asignación
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [selectedBeneficiario, setSelectedBeneficiario] = useState<BeneficiarioDB | null>(null);

  // Modal de crear beneficiario
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [newCorregimiento, setNewCorregimiento] = useState('');
  const [newVereda, setNewVereda] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [newCedula, setNewCedula] = useState('');

  // Búsqueda
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await BeneficiariosDB.initBeneficiariosDB();
      // Refrescar el espejo local desde el servidor (fuente de verdad
      // compartida). Si no hay conexión, se sigue con el espejo local.
      await BeneficiariosDB.sincronizarBeneficiariosDesdeServidor();
      const data = await BeneficiariosDB.getBeneficiarios();
      setBeneficiarios(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BaseDatosBeneficiarios] Error cargando datos:', msg);
      Alert.alert('Error', `No se pudieron cargar los beneficiarios: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTecnicos = useCallback(async () => {
    try {
      const tecnicos = await getTecnicos();
      setTecnicos(tecnicos);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BaseDatosBeneficiarios] Error cargando técnicos:', msg);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadTecnicos();
  }, [loadData, loadTecnicos]);

  // Refrescar al focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
      loadTecnicos();
    });
    return unsubscribe;
  }, [navigation, loadData, loadTecnicos]);

  // --- ASIGNAR TÉCNICO ---
  const handleAssign = (beneficiario: BeneficiarioDB) => {
    setSelectedBeneficiario(beneficiario);
    setAssignModalVisible(true);
  };

  const confirmAssign = async (tecnico: UsuarioBackend) => {
    if (!selectedBeneficiario) return;
    try {
      await BeneficiariosDB.assignTecnicoToBeneficiario(
        selectedBeneficiario.item,
        tecnico.id,
        tecnico.nombre
      );
      setAssignModalVisible(false);
      setSelectedBeneficiario(null);
      await loadData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BaseDatosBeneficiarios] Error asignando técnico:', msg);
      Alert.alert('Error', `No se pudo asignar el técnico: ${msg}`);
    }
  };

  const confirmUnassign = async (beneficiario: BeneficiarioDB) => {
    Alert.alert(
      'Desasignar técnico',
      `¿Desasignar técnico de "${beneficiario.nombre_completo}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desasignar',
          style: 'destructive',
          onPress: async () => {
            try {
              await BeneficiariosDB.unassignTecnicoFromBeneficiario(beneficiario.item);
              await loadData();
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  // --- ELIMINAR (long-press) ---
  const handleLongPress = (beneficiario: BeneficiarioDB) => {
    Alert.alert(
      'Eliminar beneficiario',
      `¿Eliminar a "${beneficiario.nombre_completo}" (Item ${beneficiario.item})?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await BeneficiariosDB.deleteBeneficiario(beneficiario.item);
              await loadData();
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  // --- CREAR BENEFICIARIO ---
  const handleCreate = async () => {
    const item = parseInt(newItem, 10);
    if (!item || !newCorregimiento.trim() || !newVereda.trim() || !newNombre.trim()) {
      Alert.alert('Campos incompletos', 'Item, Corregimiento, Vereda y Nombre son obligatorios');
      return;
    }

    try {
      const existing = await BeneficiariosDB.getBeneficiarioByItem(item);
      if (existing) {
        Alert.alert('Error', `Ya existe un beneficiario con el Item ${item}`);
        return;
      }

      await BeneficiariosDB.createBeneficiario({
        item,
        corregimiento: newCorregimiento.trim().toUpperCase(),
        vereda: newVereda.trim(),
        nombre_completo: newNombre.trim(),
        cedula: newCedula.trim(),
      });

      setCreateModalVisible(false);
      resetCreateForm();
      await loadData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BaseDatosBeneficiarios] Error al crear:', msg);
      Alert.alert('Error', `No se pudo crear el beneficiario: ${msg}`);
    }
  };

  const resetCreateForm = () => {
    setNewItem('');
    setNewCorregimiento('');
    setNewVereda('');
    setNewNombre('');
    setNewCedula('');
  };

  // --- FILTRO ---
  const filtered = beneficiarios.filter(b => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.nombre_completo.toLowerCase().includes(q) ||
      b.corregimiento.toLowerCase().includes(q) ||
      b.vereda.toLowerCase().includes(q) ||
      b.cedula.includes(q) ||
      b.item.toString().includes(q)
    );
  });

  // --- RENDER ITEM ---
  const renderItem = ({ item, index }: { item: BeneficiarioDB; index: number }) => {
    const isAssigned = !!item.tecnico_asignado_nombre;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleAssign(item)}
        onLongPress={() => handleLongPress(item)}
        style={[
          styles.itemRow,
          { backgroundColor: isAssigned ? ASSIGNED_COLOR : ITEM_COLORS[index % 2] },
        ]}
      >
        <View style={styles.colItem}>
          <Text style={styles.itemText}>{item.item}</Text>
        </View>
        <View style={styles.colCorreg}>
          <Text style={styles.itemText}>{item.corregimiento}</Text>
        </View>
        <View style={styles.colVereda}>
          <Text style={styles.itemText}>{item.vereda}</Text>
        </View>
        <View style={styles.colNombre}>
          <Text style={styles.itemText} numberOfLines={1}>
            {item.nombre_completo}
          </Text>
        </View>
        <View style={styles.colCedula}>
          <Text style={styles.itemText}>{item.cedula}</Text>
        </View>
        <View style={styles.colTecnico}>
          {isAssigned ? (
            <TouchableOpacity
              onPress={() => confirmUnassign(item)}
              style={styles.assignedBadge}
            >
              <Text style={styles.assignedBadgeText} numberOfLines={1}>
                {item.tecnico_asignado_nombre}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.unassignedText}>—</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + SPACING.xs }]}>
      {/* Barra de búsqueda y botón + */}
      <View style={styles.topBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, vereda, cédula..."
          placeholderTextColor={COLORS.textLight}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            BeneficiariosDB.getNextItem()
              .then(item => {
                setNewItem(item.toString());
                setCreateModalVisible(true);
              })
              .catch(err => {
                console.error('[+] Error al obtener next item:', err);
                setNewItem('301');
                setCreateModalVisible(true);
              });
          }}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Tabla con scroll horizontal para columnas anchas */}
      <ScrollView horizontal style={styles.tableScroll} showsHorizontalScrollIndicator={true}>
        <View style={styles.tableContainer}>
          {/* Cabecera de columnas */}
          <View style={styles.headerRow}>
            <Text style={[styles.headerText, styles.colItem]}>#</Text>
            <Text style={[styles.headerText, styles.colCorreg]}>Corregimiento</Text>
            <Text style={[styles.headerText, styles.colVereda]}>Vereda</Text>
            <Text style={[styles.headerText, styles.colNombre]}>Nombre Completo</Text>
            <Text style={[styles.headerText, styles.colCedula]}>Cédula</Text>
            <Text style={[styles.headerText, styles.colTecnico]}>Técnico</Text>
          </View>

          {/* Lista */}
          {loading ? (
            <View style={[styles.center, { width: TABLE_WIDTH }]}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Cargando beneficiarios...</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.item.toString()}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              nestedScrollEnabled
              ListEmptyComponent={
                <View style={[styles.center, { width: TABLE_WIDTH }]}>
                  <Text style={styles.emptyText}>
                    {search.trim()
                      ? 'No se encontraron beneficiarios con ese filtro'
                      : 'No hay beneficiarios registrados'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Footer con padding para que no quede detrás de la navegación */}
      <View style={{ paddingBottom: insets.bottom }}>
        <Text style={styles.footerText}>
          Total: {filtered.length} beneficiarios
          {'  •  '}Toque para asignar técnico
          {'  •  '}Mantener presionado para eliminar
        </Text>
      </View>

      {/* MODAL — Asignar técnico */}
      <Modal
        visible={assignModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAssignModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Asignar técnico</Text>
            {selectedBeneficiario && (
              <Text style={styles.modalSubtitle}>
                {selectedBeneficiario.nombre_completo} (Item {selectedBeneficiario.item})
              </Text>
            )}

            {selectedBeneficiario?.tecnico_asignado_nombre && (
              <TouchableOpacity
                style={styles.unassignButton}
                onPress={() => {
                  if (selectedBeneficiario) confirmUnassign(selectedBeneficiario);
                }}
              >
                <Text style={styles.unassignButtonText}>
                  ❌ Desasignar: {selectedBeneficiario.tecnico_asignado_nombre}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={styles.sectionLabel}>Técnicos disponibles:</Text>
            <FlatList
              data={tecnicos}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.tecnicoItem}
                  onPress={() => confirmAssign(item)}
                >
                  <Text style={styles.tecnicoName}>{item.nombre}</Text>
                  <Text style={styles.tecnicoDetail}>{item.usuario}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No hay técnicos activos</Text>
              }
              style={styles.tecnicoList}
            />

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setAssignModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL — Crear beneficiario */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nuevo beneficiario</Text>

            <Text style={styles.inputLabel}>Item (número)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: 301"
              placeholderTextColor={COLORS.textLight}
              value={newItem}
              onChangeText={setNewItem}
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Corregimiento</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: RIO NEGRO"
              placeholderTextColor={COLORS.textLight}
              value={newCorregimiento}
              onChangeText={setNewCorregimiento}
              autoCapitalize="characters"
            />

            <Text style={styles.inputLabel}>Vereda</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Siberia Baja"
              placeholderTextColor={COLORS.textLight}
              value={newVereda}
              onChangeText={setNewVereda}
            />

            <Text style={styles.inputLabel}>Nombre Completo</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Juan Pérez"
              placeholderTextColor={COLORS.textLight}
              value={newNombre}
              onChangeText={setNewNombre}
            />

            <Text style={styles.inputLabel}>Cédula</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: 123456789"
              placeholderTextColor={COLORS.textLight}
              value={newCedula}
              onChangeText={setNewCedula}
              keyboardType="numeric"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setCreateModalVisible(false);
                  resetCreateForm();
                }}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleCreate}>
                <Text style={styles.saveButtonText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  addButtonText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: FONTS.weights.bold,
    lineHeight: 26,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 0,
    width: TABLE_WIDTH,
  },
  headerText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
    textAlign: 'center',
  },
  // Columnas con ancho fijo (scroll horizontal)
  colItem: { width: COL_W.item, alignItems: 'center', paddingHorizontal: 2 },
  colCorreg: { width: COL_W.correg, paddingHorizontal: 4 },
  colVereda: { width: COL_W.vereda, paddingHorizontal: 4 },
  colNombre: { width: COL_W.nombre, paddingHorizontal: 4 },
  colCedula: { width: COL_W.cedula, paddingHorizontal: 4 },
  colTecnico: { width: COL_W.tecnico, alignItems: 'center', paddingHorizontal: 2 },
  tableScroll: {
    flex: 1,
  },
  tableContainer: {
    width: TABLE_WIDTH,
  },
  listContent: {
    paddingBottom: SPACING.xxl,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.divider,
    minHeight: 44,
    width: TABLE_WIDTH,
  },
  itemText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  assignedBadge: {
    backgroundColor: COLORS.success,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: '100%',
  },
  assignedBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: FONTS.weights.medium,
  },
  unassignedText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  footerText: {
    fontSize: 10,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surfaceAlt,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  modalSubtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  sectionLabel: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  unassignButton: {
    backgroundColor: COLORS.error + '15',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  unassignButtonText: {
    color: COLORS.error,
    fontWeight: FONTS.weights.medium,
    fontSize: FONTS.sizes.md,
  },
  tecnicoList: {
    maxHeight: 300,
  },
  tecnicoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.divider,
  },
  tecnicoName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  tecnicoDetail: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
  },
  modalCloseButton: {
    marginTop: SPACING.md,
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalCloseText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
  },
  // Form inputs
  inputLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: 2,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  cancelButton: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
  },
  saveButton: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
  },
});

export default BaseDatosBeneficiariosScreen;
