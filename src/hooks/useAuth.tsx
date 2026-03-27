import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, LoginCredentials, RegisterData, AuthResponse } from '../types';
import {
  login as loginService,
  register as registerService,
  logout as logoutService,
  getCurrentUser,
  refreshToken as refreshTokenService,
} from '../services/auth';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'fretego_access_token';
const REFRESH_TOKEN_KEY = 'fretego_refresh_token';
const USER_KEY = 'fretego_user';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedUser = localStorage.getItem(USER_KEY);
        const storedToken = localStorage.getItem(TOKEN_KEY);

        if (storedUser && storedToken) {
          // Verify token is still valid by fetching current user
          const currentUser = await getCurrentUser();
          if (currentUser) {
            setUser(currentUser);
          } else {
            // Token invalid, clear storage
            clearAuthData();
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        clearAuthData();
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
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
  }, [user]);

  const saveAuthData = (authResponse: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, authResponse.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, authResponse.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));
    setUser(authResponse.user);
  };

  const clearAuthData = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
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

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper hook to get the access token
export function useAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
