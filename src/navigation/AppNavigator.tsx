// ============================================================
// GEODAILY — Navegador Principal (Auth + Rol)
// ============================================================

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../store/AuthContext';
import LoginScreen from '../screens/auth/LoginScreen';
import TerrenoNavigator from './TerrenoNavigator';
import SupervisionNavigator from './SupervisionNavigator';
import InterventorNavigator from './InterventorNavigator';
import GerenteNavigator from './GerenteNavigator';
import AdminNavigator from './AdminNavigator';
import LoadingSpinner from '../components/LoadingSpinner';
import { COLORS } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  Terreno: undefined;
  Supervision: undefined;
  Interventor: undefined;
  Gerente: undefined;
  Admin: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, isTecnico, isSupervisor, isInterventor, isGerente, isAdmin } = useAuth();

  if (isLoading) {
    return <LoadingSpinner branded message="Iniciando sesión..." />;
  }

  return (
    <View style={styles.root}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 150,
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ animationTypeForReplace: 'pop', animation: 'fade' }}
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
        ) : isInterventor ? (
          <Stack.Screen
            name="Interventor"
            component={InterventorNavigator}
          />
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ animationTypeForReplace: 'pop', animation: 'fade' }}
          />
        )}
      </Stack.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
});

export default AppNavigator;
