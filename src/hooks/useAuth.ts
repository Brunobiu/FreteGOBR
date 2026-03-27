import { useState, useEffect, useCallback } from 'react';
import {
  register as registerUser,
  login as loginUser,
  logout as logoutUser,
} from '../services/auth';
import type { User, RegisterData, LoginCredentials, AuthResponse } from '../types';

const TOKEN_KEY = 'fretego_access_token';
const REFRESH_TOKEN_KEY = 'fretego_refresh_token';
const USER_KEY = 'fretego_user';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Load auth state from localStorage on mount
  useEffect(() => {
    const loadAuthState = () => {
      try {
        const accessToken = localStorage.getItem(TOKEN_KEY);
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        const userJson = localStorage.getItem(USER_KEY);

        if (accessToken && refreshToken && userJson) {
          const user = JSON.parse(userJson) as User;
          setAuthState({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } else {
          setAuthState((prev) => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        console.error('Error loading auth state:', error);
        setAuthState((prev) => ({ ...prev, isLoading: false }));
      }
    };

    loadAuthState();
  }, []);

  // Save auth state to localStorage
  const saveAuthState = useCallback((authResponse: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, authResponse.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, authResponse.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));

    setAuthState({
      user: authResponse.user,
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  // Clear auth state from localStorage
  const clearAuthState = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);

    setAuthState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  // Register function
  const register = useCallback(
    async (data: RegisterData): Promise<void> => {
      setAuthState((prev) => ({ ...prev, isLoading: true }));

      try {
        const authResponse = await registerUser(data);
        saveAuthState(authResponse);
      } catch (error) {
        setAuthState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [saveAuthState]
  );

  // Login function
  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      setAuthState((prev) => ({ ...prev, isLoading: true }));

      try {
        const authResponse = await loginUser(credentials);
        saveAuthState(authResponse);
      } catch (error) {
        setAuthState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [saveAuthState]
  );

  // Logout function
  const logout = useCallback(async (): Promise<void> => {
    if (!authState.user) return;

    try {
      await logoutUser(authState.user.id);
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      clearAuthState();
    }
  }, [authState.user, clearAuthState]);

  // Auto-refresh token (simplified - in production, check expiration)
  useEffect(() => {
    if (!authState.isAuthenticated || !authState.refreshToken) return;

    // Set up token refresh interval (e.g., every 50 minutes for 1-hour tokens)
    const refreshInterval = setInterval(
      () => {
        // In a real implementation, you would call refreshToken from auth service
        // For now, we'll just log that refresh should happen
        console.log('Token refresh should happen here');
      },
      50 * 60 * 1000
    ); // 50 minutes

    return () => clearInterval(refreshInterval);
  }, [authState.isAuthenticated, authState.refreshToken]);

  return {
    user: authState.user,
    accessToken: authState.accessToken,
    refreshToken: authState.refreshToken,
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    register,
    login,
    logout,
  };
}
