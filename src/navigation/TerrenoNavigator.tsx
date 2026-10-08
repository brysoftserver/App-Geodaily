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
import SeleccionarVisitaTecnica from '../screens/terreno/SeleccionarVisitaTecnica';
import VisitaTecnicaFormScreen from '../screens/terreno/VisitaTecnicaFormScreen';
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
import OtrosFormatosScreen from '../screens/terreno/OtrosFormatosScreen';
import FormatoIngresoBeneficiariosScreen from '../screens/terreno/FormatoIngresoBeneficiariosScreen';
import ActaCompromisoScreen from '../screens/terreno/ActaCompromisoScreen';
import AutorizacionImagenScreen from '../screens/terreno/AutorizacionImagenScreen';
import AutorizacionImagenMenorScreen from '../screens/terreno/AutorizacionImagenMenorScreen';
import ConsentimientoDatosScreen from '../screens/terreno/ConsentimientoDatosScreen';
import EvaluacionEcaScreen from '../screens/terreno/EvaluacionEcaScreen';
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
  /** Menú de visitas técnicas: un botón por visita. */
  SeleccionarVisitaTecnica: {
    beneficiario?: DatosBeneficiario;
  } | undefined;
  /** Formulario de visita técnica (formato por ítems, v2). */
  VisitaTecnicaForm: {
    visitaNumero?: number;
    draftId?: string;
    beneficiario?: DatosBeneficiario;
  } | undefined;
  Formulario: { tipo: TipoFormulario; draftId?: string };
  FormularioCaracterizacion: { draftId?: string };
  Camara: {
    mode?: 'photo' | 'video';
    requisito?: string;
    // Modo "evidencia dirigida": agregar evidencia a un formulario ya
    // completado desde su detalle, sin tocar el formulario en curso.
    formularioId?: string;
    beneficiarioCedula?: string;
    beneficiarioNombre?: string;
    tipoFormulario?: string;
  };
  Documentos: { beneficiarioCedula?: string; beneficiarioNombre?: string } | undefined;
  FirmaDigital: undefined;
  FirmaBeneficiario: undefined;
  FirmaBiometrica: undefined;
  TerrenoFormularioList: {
    beneficiarioCedula?: string;
  } | undefined;
  FormularioDetail: { formulario: Formulario };
  FormulariosIncompletos: undefined;
  OtrosFormatos: { beneficiario?: DatosBeneficiario } | undefined;
  FormatoIngresoBeneficiarios: undefined;
  ActaCompromiso: { beneficiario?: DatosBeneficiario } | undefined;
  AutorizacionImagen: { beneficiario?: DatosBeneficiario } | undefined;
  AutorizacionImagenMenor: { beneficiario?: DatosBeneficiario } | undefined;
  ConsentimientoDatos: { beneficiario?: DatosBeneficiario } | undefined;
  EvaluacionEca: { beneficiario?: DatosBeneficiario } | undefined;
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
        name="SeleccionarVisitaTecnica"
        component={SeleccionarVisitaTecnica as any}
        options={{ title: 'Visita Técnica' }}
      />
      <Stack.Screen
        name="VisitaTecnicaForm"
        component={VisitaTecnicaFormScreen as any}
        options={({ route }: any) => ({
          title: route?.params?.visitaNumero
            ? `Visita Técnica ${route.params.visitaNumero}`
            : 'Visita Técnica',
        })}
      />
      <Stack.Screen
        name="Formulario"
        component={FormularioScreen as any}
        options={{ title: 'Formulario de Campo' }}
      />
      <Stack.Screen
        name="FormularioCaracterizacion"
        component={FormularioCaracterizacionScreen as any}
        options={{ title: 'Encuesta Social AgroAmbiental' }}
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
        name="OtrosFormatos"
        component={OtrosFormatosScreen as any}
        options={{ title: 'Otros Formatos' }}
      />
      <Stack.Screen
        name="FormatoIngresoBeneficiarios"
        component={FormatoIngresoBeneficiariosScreen}
        options={{ title: 'Ingreso de Beneficiarios' }}
      />
      <Stack.Screen
        name="ActaCompromiso"
        component={ActaCompromisoScreen as any}
        options={{ title: 'Acta de Compromiso' }}
      />
      <Stack.Screen
        name="AutorizacionImagen"
        component={AutorizacionImagenScreen as any}
        options={{ title: 'Autorización Uso de Imagen' }}
      />
      <Stack.Screen
        name="AutorizacionImagenMenor"
        component={AutorizacionImagenMenorScreen as any}
        options={{ title: 'Autorización — Menores de Edad' }}
      />
      <Stack.Screen
        name="ConsentimientoDatos"
        component={ConsentimientoDatosScreen as any}
        options={{ title: 'Consentimiento y Tratamiento de Datos' }}
      />
      <Stack.Screen
        name="EvaluacionEca"
        component={EvaluacionEcaScreen as any}
        options={{ title: 'Evaluación ECA 1' }}
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
