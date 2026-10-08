// ============================================================
// GEODAILY — Navegación Módulo Administración
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import AdminMenuScreen from '../screens/admin/AdminMenuScreen';
import UserManagementScreen from '../screens/admin/UserManagementScreen';
import SystemConfigScreen from '../screens/admin/SystemConfigScreen';
import ConfiguracionIAScreen from '../screens/admin/ConfiguracionIAScreen';
import MapaGeneralScreen from '../screens/MapaGeneralScreen';
import DashboardScreen from '../screens/supervision/DashboardScreen';
import VisitasJerarquicasScreen from '../screens/supervision/VisitasJerarquicasScreen';
import CoordinadoresJerarquicasScreen from '../screens/supervision/CoordinadoresJerarquicasScreen';
import SeguimientoDetailScreen from '../screens/supervision/SeguimientoDetailScreen';
import CalendarioScreen from '../screens/CalendarioGlobalScreen';
import ProyeccionScreen from '../screens/gerente/ProyeccionScreen';
import PerfilTecnicosScreen from '../screens/gerente/PerfilTecnicosScreen';
import ConsolidadoScreen from '../screens/gerente/ConsolidadoScreen';
import CapacitacionScreen from '../screens/gerente/CapacitacionScreen';
import MapaTecnicosScreen from '../screens/gerente/MapaTecnicosScreen';
import DashboardGerencialScreen from '../screens/gerente/DashboardGerencialScreen';
import PlantacionesPorTecnicoScreen from '../screens/supervision/PlantacionesPorTecnicoScreen';
import SupervisionFormularioListScreen from '../screens/supervision/FormularioListScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';
import BaseDatosBeneficiariosScreen from '../screens/supervision/BaseDatosBeneficiariosScreen';

export type AdminStackParamList = {
  AdminMenu: undefined;
  UserManagement: undefined;
  SystemConfig: undefined;
  ConfiguracionIA: undefined;
  AdminDashboard: undefined;
  AdminProyeccion: undefined;
  AdminVisitasJerarquicas: undefined;
  AdminCoordinadoresJerarquicas: undefined;
  AdminSeguimientoDetail: { seguimientoId: string };
  AdminCalendario: undefined;
  AdminFormularioList: undefined;
  MapaGeneral: undefined;
  SupervisionFormularioDetail: { formulario: import('../types').Formulario; modo?: 'online' | 'campo' };
  BaseDatosBeneficiarios: undefined;
  AdminPerfilTecnicos: undefined;
  AdminConsolidado: undefined;
  AdminCapacitacion: undefined;
  AdminMapaTecnicos: undefined;
  AdminPlantacionesPorTecnico: undefined;
  DashboardGerencial: undefined;
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
        animation: 'slide_from_right',
        animationDuration: 150,
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
      <Stack.Screen
        name="ConfiguracionIA"
        component={ConfiguracionIAScreen}
        options={{ title: 'Configuración de IA' }}
      />
      <Stack.Screen
        name="AdminDashboard"
        component={DashboardScreen}
        options={{ title: 'Dashboard General' }}
      />
      <Stack.Screen
        name="AdminProyeccion"
        component={ProyeccionScreen}
        options={{ title: 'Proyección de Producción' }}
      />
      <Stack.Screen
        name="AdminVisitasJerarquicas"
        component={VisitasJerarquicasScreen}
        options={{ title: 'Listado de técnicos y visitas' }}
      />
      <Stack.Screen
        name="AdminCoordinadoresJerarquicas"
        component={CoordinadoresJerarquicasScreen}
        options={{ title: 'Listado de coordinadores/interventores y visitas' }}
      />
      <Stack.Screen
        name="AdminSeguimientoDetail"
        component={SeguimientoDetailScreen}
        options={{ title: 'Detalle del Seguimiento' }}
      />
      <Stack.Screen
        name="AdminCalendario"
        component={CalendarioScreen}
        options={{ title: 'Calendario General' }}
      />
      <Stack.Screen
        name="AdminFormularioList"
        component={SupervisionFormularioListScreen}
        options={{ title: 'Formularios' }}
      />
      <Stack.Screen
        name="MapaGeneral"
        component={MapaGeneralScreen}
        options={{ title: 'Mapa General del Proyecto' }}
      />
      <Stack.Screen
        name="SupervisionFormularioDetail"
        component={FormularioDetailScreen as any}
        options={{ title: 'Detalle del Formulario' }}
      />
      <Stack.Screen
        name="BaseDatosBeneficiarios"
        component={BaseDatosBeneficiariosScreen}
        options={{ title: 'Base de Datos Beneficiarios' }}
      />
      <Stack.Screen
        name="AdminPerfilTecnicos"
        component={PerfilTecnicosScreen}
        options={{ title: 'Perfil de Técnicos' }}
      />
      <Stack.Screen
        name="AdminConsolidado"
        component={ConsolidadoScreen}
        options={{ title: 'Consolidador' }}
      />
      <Stack.Screen
        name="AdminCapacitacion"
        component={CapacitacionScreen}
        options={{ title: 'Capacitación' }}
      />
      <Stack.Screen
        name="AdminMapaTecnicos"
        component={MapaTecnicosScreen}
        options={{ title: 'Mapa de Técnicos' }}
      />
      <Stack.Screen
        name="AdminPlantacionesPorTecnico"
        component={PlantacionesPorTecnicoScreen}
        options={{ title: 'Áreas de Plantación' }}
      />
      <Stack.Screen
        name="DashboardGerencial"
        component={DashboardGerencialScreen}
        options={{ title: 'Dashboard' }}
      />
    </Stack.Navigator>
  );
};

export default AdminNavigator;
