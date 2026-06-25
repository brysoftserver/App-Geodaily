// ============================================================
// GEODAILY — Gestión de Usuarios (Admin) — CRUD Completo
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

interface UserItem {
  id: string;
  nombre: string;
  usuario: string;
  rol: 'tecnico' | 'supervisor' | 'gerente' | 'admin';
  email: string;
  telefono: string;
  estado: 'Activo' | 'Inactivo';
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  tecnico: { label: 'Técnico de Campo', color: COLORS.roleTecnico },
  supervisor: { label: 'Supervisor', color: COLORS.roleSupervisor },
  gerente: { label: 'Gerente', color: COLORS.roleGerente },
  admin: { label: 'Administrador', color: COLORS.roleAdmin },
};

const INITIAL_USERS: UserItem[] = [
  { id: 'tec-001', nombre: 'Carlos Martínez', usuario: 'tecnico1', rol: 'tecnico', email: 'carlos@geodaily.app', telefono: '3151234567', estado: 'Activo' },
  { id: 'sup-001', nombre: 'María Gómez', usuario: 'supervisor1', rol: 'supervisor', email: 'maria@geodaily.app', telefono: '3157654321', estado: 'Activo' },
  { id: 'ger-001', nombre: 'Pedro Ramírez', usuario: 'gerente1', rol: 'gerente', email: 'pedro@geodaily.app', telefono: '3105550199', estado: 'Activo' },
  { id: 'adm-001', nombre: 'Admin GEODAILY', usuario: 'admin1', rol: 'admin', email: 'admin@geodaily.app', telefono: '3109876543', estado: 'Activo' },
];

const UserManagementScreen: React.FC = () => {
  const [users, setUsers] = useState<UserItem[]>(INITIAL_USERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRol, setFilterRol] = useState<string>('todos');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<UserItem> | null>(null);

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
      id: `usr-${Date.now()}`,
      nombre: '',
      usuario: '',
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

  const saveUser = useCallback(() => {
    if (!editingUser || !editingUser.nombre || !editingUser.usuario) {
      Alert.alert('Campos requeridos', 'Nombre y usuario son obligatorios.');
      return;
    }

    setUsers((prev) => {
      const idx = prev.findIndex((u) => u.id === editingUser.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = editingUser as UserItem;
        return updated;
      }
      return [...prev, editingUser as UserItem];
    });

    setModalVisible(false);
    setEditingUser(null);
    Alert.alert('✅ Guardado', 'Usuario guardado correctamente.');
  }, [editingUser]);

  const toggleUserStatus = useCallback((userId: string) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? { ...u, estado: u.estado === 'Activo' ? 'Inactivo' : 'Activo' }
          : u
      )
    );
  }, []);

  const deleteUser = useCallback((userId: string) => {
    Alert.alert('Eliminar usuario', '¿Estás seguro de eliminar este usuario?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => setUsers((prev) => prev.filter((u) => u.id !== userId)),
      },
    ]);
  }, []);

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {['todos', 'tecnico', 'supervisor', 'gerente', 'admin'].map((r) => (
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
                  <View style={[styles.avatar, { backgroundColor: roleCfg.color }]}>
                    <Text style={styles.avatarText}>{user.nombre.charAt(0)}</Text>
                  </View>
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
              {editingUser && users.some((u) => u.id === editingUser.id)
                ? '✏️ Editar Usuario'
                : '➕ Nuevo Usuario'}
            </Text>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.nombre || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...prev!, nombre: t }))}
              placeholder="Nombre completo"
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.fieldLabel}>Usuario *</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.usuario || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...prev!, usuario: t }))}
              placeholder="Nombre de usuario"
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.email || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...prev!, email: t }))}
              placeholder="correo@ejemplo.com"
              placeholderTextColor={COLORS.textLight}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Teléfono</Text>
            <TextInput
              style={styles.modalInput}
              value={editingUser?.telefono || ''}
              onChangeText={(t) => setEditingUser((prev) => ({ ...prev!, telefono: t }))}
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
                  onPress={() => setEditingUser((prev) => ({ ...prev!, rol: key as UserItem['rol'] }))}
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
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold },
  // List
  listContent: { padding: SPACING.md, paddingBottom: SPACING.xl },
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
