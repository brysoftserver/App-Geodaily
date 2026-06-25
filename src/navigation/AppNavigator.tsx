// ============================================================
// GEODAILY — Navegador Principal (Auth + Rol)
// ============================================================

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS, FONTS } from '../theme';
import { useAuth } from '../store/AuthContext';
import LoginScreen from '../screens/auth/LoginScreen';
import TerrenoNavigator from './TerrenoNavigator';
import SupervisionNavigator from './SupervisionNavigator';
import GerenteNavigator from './GerenteNavigator';
import AdminNavigator from './AdminNavigator';
import LoadingSpinner from '../components/LoadingSpinner';
import AppBackground from '../components/AppBackground';

export type RootStackParamList = {
  Login: undefined;
  Terreno: undefined;
  Supervision: undefined;
  Gerente: undefined;
  Admin: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, isTecnico, isSupervisor, isGerente, isAdmin } = useAuth();

  if (isLoading) {
    return <LoadingSpinner branded message="Iniciando sesión..." />;
  }

  return (
    <AppBackground overlay={0.35}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ animationTypeForReplace: 'pop' }}
          />
        ) : isAdmin ? (
          <Stack.Screen
            name="Admin"
            component={AdminNavigator}
          />
        ) : isGerente ? (
          <Stack.Screen
            name="Gerente"
            component={GerenteNavigator}
          />
        ) : isTecnico ? (
          <Stack.Screen
            name="Terreno"
            component={TerrenoNavigator}
          />
        ) : isSupervisor ? (
          <Stack.Screen
            name="Supervision"
            component={SupervisionNavigator}
          />
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ animationTypeForReplace: 'pop' }}
          />
        )}
      </Stack.Navigator>
    </AppBackground>
  );
};

export default AppNavigator;
