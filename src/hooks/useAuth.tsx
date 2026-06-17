import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, LoginCredentials, RegisterData, AuthResponse } from '../types';
import {
  login as loginService,
  register as registerService,
  logout as logoutService,
  getCurrentUser,
  refreshToken as refreshTokenService,
} from '../services/auth';
import { verifySessionForBootstrap } from '../services/authSession';
import { dataCache } from '../services/cache/dataCache';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'fretego_access_token';
const REFRESH_TOKEN_KEY = 'fretego_refresh_token';
const USER_KEY = 'fretego_user';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Lê a Cached_Session de forma SÍNCRONA do `localStorage`.
 *
 * Estratégia de auth otimista (startup-performance-optimization, Req 1.1/1.2):
 * só consideramos uma sessão presente quando AMBOS `fretego_user` e
 * `fretego_access_token` existem e o `user` é parseável. `localStorage`
 * corrompido (JSON inválido) é tratado como ausência de sessão — sem lançar e
 * sem rede (Req 1.5 / Error Handling do design).
 *
 * @returns o `User` hidratado da Cached_Session, ou `null` quando não há
 *          sessão válida persistida.
 */
function readCachedUser(): User | null {
  try {
    const storedUser = localStorage.getItem(USER_KEY);
    const storedToken = localStorage.getItem(TOKEN_KEY);

    if (!storedUser || !storedToken) {
      return null;
    }

    return JSON.parse(storedUser) as User;
  } catch {
    // localStorage corrompido/ilegível ⇒ tratar como ausência de sessão.
    return null;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Hidratação otimista: o estado inicial é derivado SINCRONAMENTE da
  // Cached_Session, permitindo o First_Useful_Paint sem aguardar rede.
  // Quando há Cached_Session, `isLoading` já inicia em `false` (Property 1).
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [isLoading, setIsLoading] = useState(() => readCachedUser() === null);

  // Verificação de sessão em segundo plano (não bloqueante).
  useEffect(() => {
    // Sem Cached_Session ⇒ user=null, isLoading=false, sem Supabase_Query.
    if (readCachedUser() === null) {
      setIsLoading(false);
      return;
    }

    // Idempotente sob React.StrictMode (double-invoke em dev): a verificação
    // apenas reconcilia o estado já hidratado; cancelamos a aplicação do
    // resultado se o efeito for desmontado antes de resolver.
    let cancelled = false;

    void verifySessionForBootstrap().then((result) => {
      if (cancelled) return;

      switch (result.kind) {
        case 'valid':
          // Sessão confirmada: refresh transparente do user + localStorage
          // (mesma semântica do `refreshUser`).
          localStorage.setItem(USER_KEY, JSON.stringify(result.user));
          setUser(result.user);
          break;
        case 'invalid':
          // Sessão explicitamente inválida ⇒ limpar Cached_Session (Req 1.3).
          clearAuthData();
          setUser(null);
          break;
        case 'network-error':
          // Erro de rede/transporte ⇒ PRESERVAR a sessão; não deslogar
          // (Req 1.4 / fail-safe ao baseline).
          break;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh token before expiration
  useEffect(() => {
    if (!user) return;

    // Refresh token every 50 minutes (tokens expire in 1 hour)
    const refreshInterval = setInterval(
      async () => {
        try {
          await refreshToken();
        } catch (error) {
          console.error('Failed to refresh token:', error);
          // If refresh fails, logout user
          await logout();
        }
      },
      50 * 60 * 1000
    ); // 50 minutes

    return () => clearInterval(refreshInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const saveAuthData = (authResponse: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, authResponse.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, authResponse.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));
    setUser(authResponse.user);
    // Registra para push notifications no app nativo (no-op no browser).
    // Fire-and-forget — falha de push nao bloqueia login.
    void import('../services/pushNotifications').then(({ registerForPush }) => {
      registerForPush().catch((err) => {
        console.warn('[auth] registerForPush falhou', err);
      });
    });
  };

  const clearAuthData = () => {
    // Remove token de push antes de limpar credenciais
    void import('../services/pushNotifications').then(({ unregisterPush }) => {
      unregisterPush().catch(() => {
        /* ignore */
      });
    });
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // Limpa o Data_Cache em memória ao encerrar/trocar de sessão para evitar
    // vazamento de dados de um usuário para outro na mesma aba (Req 6.4, 12.1).
    dataCache.clear();
    setUser(null);
  };

  const login = async (credentials: LoginCredentials) => {
    try {
      const authResponse = await loginService(credentials);
      saveAuthData(authResponse);
    } catch (error) {
      clearAuthData();
      throw error;
    }
  };

  const register = async (data: RegisterData) => {
    try {
      const authResponse = await registerService(data);
      saveAuthData(authResponse);
    } catch (error) {
      clearAuthData();
      throw error;
    }
  };

  const logout = async () => {
    try {
      if (user) {
        await logoutService(user.id);
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuthData();
    }
  };

  const refreshToken = async () => {
    try {
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!storedRefreshToken) {
        throw new Error('No refresh token available');
      }

      const authResponse = await refreshTokenService(storedRefreshToken);
      saveAuthData(authResponse);
    } catch (error) {
      clearAuthData();
      throw error;
    }
  };

  /**
   * Recarrega os dados do usuário a partir do banco e atualiza o estado +
   * localStorage. Usado quando o perfil muda (ex: nova foto, e-mail
   * verificado, etc) para refletir a alteração imediatamente no resto da
   * UI sem precisar fazer logout/login.
   */
  const refreshUser = async () => {
    try {
      const fresh = await getCurrentUser();
      if (fresh) {
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setUser(fresh);
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshToken,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper hook to get the access token
// eslint-disable-next-line react-refresh/only-export-components
export function useAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
