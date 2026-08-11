// ============================================================
// GEODAILY — Contexto de Autenticación
// ============================================================

import React, { createContext, useContext, useReducer, useCallback, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Usuario, UserRole } from '../types';
import {
  loginUser,
  logoutUser,
  verifyToken,
  guardarCredencialOffline,
  intentarLoginOffline,
  existeCredencialOffline,
  changePassword as changePasswordService,
} from '../services/auth';
import { setApiAuthToken, setUnauthorizedHandler } from '../services/api';
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
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_AVATAR'; avatarArchivoId: string | null };

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
    case 'UPDATE_AVATAR':
      return state.user
        ? { ...state, user: { ...state.user, avatar_archivo_id: action.avatarArchivoId } }
        : state;
    default:
      return state;
  }
}

// --- Context ---
interface AuthContextType extends AuthState {
  login: (usuario: string, contrasena: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; mensaje?: string; error?: string }>;
  getRole: () => UserRole | null;
  /** Refleja en memoria + SecureStore un cambio de avatar (subida/quitada) sin necesitar re-login. */
  actualizarAvatarLocal: (avatarArchivoId: string | null) => Promise<void>;
  isTecnico: boolean;
  isSupervisor: boolean;
  isInterventor: boolean;
  isGerente: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Provider ---
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Restaurar sesión al iniciar.
  //
  // Estrategia offline-first: restaurar de inmediato desde SecureStore sin
  // esperar al servidor — un técnico en campo debe poder entrar a la app al
  // instante aunque no tenga señal. La verificación contra el servidor pasa
  // a ser una revalidación EN SEGUNDO PLANO que solo actúa si el servidor
  // rechaza el token explícitamente ('invalid'); si no se pudo contactar
  // ('offline'), la sesión local se mantiene tal cual — no desloguear a
  // alguien solo porque no hay internet para verificar.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
        const userData = await SecureStore.getItemAsync(STORAGE_KEYS.USER_DATA);

