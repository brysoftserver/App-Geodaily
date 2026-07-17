// ============================================================
// GEODAILY — Punto de entrada principal
// ============================================================

import React, { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/store/AuthContext';
import { FormProvider } from './src/store/FormContext';
import { SyncProvider } from './src/store/SyncContext';
import { TrackingProvider } from './src/store/TrackingContext';
import { GPSProvider } from './src/store/GPSContext';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase } from './src/services/database';
import { initBeneficiariosDB } from './src/services/beneficiariosDB.service';
import { migrarBorradoresDesdeSecureStore } from './src/store/FormDraftStore';
import LoadingSpinner from './src/components/LoadingSpinner';

// LOGBOX_ENABLED=false por defecto (env.example/.env) — desactiva la pantalla
// roja de errores en pantalla completa (LogBox), que interrumpe el trabajo
// en campo por warnings/errores no fatales (ej. módulos nativos como
// MapLibre logueando fallos de red internos vía console.error). Los logs
// se siguen viendo en la terminal/Metro; esto solo apaga el overlay en el
// teléfono. Poner LOGBOX_ENABLED=true en .env para depuración profunda.
if (process.env.LOGBOX_ENABLED !== 'true') {
  LogBox.ignoreAllLogs(true);
}

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase();
        // Inicializar tabla de beneficiarios con seed de 300 registros
        await initBeneficiariosDB();
        console.log('[App] Base de datos local inicializada correctamente');
        // Migrar borradores antiguos de SecureStore → AsyncStorage
        await migrarBorradoresDesdeSecureStore();
      } catch (e) {
        console.error('[App] Error al inicializar base de datos:', e);
      } finally {
        setDbReady(true);
      }
    };
    init();
  }, []);

  if (!dbReady) {
    return <LoadingSpinner branded message="Inicializando GEODAILY..." />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <AuthProvider>
            <FormProvider>
              <SyncProvider>
                <GPSProvider>
                  <TrackingProvider>
                    <StatusBar style="dark" />
                    <AppNavigator />
                  </TrackingProvider>
                </GPSProvider>
              </SyncProvider>
            </FormProvider>
          </AuthProvider>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
