// ============================================================
// GEODAILY — Gestión de Usuarios (Admin) — CRUD Completo
// ============================================================

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Image,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, UsuarioBackend } from '../../services/admin.service';
import { cabecerasDeArchivo } from '../../services/archivos.service';

interface UserItem {
  id: string;
  nombre: string;
  usuario: string;
  rol: 'tecnico' | 'supervisor' | 'interventor' | 'gerente' | 'admin';
  email: string;
  telefono: string;
  contrasena_visible?: string;
  avatar_archivo_id?: string | null;
  estado: 'Activo' | 'Inactivo';
  esNuevo?: boolean;
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  tecnico: { label: 'Técnico de Campo', color: COLORS.roleTecnico },
  supervisor: { label: 'Supervisor', color: COLORS.roleSupervisor },
  interventor: { label: 'Interventor', color: COLORS.roleInterventor },
  gerente: { label: 'Gerente', color: COLORS.roleGerente },
  admin: { label: 'Administrador', color: COLORS.roleAdmin },
};

const fromBackend = (u: UsuarioBackend): UserItem => ({
  id: u.id,
  nombre: u.nombre,
  usuario: u.usuario,
  rol: u.rol,
  email: u.email || '',
  telefono: u.telefono || '',
  contrasena_visible: u.contrasena_visible || '',
  avatar_archivo_id: u.avatar_archivo_id || null,
  estado: u.activo ? 'Activo' : 'Inactivo',
});

