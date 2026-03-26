// Core types for FreteGO application
// These will be expanded as we implement features

export type UserType = 'motorista' | 'embarcador' | 'admin';

export interface User {
  id: string;
  phone: string;
  userType: UserType;
  name: string;
  email?: string;
  cpf?: string;
  profilePhotoUrl?: string;
  isActive: boolean;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

// More types will be added in subsequent tasks
