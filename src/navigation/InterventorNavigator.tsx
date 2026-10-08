// ============================================================
// GEODAILY — Navegación Módulo Interventor
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import InterventorMenuScreen from '../screens/interventor/InterventorMenuScreen';
import DashboardScreen from '../screens/supervision/DashboardScreen';
import ProyeccionScreen from '../screens/gerente/ProyeccionScreen';
import VisitasJerarquicasScreen from '../screens/supervision/VisitasJerarquicasScreen';
import CalendarioScreen from '../screens/CalendarioGlobalScreen';
import MapaGeneralScreen from '../screens/MapaGeneralScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';
import BaseDatosBeneficiariosScreen from '../screens/supervision/BaseDatosBeneficiariosScreen';
import PlantacionesPorTecnicoScreen from '../screens/supervision/PlantacionesPorTecnicoScreen';
import SeguimientoMenuScreen from '../screens/supervision/SeguimientoMenuScreen';
import SeguimientoFormScreen from '../screens/supervision/SeguimientoFormScreen';
import SeguimientoListScreen from '../screens/supervision/SeguimientoListScreen';
import SeguimientoIncompletosScreen from '../screens/supervision/SeguimientoIncompletosScreen';
import SeguimientoDetailScreen from '../screens/supervision/SeguimientoDetailScreen';

export type InterventorStackParamList = {
  InterventorMenu: undefined;
  SeguimientoMenu: undefined;
  SeguimientoForm: { seguimientoId?: string } | undefined;
  SeguimientoList: undefined;
  SeguimientoIncompletos: undefined;
  SeguimientoDetail: { seguimientoId: string };
  InterventorDashboard: undefined;
  InterventorProyeccion: undefined;
  InterventorVisitasJerarquicas: undefined;
  InterventorCalendario: undefined;
  InterventorMapaGeneral: undefined;
  InterventorFormularioDetail: { formulario: import('../types').Formulario; modo?: 'online' | 'campo' };
  BaseDatosBeneficiarios: undefined;
  InterventorPlantacionesPorTecnico: undefined;
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
        animation: 'slide_from_right',
        animationDuration: 150,
      }}
    >
      <Stack.Screen
        name="InterventorMenu"
        component={InterventorMenuScreen}
        options={{ title: 'GEODAILY - INTERVENTOR' }}
      />
      <Stack.Screen
        name="SeguimientoMenu"
        component={SeguimientoMenuScreen}
        options={{ title: 'Seguimiento Interventoría' }}
      />
      <Stack.Screen
        name="SeguimientoForm"
        component={SeguimientoFormScreen}
        options={{ title: 'Realizar Seguimiento' }}
      />
      <Stack.Screen
        name="SeguimientoList"
        component={SeguimientoListScreen}
        options={{ title: 'Seguimientos Realizados' }}
      />
      <Stack.Screen
        name="SeguimientoIncompletos"
        component={SeguimientoIncompletosScreen}
        options={{ title: 'Seguimientos Incompletos' }}
      />
      <Stack.Screen
        name="SeguimientoDetail"
        component={SeguimientoDetailScreen}
        options={{ title: 'Detalle del Seguimiento' }}
      />
      <Stack.Screen
        name="InterventorDashboard"
        component={DashboardScreen}
        options={{ title: 'Dashboard' }}
      />
      <Stack.Screen
        name="InterventorProyeccion"
        component={ProyeccionScreen}
        options={{ title: 'Proyección de Producción' }}
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
      <Stack.Screen
        name="BaseDatosBeneficiarios"
        component={BaseDatosBeneficiariosScreen}
        options={{ title: 'Base de Datos Beneficiarios' }}
      />
      <Stack.Screen
        name="InterventorPlantacionesPorTecnico"
        component={PlantacionesPorTecnicoScreen}
        options={{ title: 'Áreas de Plantación' }}
      />
    </Stack.Navigator>
  );
};

export default InterventorNavigator;