const UserManagementScreen: React.FC = () => {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRol, setFilterRol] = useState<string>('todos');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<UserItem & { contrasena: string }> | null>(null);
  const [avatarHeaders, setAvatarHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    cabecerasDeArchivo().then(setAvatarHeaders);
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const usuarios = await getUsuarios();
      setUsers(usuarios.map(fromBackend));
    } catch (error) {
      console.error('[UserManagement] Error al cargar usuarios:', error);
      Alert.alert('Error', 'No se pudieron cargar los usuarios. Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.usuario.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRol = filterRol === 'todos' || u.rol === filterRol;
    return matchesSearch && matchesRol;
  });

  const stats = {
    total: users.length,
    activos: users.filter((u) => u.estado === 'Activo').length,
    tecnicos: users.filter((u) => u.rol === 'tecnico').length,
  };

  const openCreateModal = useCallback(() => {
    setEditingUser({
      esNuevo: true,
      nombre: '',
      usuario: '',
      contrasena: '',
      rol: 'tecnico',
      email: '',
      telefono: '',
      estado: 'Activo',
    });
    setModalVisible(true);
  }, []);

  const openEditModal = useCallback((user: UserItem) => {
    setEditingUser({ ...user });
    setModalVisible(true);
  }, []);

  const saveUser = useCallback(async () => {
    if (!editingUser || !editingUser.nombre || !editingUser.usuario) {
      Alert.alert('Campos requeridos', 'Nombre y usuario son obligatorios.');
      return;
    }
    if (editingUser.esNuevo && !editingUser.contrasena) {
      Alert.alert('Campo requerido', 'La contraseña es obligatoria para un usuario nuevo.');
      return;
    }

    try {
      if (editingUser.esNuevo && editingUser.contrasena) {
        await crearUsuario({
          usuario: editingUser.usuario,
          contrasena: editingUser.contrasena,
          nombre: editingUser.nombre,
          rol: editingUser.rol || 'tecnico',
          email: editingUser.email,
          telefono: editingUser.telefono,
        });
      } else if (editingUser.id) {
        const payload: Record<string, any> = {
          nombre: editingUser.nombre,
          email: editingUser.email,
          telefono: editingUser.telefono,
          rol: editingUser.rol,
        };
        if (editingUser.contrasena) {
          payload.contrasena = editingUser.contrasena;
        }
        await actualizarUsuario(editingUser.id, payload);
      }

      await loadUsers();
      setModalVisible(false);
      setEditingUser(null);
      Alert.alert('✅ Guardado', 'Usuario guardado correctamente.');
    } catch (error: any) {
      const mensaje = error?.response?.data?.error || 'No se pudo guardar el usuario.';
      Alert.alert('Error', mensaje);
    }
  }, [editingUser, loadUsers]);

  const toggleUserStatus = useCallback(async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    try {
      await actualizarUsuario(userId, { activo: user.estado !== 'Activo' });
      await loadUsers();
    } catch (error) {
      console.error('[UserManagement] Error al cambiar estado:', error);
      Alert.alert('Error', 'No se pudo cambiar el estado del usuario.');
    }
  }, [users, loadUsers]);

  const deleteUser = useCallback((userId: string) => {
    Alert.alert('Desactivar usuario', '¿Estás seguro de desactivar este usuario? No podrá iniciar sesión, pero su historial se conserva.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desactivar',
        style: 'destructive',
        onPress: async () => {
          try {
            await eliminarUsuario(userId);
            await loadUsers();
          } catch (error) {
            console.error('[UserManagement] Error al desactivar:', error);
            Alert.alert('Error', 'No se pudo desactivar el usuario.');
          }
        },
      },
    ]);
  }, [loadUsers]);

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.emptyText}>Cargando usuarios...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Stats bar */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: COLORS.success }]}>{stats.activos}</Text>
          <Text style={styles.statLabel}>Activos</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: COLORS.roleTecnico }]}>{stats.tecnicos}</Text>
          <Text style={styles.statLabel}>Técnicos</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Filter */}
      <View style={styles.filterRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar por nombre, usuario o email..."
          placeholderTextColor={COLORS.textLight}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={true}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        {['todos', 'tecnico', 'supervisor', 'interventor', 'gerente', 'admin'].map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.chip, filterRol === r && styles.chipActive]}
            onPress={() => setFilterRol(r)}
          >
            <Text style={[styles.chipText, filterRol === r && styles.chipTextActive]}>
              {r === 'todos' ? 'Todos' : ROLE_CONFIG[r]?.label || r}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* User list */}
      <ScrollView contentContainerStyle={styles.listContent}>
        {filteredUsers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No se encontraron usuarios</Text>
          </View>
        ) : (
          filteredUsers.map((user) => {
            const roleCfg = ROLE_CONFIG[user.rol] || { label: user.rol, color: COLORS.textSecondary };
            return (
              <TouchableOpacity
                key={user.id}
                style={styles.userCard}
                onLongPress={() => toggleUserStatus(user.id)}
                onPress={() => openEditModal(user)}
                activeOpacity={0.7}
              >
                <View style={styles.cardTop}>
                  {user.avatar_archivo_id ? (
                    <Image
                      source={{
                        uri: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.ARCHIVOS}/${user.avatar_archivo_id}/contenido`,
                        headers: avatarHeaders,
                      }}
                      style={[styles.avatar, { borderRadius: 24 }]}
                    />
                  ) : (
                    <ImageBackground source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')} style={[styles.avatar, { overflow: 'hidden' }]} imageStyle={{ borderRadius: 24 }}>
                      <Text style={styles.avatarText}>{user.nombre.charAt(0)}</Text>
                    </ImageBackground>
                  )}
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{user.nombre}</Text>
                    <Text style={styles.userUsername}>@{user.usuario}</Text>
                  </View>
                  <View style={[styles.statusDot, { backgroundColor: user.estado === 'Activo' ? COLORS.success : COLORS.textLight }]} />
                </View>
                <View style={styles.badgesRow}>
                  <View style={[styles.roleBadge, { backgroundColor: roleCfg.color + '20' }]}>
                    <Text style={[styles.roleBadgeText, { color: roleCfg.color }]}>{roleCfg.label}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteUser(user.id)}>
                    <Text style={styles.deleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                </View>
                {user.contrasena_visible ? (
                  <View style={styles.credentialRow}>
                    <Text style={styles.credentialText}>
                      🔑 {user.contrasena_visible}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Create/Edit Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingUser?.esNuevo ? '➕ Nuevo Usuario' : '✏️ Editar Usuario'}
            </Text>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.nombre || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...(prev as UserItem), nombre: t }))}
              placeholder="Nombre completo"
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.fieldLabel}>Usuario *</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.usuario || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...(prev as UserItem), usuario: t }))}
              placeholder="Nombre de usuario"
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="none"
              editable={!!editingUser?.esNuevo}
            />

            {editingUser?.esNuevo && (
              <>
                <Text style={styles.fieldLabel}>Contraseña *</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editingUser?.contrasena || ''}
                  onChangeText={(t) => setEditingUser((prev) => ({ ...prev, contrasena: t }))}
                  placeholder="Contraseña inicial"
                  placeholderTextColor={COLORS.textLight}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {!editingUser?.esNuevo && editingUser?.contrasena_visible ? (
              <>
                <Text style={styles.fieldLabel}>Contraseña actual</Text>
                <View style={styles.currentPasswordBox}>
                  <Text style={styles.currentPasswordText}>{editingUser.contrasena_visible}</Text>
                </View>
                <Text style={styles.fieldLabel}>Nueva contraseña (opcional)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editingUser?.contrasena || ''}
                  onChangeText={(t) => setEditingUser((prev) => ({ ...prev, contrasena: t }))}
                  placeholder="Dejar vacío para mantener la actual"
                  placeholderTextColor={COLORS.textLight}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.email || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...(prev as UserItem), email: t }))}
              placeholder="correo@ejemplo.com"
              placeholderTextColor={COLORS.textLight}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Teléfono</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.telefono || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...(prev as UserItem), telefono: t }))}
              placeholder="Teléfono"
              placeholderTextColor={COLORS.textLight}
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Rol</Text>
            <View style={styles.roleSelector}>
              {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.roleChip,
                    editingUser?.rol === key && { backgroundColor: cfg.color + '20', borderColor: cfg.color },
                  ]}
                  onPress={() => setEditingUser((prev) => ({ ...(prev as UserItem), rol: key as UserItem['rol'] }))}
                >
                  <Text style={[styles.roleChipText, editingUser?.rol === key && { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnSave} onPress={saveUser}>
                <Text style={styles.modalBtnSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  // Stats
  statsRow: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  statNumber: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
  },
  addBtnText: {
    fontSize: 24,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
  },
  // Search
  filterRow: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    ...SHADOWS.sm,
  },
  chipRow: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: SPACING.sm,
  },
  chipRowContent: {
    paddingHorizontal: SPACING.md,
    paddingRight: SPACING.xl,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.textLight,
    marginRight: SPACING.sm,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  chipTextActive: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold },
  // List
  listContent: { flexGrow: 1, padding: SPACING.md, paddingBottom: SPACING.xxl },
  empty: { alignItems: 'center', paddingVertical: SPACING.xl },
  emptyText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  userCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: { color: COLORS.textOnPrimary, fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold },
  userInfo: { flex: 1 },
  userName: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  userUsername: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  roleBadgeText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold },
  deleteIcon: { fontSize: 16 },
  credentialRow: {
    marginTop: SPACING.xs,
    paddingTop: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  credentialText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  currentPasswordBox: {
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  currentPasswordText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontFamily: 'monospace',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginHorizontal: SPACING.md,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  roleSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  roleChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  roleChipText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modalBtnCancelText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  modalBtnSave: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  modalBtnSaveText: { fontSize: FONTS.sizes.md, color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold },
});

export default UserManagementScreen;
