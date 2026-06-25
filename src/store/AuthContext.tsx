// ============================================================
// GEODAILY — Contexto de Autenticación
// ============================================================

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Usuario, UserRole } from '../types';
import { loginUser, logoutUser, verifyToken } from '../services/auth';
import { STORAGE_KEYS } from '../utils/constants';

// --- Estado ---
interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Usuario | null;
  error: string | null;
}

type AuthAction =
  | { type: 'RESTORE_TOKEN'; user: Usuario | null }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: Usuario }
  | { type: 'LOGIN_FAILURE'; error: string }
  | { type: 'LOGOUT' };

const initialState: AuthState = {
  isLoading: true,
  isAuthenticated: false,
  user: null,
  error: null,
};

// --- Reducer ---
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESTORE_TOKEN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: action.user !== null,
        user: action.user,
      };
    case 'LOGIN_START':
      return { ...state, isLoading: true, error: null };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        user: action.user,
        error: null,
      };
    case 'LOGIN_FAILURE':
      return {
        ...state,
        isLoading: false,
        error: action.error,
      };
    case 'LOGOUT':
      return {
        ...initialState,
        isLoading: false,
      };
    default:
      return state;
  }
}

// --- Context ---
interface AuthContextType extends AuthState {
  login: (usuario: string, contrasena: string) => Promise<void>;
  logout: () => Promise<void>;
  getRole: () => UserRole | null;
  isTecnico: boolean;
  isSupervisor: boolean;
  isGerente: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Provider ---
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Restaurar sesión al iniciar
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
        const userData = await SecureStore.getItemAsync(STORAGE_KEYS.USER_DATA);

        if (token && userData) {
          const isValid = await verifyToken(token);
          if (isValid) {
            const user = JSON.parse(userData) as Usuario;
            dispatch({ type: 'RESTORE_TOKEN', user });
            return;
          }
          // Token inválido — limpiar datos corruptos
          await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
          await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
          console.warn('[Auth] Token inválido — datos de sesión limpiados');
        }
        dispatch({ type: 'RESTORE_TOKEN', user: null });
      } catch {
        dispatch({ type: 'RESTORE_TOKEN', user: null });
      }
    };
    restoreSession();
  }, []);

  const login = useCallback(async (usuario: string, contrasena: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await loginUser(usuario, contrasena);
      if (result.success && result.user) {
        const user: Usuario = {
          id: result.user.id,
          nombre: result.user.nombre,
          cedula: result.user.cedula,
          email: result.user.email,
          rol: result.user.rol as UserRole,
          telefono: result.user.telefono,
          token: result.user.token,
        };

        // Guardar sesión en SecureStore — si falla, igual iniciamos sesión
        try {
          await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, user.token);
          await SecureStore.setItemAsync(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
        } catch (storageError) {
          console.warn('[Auth] SecureStore no disponible:', storageError);
          // En Expo Go SecureStore podría no estar disponible
        }

        dispatch({ type: 'LOGIN_SUCCESS', user });
      } else {
        dispatch({ type: 'LOGIN_FAILURE', error: result.error || 'Error de autenticación' });
      }
    } catch (error) {
      console.error('[Auth] Error en login:', error);
      dispatch({ type: 'LOGIN_FAILURE', error: 'Error de conexión con el servidor' });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
      await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
    } finally {
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  const getRole = useCallback((): UserRole | null => {
    return state.user?.rol || null;
  }, [state.user]);

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    getRole,
    isTecnico: state.user?.rol === 'tecnico',
    isSupervisor: state.user?.rol === 'supervisor',
    isGerente: state.user?.rol === 'gerente',
    isAdmin: state.user?.rol === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// --- Hook ---
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};

export default AuthContext;
