// ============================================================
// GEODAILY — Navegación Módulo Supervisión
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import ActividadesListScreen from '../screens/ActividadesListScreen';
import ActividadDetalleScreen from '../screens/ActividadDetalleScreen';
import ActividadBeneficiarioScreen from '../screens/actividades/ActividadBeneficiarioScreen';
import BitacoraListScreen from '../screens/interventor/BitacoraListScreen';
import BitacoraBeneficiarioScreen from '../screens/interventor/BitacoraBeneficiarioScreen';
import SupervisionMenuScreen from '../screens/supervision/SupervisionMenuScreen';
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
import RevisarAnexosScreen from '../screens/supervision/RevisarAnexosScreen';

export type SupervisionStackParamList = {
  SupervisionMenu: undefined;
  SeguimientoMenu: undefined;
  SeguimientoForm: { seguimientoId?: string } | undefined;
  SeguimientoList: undefined;
  SeguimientoIncompletos: undefined;
  SeguimientoDetail: { seguimientoId: string };
  Dashboard: undefined;
  SupervisionProyeccion: undefined;
  SupervisionVisitasJerarquicas: undefined;
  SupervisionCalendario: undefined;
  MapaGeneral: undefined;
  SupervisionFormularioDetail: { formulario: import('../types').Formulario; modo?: 'online' | 'campo' };
  BaseDatosBeneficiarios: undefined;
  SupervisionPlantacionesPorTecnico: undefined;
  RevisarAnexos: undefined;
  RevisionActividades: { modo?: 'ejecutar' | 'revisar' } | undefined;
  ActividadDetalle: { actividadId: string; modo: 'ejecutar' | 'revisar'; tecnico?: { usuario: string; nombre: string } };
  BitacoraBeneficiarios: undefined;
  BitacoraBeneficiario: { item: number; nombre?: string };
  ActividadBeneficiario: {
    actividadId: string;
    modo: 'ejecutar' | 'revisar';
    beneficiario: { item: number; nombre: string; cedula: string; corregimiento?: string; vereda?: string };
  };
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
        animation: 'slide_from_right',
        animationDuration: 150,
      }}
    >
      <Stack.Screen
        name="SupervisionMenu"
        component={SupervisionMenuScreen}
        options={{ title: 'GEODAILY - SUPERVISIÓN' }}
      />
      <Stack.Screen
        name="SeguimientoMenu"
        component={SeguimientoMenuScreen}
        options={{ title: 'Seguimiento Coordinación' }}
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
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'Dashboard' }}
      />
      <Stack.Screen
        name="SupervisionProyeccion"
        component={ProyeccionScreen}
        options={{ title: 'Proyección de Producción' }}
      />
      <Stack.Screen
        name="SupervisionVisitasJerarquicas"
        component={VisitasJerarquicasScreen}
        options={{ title: 'Listado de técnicos y visitas' }}
      />
      <Stack.Screen
        name="SupervisionFormularioDetail"
        component={FormularioDetailScreen as any}
        options={{ title: 'Detalle del Formulario' }}
      />
      <Stack.Screen
        name="SupervisionCalendario"
        component={CalendarioScreen}
        options={{ title: 'Calendario General' }}
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
        name="SupervisionPlantacionesPorTecnico"
        component={PlantacionesPorTecnicoScreen}
        options={{ title: 'Áreas de Plantación' }}
      />
      <Stack.Screen
        name="RevisarAnexos"
        component={RevisarAnexosScreen}
        options={{ title: 'Revisar Anexos' }}
      />
      <Stack.Screen
        name="RevisionActividades"
        component={ActividadesListScreen}
        initialParams={{ modo: 'revisar' }}
        options={{ title: 'Revisión de Actividades' }}
      />
      <Stack.Screen
        name="ActividadDetalle"
        component={ActividadDetalleScreen}
        options={{ title: 'Actividad' }}
      />
      <Stack.Screen
        name="BitacoraBeneficiarios"
        component={BitacoraListScreen}
        options={{ title: 'Bitácora del Beneficiario' }}
      />
      <Stack.Screen
        name="BitacoraBeneficiario"
        component={BitacoraBeneficiarioScreen}
        options={{ title: 'Bitácora' }}
      />
      <Stack.Screen
        name="ActividadBeneficiario"
        component={ActividadBeneficiarioScreen}
        options={{ title: 'Beneficiario' }}
      />
    </Stack.Navigator>
  );
};

export default SupervisionNavigator;
