// ============================================================
// GEODAILY — Navegación Módulo Terreno (Técnico de Campo)
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import TerrenoMenuScreen from '../screens/terreno/TerrenoMenuScreen';
import SeleccionarTipoFormulario from '../screens/terreno/SeleccionarTipoFormulario';
import FormularioScreen from '../screens/terreno/FormularioScreen';
import CamaraScreen from '../screens/terreno/CamaraScreen';
import FirmaDigitalScreen from '../screens/terreno/FirmaDigitalScreen';
import FirmaBeneficiarioScreen from '../screens/terreno/FirmaBeneficiarioScreen';
import FirmaBiometricaScreen from '../screens/terreno/FirmaBiometricaScreen';
import FormularioListScreen from '../screens/terreno/FormularioListScreen';
import FormularioDetailScreen from '../screens/terreno/FormularioDetailScreen';
import FormulariosIncompletosScreen from '../screens/terreno/FormulariosIncompletosScreen';
import CalendarioScreen from '../screens/terreno/CalendarioScreen';
import MapaScreen from '../screens/terreno/MapaScreen';
import MiRutaScreen from '../screens/terreno/MiRutaScreen';
import CapacitacionScreen from '../screens/terreno/CapacitacionScreen';
import { TipoFormulario } from '../types';

export type TerrenoStackParamList = {
  TerrenoMenu: undefined;
  SeleccionarTipoFormulario: undefined;
  Formulario: { tipo: TipoFormulario; draftId?: string };
  Camara: undefined;
  FirmaDigital: undefined;
  FirmaBeneficiario: undefined;
  FirmaBiometrica: undefined;
  TerrenoFormularioList: undefined;
  FormularioDetail: { formulario: import('../types').Formulario };
  FormulariosIncompletos: undefined;
  TerrenoCalendario: undefined;
  TerrenoMapa: undefined;
  TerrenoMiRuta: undefined;
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
        contentStyle: {
          backgroundColor: COLORS.background,
        },
      }}
    >
      <Stack.Screen
        name="TerrenoMenu"
        component={TerrenoMenuScreen}
        options={{ title: 'GEODAILY - TERRENO' }}
      />
      <Stack.Screen
        name="SeleccionarTipoFormulario"
        component={SeleccionarTipoFormulario}
        options={{ title: 'Nuevo Formulario' }}
      />
      <Stack.Screen
        name="Formulario"
        component={FormularioScreen as any}
        options={{ title: 'Formulario de Campo' }}
      />
      <Stack.Screen
        name="Camara"
        component={CamaraScreen}
        options={{ title: 'Evidencia Fotográfica' }}
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
        component={FormularioListScreen}
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
        name="TerrenoMiRuta"
        component={MiRutaScreen}
        options={{ title: 'Mi Ruta' }}
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
