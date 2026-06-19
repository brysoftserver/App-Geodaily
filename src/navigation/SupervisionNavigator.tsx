// ============================================================
// GEODAILY — Navegación Módulo Supervisión
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import SupervisionMenuScreen from '../screens/supervision/SupervisionMenuScreen';
import DashboardScreen from '../screens/supervision/DashboardScreen';
import FormularioListScreen from '../screens/supervision/FormularioListScreen';
import CalendarioScreen from '../screens/supervision/CalendarioScreen';

export type SupervisionStackParamList = {
  SupervisionMenu: undefined;
  Dashboard: undefined;
  SupervisionFormularioList: undefined;
  SupervisionCalendario: undefined;
};

const Stack = createNativeStackNavigator<SupervisionStackParamList>();

const SupervisionNavigator: React.FC = () => {
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
        name="SupervisionMenu"
        component={SupervisionMenuScreen}
        options={{ title: 'GEODAILY - SUPERVISIÓN' }}
      />
      <Stack.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'Dashboard' }}
      />
      <Stack.Screen
        name="SupervisionFormularioList"
        component={FormularioListScreen}
        options={{ title: 'Listado de Visitas' }}
      />
      <Stack.Screen
        name="SupervisionCalendario"
        component={CalendarioScreen}
        options={{ title: 'Calendario General' }}
      />
    </Stack.Navigator>
  );
};

export default SupervisionNavigator;
