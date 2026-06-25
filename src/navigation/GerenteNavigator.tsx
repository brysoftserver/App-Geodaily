// ============================================================
// GEODAILY — Navegación Módulo Gerencia
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import GerenteMenuScreen from '../screens/gerente/GerenteMenuScreen';
import DashboardGerencialScreen from '../screens/gerente/DashboardGerencialScreen';
import PerfilTecnicosScreen from '../screens/gerente/PerfilTecnicosScreen';
import ConsolidadoScreen from '../screens/gerente/ConsolidadoScreen';
import CronogramaScreen from '../screens/gerente/CronogramaScreen';
import ProyeccionScreen from '../screens/gerente/ProyeccionScreen';
import CapacitacionScreen from '../screens/gerente/CapacitacionScreen';
import MapaTecnicosScreen from '../screens/gerente/MapaTecnicosScreen';

export type GerenteStackParamList = {
  GerenteMenu: undefined;
  DashboardGerencial: undefined;
  PerfilTecnicos: undefined;
  Consolidado: undefined;
  CronogramaGerente: undefined;
  Proyeccion: undefined;
  CapacitacionGerente: undefined;
  MapaTecnicos: undefined;
};

const Stack = createNativeStackNavigator<GerenteStackParamList>();

const GerenteNavigator: React.FC = () => {
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
        name="GerenteMenu"
        component={GerenteMenuScreen}
        options={{ title: 'GEODAILY - GERENCIA' }}
      />
      <Stack.Screen
        name="DashboardGerencial"
        component={DashboardGerencialScreen}
        options={{ title: 'Dashboard Gerencial' }}
      />
      <Stack.Screen
        name="PerfilTecnicos"
        component={PerfilTecnicosScreen}
        options={{ title: 'Perfil de Técnicos' }}
      />
      <Stack.Screen
        name="Consolidado"
        component={ConsolidadoScreen}
        options={{ title: 'Consolidador' }}
      />
      <Stack.Screen
        name="CronogramaGerente"
        component={CronogramaScreen}
        options={{ title: 'Cronograma General' }}
      />
      <Stack.Screen
        name="Proyeccion"
        component={ProyeccionScreen}
        options={{ title: 'Proyección de Producción' }}
      />
      <Stack.Screen
        name="CapacitacionGerente"
        component={CapacitacionScreen}
        options={{ title: 'Capacitación' }}
      />
      <Stack.Screen
        name="MapaTecnicos"
        component={MapaTecnicosScreen}
        options={{ title: 'Mapa de Técnicos' }}
      />
    </Stack.Navigator>
  );
};

export default GerenteNavigator;
