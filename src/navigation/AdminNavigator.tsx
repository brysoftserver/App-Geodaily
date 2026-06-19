// ============================================================
// GEODAILY — Navegación Módulo Administración
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import AdminMenuScreen from '../screens/admin/AdminMenuScreen';
import UserManagementScreen from '../screens/admin/UserManagementScreen';
import SystemConfigScreen from '../screens/admin/SystemConfigScreen';

export type AdminStackParamList = {
  AdminMenu: undefined;
  UserManagement: undefined;
  SystemConfig: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

const AdminNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.surface,
        },
        headerTintColor: COLORS.textPrimary,
        headerTitleStyle: {
          fontWeight: FONTS.weights.semibold,
          fontSize: FONTS.sizes.lg,
        },
        headerShadowVisible: false,
        contentStyle: {
          backgroundColor: COLORS.background,
        },
      }}
    >
      <Stack.Screen
        name="AdminMenu"
        component={AdminMenuScreen}
        options={{ title: 'GEODAILY - ADMIN' }}
      />
      <Stack.Screen
        name="UserManagement"
        component={UserManagementScreen}
        options={{ title: 'Gestión de Usuarios' }}
      />
      <Stack.Screen
        name="SystemConfig"
        component={SystemConfigScreen}
        options={{ title: 'Configuración del Sistema' }}
      />
    </Stack.Navigator>
  );
};

export default AdminNavigator;
