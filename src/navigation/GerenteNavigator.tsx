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
import CalendarioScreen from '../screens/CalendarioGlobalScreen';
import ProyeccionScreen from '../screens/gerente/ProyeccionScreen';
import CapacitacionScreen from '../screens/gerente/CapacitacionScreen';
import MapaTecnicosScreen from '../screens/gerente/MapaTecnicosScreen';
import MapaGeneralScreen from '../screens/MapaGeneralScreen';
import BaseDatosBeneficiariosScreen from '../screens/supervision/BaseDatosBeneficiariosScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';
import PlantacionesPorTecnicoScreen from '../screens/supervision/PlantacionesPorTecnicoScreen';

export type GerenteStackParamList = {
  GerenteMenu: undefined;
  DashboardGerencial: undefined;
  PerfilTecnicos: undefined;
  Consolidado: undefined;
  CronogramaGerente: undefined;
  Proyeccion: undefined;
  CapacitacionGerente: undefined;
  MapaTecnicos: undefined;
  MapaGeneral: undefined;
  BaseDatosBeneficiarios: undefined;
  SupervisionFormularioDetail: { formulario: import('../types').Formulario };
  GerentePlantacionesPorTecnico: undefined;
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
        animation: 'slide_from_right',
        animationDuration: 150,
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
        component={CalendarioScreen}
        options={{ title: 'Calendario General' }}
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
      <Stack.Screen
        name="MapaGeneral"
        component={MapaGeneralScreen}
        options={{ title: 'Mapa General del Proyecto' }}
      />
      <Stack.Screen
        name="BaseDatosBeneficiarios"
        component={BaseDatosBeneficiariosScreen}
        options={{ title: 'Base de Datos Beneficiarios' }}
      />
      <Stack.Screen
        name="SupervisionFormularioDetail"
        component={FormularioDetailScreen as any}
        options={{ title: 'Detalle del Formulario' }}
      />
      <Stack.Screen
        name="GerentePlantacionesPorTecnico"
        component={PlantacionesPorTecnicoScreen}
        options={{ title: 'Áreas de Plantación' }}
      />
    </Stack.Navigator>
  );
};

export default GerenteNavigator;
