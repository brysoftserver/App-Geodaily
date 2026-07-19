// ============================================================
// GEODAILY — Navegación Módulo Terreno (Técnico de Campo)
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import TerrenoMenuScreen from '../screens/terreno/TerrenoMenuScreen';
import BeneficiariosListScreen from '../screens/terreno/BeneficiariosListScreen';
import BeneficiarioDetailScreen from '../screens/terreno/BeneficiarioDetailScreen';
import SeleccionarTipoFormulario from '../screens/terreno/SeleccionarTipoFormulario';
import FormularioScreen from '../screens/terreno/FormularioScreen';
import FormularioCaracterizacionScreen from '../screens/terreno/FormularioCaracterizacionScreen';
import CamaraScreen from '../screens/terreno/CamaraScreen';
import DocumentosScreen from '../screens/terreno/DocumentosScreen';
import FirmaDigitalScreen from '../screens/terreno/FirmaDigitalScreen';
import FirmaBeneficiarioScreen from '../screens/terreno/FirmaBeneficiarioScreen';
import FirmaBiometricaScreen from '../screens/terreno/FirmaBiometricaScreen';
import FormularioListScreen from '../screens/terreno/FormularioListScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';
import FormulariosIncompletosScreen from '../screens/terreno/FormulariosIncompletosScreen';
import CalendarioScreen from '../screens/CalendarioGlobalScreen';
import MapaScreen from '../screens/terreno/MapaScreen';
import CapacitacionScreen from '../screens/terreno/CapacitacionScreen';
import { TipoFormulario, DatosBeneficiario, Formulario } from '../types';

export type TerrenoStackParamList = {
  TerrenoMenu: undefined;
  BeneficiariosList: undefined;
  BeneficiarioDetail: {
    beneficiario: DatosBeneficiario;
    visitas: Formulario[];
  };
  SeleccionarTipoFormulario: {
    beneficiario?: DatosBeneficiario;
  } | undefined;
  Formulario: { tipo: TipoFormulario; draftId?: string };
  FormularioCaracterizacion: { draftId?: string };
  Camara: { mode?: 'photo' | 'video' };
  Documentos: { beneficiarioCedula?: string; beneficiarioNombre?: string } | undefined;
  FirmaDigital: undefined;
  FirmaBeneficiario: undefined;
  FirmaBiometrica: undefined;
  TerrenoFormularioList: {
    beneficiarioCedula?: string;
  } | undefined;
  FormularioDetail: { formulario: Formulario };
  FormulariosIncompletos: undefined;
  TerrenoCalendario: undefined;
  TerrenoMapa: undefined;
  TerrenoCapacitacion: undefined;
};

const Stack = createNativeStackNavigator<TerrenoStackParamList>();

const TerrenoNavigator: React.FC = () => {
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
        name="TerrenoMenu"
        component={TerrenoMenuScreen}
        options={{ title: 'GEODAILY - TERRENO' }}
      />
      <Stack.Screen
        name="BeneficiariosList"
        component={BeneficiariosListScreen}
        options={{ title: 'Mis Beneficiarios' }}
      />
      <Stack.Screen
        name="BeneficiarioDetail"
        component={BeneficiarioDetailScreen}
        options={({ route }: any) => ({
          title: route.params?.beneficiario?.nombre || 'Beneficiario',
        })}
      />
      <Stack.Screen
        name="SeleccionarTipoFormulario"
        component={SeleccionarTipoFormulario as any}
        options={{ title: 'Nuevo Formulario' }}
      />
      <Stack.Screen
        name="Formulario"
        component={FormularioScreen as any}
        options={{ title: 'Formulario de Campo' }}
      />
      <Stack.Screen
        name="FormularioCaracterizacion"
        component={FormularioCaracterizacionScreen as any}
        options={{ title: 'Caracterización Sociodemográfica' }}
      />
      <Stack.Screen
        name="Camara"
        component={CamaraScreen as any}
        options={{ title: 'Evidencia Fotográfica' }}
      />
      <Stack.Screen
        name="Documentos"
        component={DocumentosScreen}
        options={{ title: 'Documentos de la Finca' }}
      />
      <Stack.Screen
        name="FirmaDigital"
        component={FirmaDigitalScreen}
        options={{ title: 'Firma del Técnico' }}
      />
      <Stack.Screen
        name="FirmaBeneficiario"
        component={FirmaBeneficiarioScreen}
        options={{ title: 'Firma del Beneficiario' }}
      />
      <Stack.Screen
        name="FirmaBiometrica"
        component={FirmaBiometricaScreen}
        options={{ title: 'Registro Biométrico' }}
      />
      <Stack.Screen
        name="TerrenoFormularioList"
        component={FormularioListScreen as any}
        options={{ title: 'Historial' }}
      />
      <Stack.Screen
        name="FormularioDetail"
        component={FormularioDetailScreen as any}
        options={{ title: 'Detalle del Formulario' }}
      />
      <Stack.Screen
        name="FormulariosIncompletos"
        component={FormulariosIncompletosScreen}
        options={{ title: 'Formularios Incompletos' }}
      />
      <Stack.Screen
        name="TerrenoCalendario"
        component={CalendarioScreen}
        options={{ title: 'Calendario' }}
      />
      <Stack.Screen
        name="TerrenoMapa"
        component={MapaScreen}
        options={{ title: 'Mapa y Ubicación' }}
      />
      <Stack.Screen
        name="TerrenoCapacitacion"
        component={CapacitacionScreen}
        options={{ title: 'Capacitaciones' }}
      />
    </Stack.Navigator>
  );
};

export default TerrenoNavigator;
