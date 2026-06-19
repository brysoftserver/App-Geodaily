// ============================================================
// GEODAILY — Punto de entrada principal
// ============================================================

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/store/AuthContext';
import { FormProvider } from './src/store/FormContext';
import { SyncProvider } from './src/store/SyncContext';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase } from './src/services/database';
import { COLORS } from './src/theme';
import LoadingSpinner from './src/components/LoadingSpinner';

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase();
        console.log('[App] Base de datos local inicializada correctamente');
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
    <SafeAreaProvider>
      <NavigationContainer>
        <AuthProvider>
          <FormProvider>
            <SyncProvider>
              <StatusBar style="dark" />
              <AppNavigator />
            </SyncProvider>
          </FormProvider>
        </AuthProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