        if (token && userData) {
          const user = JSON.parse(userData) as Usuario;
          setApiAuthToken(user.token);
          dispatch({ type: 'RESTORE_TOKEN', user });

          // Revalidación en segundo plano — no bloquea el acceso a la app
          verifyToken(token).then(async (resultado) => {
            if (resultado === 'invalid') {
              await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
              await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
              console.warn('[Auth] Token rechazado por el servidor — sesión cerrada');
              setApiAuthToken(null);
              dispatch({ type: 'LOGOUT' });
            } else if (resultado === 'offline') {
              console.log('[Auth] Sin conexión para revalidar token — se mantiene la sesión local');
            }
            // 'valid' → nada que hacer, ya restaurada arriba
          });
          return;
        }
        dispatch({ type: 'RESTORE_TOKEN', user: null });
      } catch {
        dispatch({ type: 'RESTORE_TOKEN', user: null });
      }
    };
    restoreSession();
  }, []);

  // Registrar el handler de 401 global — el interceptor de api.ts lo invoca
  // cuando cualquier petición recibe un token inválido/expirado, para que la
  // app salga de sesión de inmediato (SecureStore ya fue limpiado por api.ts)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      console.warn('[Auth] Sesión invalidada por el servidor (401) — cerrando sesión');
      setApiAuthToken(null);
      dispatch({ type: 'LOGOUT' });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  /** Activar la sesión recuperada de la credencial cacheada (sin red) */
  const activarSesionOffline = useCallback(async (offlineUser: Usuario) => {
    setApiAuthToken(offlineUser.token);
    try {
      await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, offlineUser.token);
      await SecureStore.setItemAsync(STORAGE_KEYS.USER_DATA, JSON.stringify(offlineUser));
    } catch (storageError) {
      console.warn('[Auth] SecureStore no disponible (offline):', storageError);
    }
    console.log('[Auth] Sesión restaurada en modo OFFLINE');
    dispatch({ type: 'LOGIN_SUCCESS', user: offlineUser });
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
          avatar_archivo_id: result.user.avatar_archivo_id,
          token: result.user.token,
        };

        // Guardar token en API client (memoria) para que funciones en
        // entornos donde SecureStore no está disponible (Expo Go, web)
        setApiAuthToken(user.token);

        // Guardar sesión en SecureStore — si falla, igual iniciamos sesión
        try {
          await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, user.token);
          await SecureStore.setItemAsync(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
        } catch (storageError) {
          console.warn('[Auth] SecureStore no disponible:', storageError);
          // En Expo Go SecureStore podría no estar disponible
        }

        // Cachear credencial para permitir login offline futuro en campo
        await guardarCredencialOffline(usuario, contrasena, user);

        dispatch({ type: 'LOGIN_SUCCESS', user });
        return;
      }

      // No se pudo contactar al servidor → login OFFLINE con la credencial
      // cacheada. `loginUser` captura sus errores y NO lanza, así que este
      // camino debe resolverse aquí: antes solo estaba en el `catch` de
      // abajo, que nunca se ejecutaba, y el técnico sin señal quedaba
      // bloqueado aunque tuviera su credencial guardada.
      if (result.offline) {
        const offlineUser = await intentarLoginOffline(usuario, contrasena);
        if (offlineUser) {
          await activarSesionOffline(offlineUser);
          return;
        }
        dispatch({
          type: 'LOGIN_FAILURE',
          error: await existeCredencialOffline(usuario)
            ? 'Contraseña incorrecta. Sin señal, se valida contra la última contraseña usada en este dispositivo.'
            : 'Sin conexión y sin sesión guardada en este dispositivo. Conéctate a internet para iniciar sesión la primera vez.',
        });
        return;
      }

      // El servidor respondió pero rechazó las credenciales (usuario/clave
      // incorrectos) — no intentar offline, es un rechazo explícito.
      dispatch({ type: 'LOGIN_FAILURE', error: result.error || 'Error de autenticación' });
    } catch (error) {
      // Falló la conexión con el servidor — intentar login OFFLINE con la
      // credencial cacheada de la última sesión online. Así un técnico en
      // campo puede reingresar sin señal aunque haya cerrado sesión.
      console.warn('[Auth] Login online falló, intentando offline:', error);
      const offlineUser = await intentarLoginOffline(usuario, contrasena);
      if (offlineUser) {
        await activarSesionOffline(offlineUser);
        return;
      }
      dispatch({
        type: 'LOGIN_FAILURE',
        error: 'Sin conexión y sin sesión guardada en este dispositivo. Conéctate a internet para iniciar sesión la primera vez.',
      });
    }
  }, [activarSesionOffline]);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
      await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_DATA);
      // La credencial offline de esta cuenta NO se borra al cerrar sesión:
      // cerrar sesión es algo que ocurre en campo todo el tiempo (cambiar
      // de rol para probar, pasar el teléfono a otro técnico) y debe seguir
      // siendo posible volver a entrar con esa misma cuenta sin señal
      // después. Solo se borra con una acción explícita de "olvidar cuenta"
      // (limpiarCredencialOffline), que hoy no tiene UI.
    } finally {
      setApiAuthToken(null);
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  const getRole = useCallback((): UserRole | null => {
    return state.user?.rol || null;
  }, [state.user]);

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; mensaje?: string; error?: string }> => {
    return changePasswordService(currentPassword, newPassword);
  }, []);

  const actualizarAvatarLocal = useCallback(async (avatarArchivoId: string | null) => {
    dispatch({ type: 'UPDATE_AVATAR', avatarArchivoId });
    if (state.user) {
      const actualizado: Usuario = { ...state.user, avatar_archivo_id: avatarArchivoId };
      try {
        await SecureStore.setItemAsync(STORAGE_KEYS.USER_DATA, JSON.stringify(actualizado));
      } catch {
        // Ignorar — no debe bloquear la actualización en memoria
      }
    }
  }, [state.user]);

  const value = useMemo<AuthContextType>(() => ({
    ...state,
    login,
    logout,
    changePassword,
    getRole,
    actualizarAvatarLocal,
    isTecnico: state.user?.rol === 'tecnico',
    isSupervisor: state.user?.rol === 'supervisor',
    isInterventor: state.user?.rol === 'interventor',
    isGerente: state.user?.rol === 'gerente',
    isAdmin: state.user?.rol === 'admin',
  }), [state, login, logout, changePassword, getRole, actualizarAvatarLocal]);

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
