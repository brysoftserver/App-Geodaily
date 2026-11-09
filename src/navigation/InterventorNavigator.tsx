// ============================================================
// GEODAILY — Navegación Módulo Interventor
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import ActividadesListScreen from '../screens/ActividadesListScreen';
import ActividadDetalleScreen from '../screens/ActividadDetalleScreen';
import ActividadBeneficiarioScreen from '../screens/actividades/ActividadBeneficiarioScreen';
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
import RevisarAnexosScreen from '../screens/supervision/RevisarAnexosScreen';
import BitacoraListScreen from '../screens/interventor/BitacoraListScreen';
import BitacoraBeneficiarioScreen from '../screens/interventor/BitacoraBeneficiarioScreen';
import VerificacionEntregasMenuScreen from '../screens/interventor/verificaciones/VerificacionEntregasMenuScreen';
import VerificacionMaterialScreen from '../screens/interventor/verificaciones/VerificacionMaterialScreen';
import VerificacionListaScreen from '../screens/interventor/verificaciones/VerificacionListaScreen';
import VerificacionFormScreen from '../screens/interventor/verificaciones/VerificacionFormScreen';

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
  RevisarAnexos: undefined;
  BitacoraBeneficiarios: undefined;
  BitacoraBeneficiario: { item: number; nombre?: string };
  VerificacionEntregas: undefined;
  VerificacionMaterial: { material: string };
  VerificacionLista: { material: string; tipo: 'borradores' | 'completas' };
  VerificacionForm: { material: string; id?: string; soloLectura?: boolean; servidor?: import('../services/verificacionesEntrega.service').VerificacionServidor };
  RevisionActividades: { modo?: 'ejecutar' | 'revisar' } | undefined;
  ActividadDetalle: { actividadId: string; modo: 'ejecutar' | 'revisar'; tecnico?: { usuario: string; nombre: string } };
  ActividadBeneficiario: {
    actividadId: string;
    modo: 'ejecutar' | 'revisar';
    beneficiario: { item: number; nombre: string; cedula: string; corregimiento?: string; vereda?: string };
  };
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
        name="VerificacionEntregas"
        component={VerificacionEntregasMenuScreen}
        options={{ title: 'Verificación de Entregas' }}
      />
      <Stack.Screen
        name="VerificacionMaterial"
        component={VerificacionMaterialScreen}
        options={{ title: 'Verificación' }}
      />
      <Stack.Screen
        name="VerificacionLista"
        component={VerificacionListaScreen}
        options={{ title: 'Verificaciones' }}
      />
      <Stack.Screen
        name="VerificacionForm"
        component={VerificacionFormScreen}
        options={{ title: 'Nueva Verificación' }}
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
        name="ActividadDetalle"
        component={ActividadDetalleScreen}
        options={{ title: 'Actividad' }}
      />
      <Stack.Screen
        name="ActividadBeneficiario"
        component={ActividadBeneficiarioScreen}
        options={{ title: 'Beneficiario' }}
      />
    </Stack.Navigator>
  );
};

export default InterventorNavigator;
