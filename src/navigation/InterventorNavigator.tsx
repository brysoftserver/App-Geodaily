// ============================================================
// GEODAILY — Navegación Módulo Interventor
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import InterventorMenuScreen from '../screens/interventor/InterventorMenuScreen';
import DashboardScreen from '../screens/supervision/DashboardScreen';
import VisitasJerarquicasScreen from '../screens/supervision/VisitasJerarquicasScreen';
import CalendarioScreen from '../screens/supervision/CalendarioScreen';
import MapaGeneralScreen from '../screens/MapaGeneralScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';

export type InterventorStackParamList = {
  InterventorMenu: undefined;
  InterventorDashboard: undefined;
  InterventorVisitasJerarquicas: undefined;
  InterventorCalendario: undefined;
  InterventorMapaGeneral: undefined;
  InterventorFormularioDetail: { formulario: import('../types').Formulario };
};

const Stack = createNativeStackNavigator<InterventorStackParamList>();

const InterventorNavigator: React.FC = () => {
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
        name="InterventorMenu"
        component={InterventorMenuScreen}
        options={{ title: 'GEODAILY - INTERVENTOR' }}
      />
      <Stack.Screen
        name="InterventorDashboard"
        component={DashboardScreen}
        options={{ title: 'Dashboard' }}
      />
      <Stack.Screen
        name="InterventorVisitasJerarquicas"
        component={VisitasJerarquicasScreen}
        options={{ title: 'Listado de técnicos y visitas' }}
      />
      <Stack.Screen
        name="InterventorCalendario"
        component={CalendarioScreen}
        options={{ title: 'Calendario General' }}
      />
      <Stack.Screen
        name="InterventorMapaGeneral"
        component={MapaGeneralScreen}
        options={{ title: 'Mapa General del Proyecto' }}
      />
      <Stack.Screen
        name="InterventorFormularioDetail"
        component={FormularioDetailScreen as any}
        options={{ title: 'Detalle del Formulario' }}
      />
    </Stack.Navigator>
  );
};

export default InterventorNavigator;
