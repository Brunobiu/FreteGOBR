import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Configuração lida do módulo central de env (valida e falha cedo se faltar).
const supabaseUrl = env.supabaseUrl;
const supabaseAnonKey = env.supabaseAnonKey;

// Create Supabase client (singleton)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'fretego-auth',
    flowType: 'implicit',
  },
});

// Helper function to get authenticated user
export const getCurrentUser = async () => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
};

// Helper function to sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
};
