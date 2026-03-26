-- FreteGO Database Schema
-- Migration 001: Initial Schema Setup

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Users table (base table for all user types)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('motorista', 'embarcador', 'admin')),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  cpf VARCHAR(14),
  profile_photo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Motoristas table (extends users)
CREATE TABLE motoristas (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cnh VARCHAR(50),
  antt VARCHAR(50),
  vehicle_type VARCHAR(100),
  vehicle_documents JSONB,
  location GEOGRAPHY(POINT),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Embarcadores table (extends users)
CREATE TABLE embarcadores (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  whatsapp VARCHAR(20) NOT NULL,
  rating DECIMAL(3, 2) DEFAULT 0.00,
  total_ratings INTEGER DEFAULT 0,
  location GEOGRAPHY(POINT),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fretes table
CREATE TABLE fretes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  embarcador_id UUID NOT NULL REFERENCES embarcadores(id) ON DELETE CASCADE,
  origin VARCHAR(255) NOT NULL,
  origin_location GEOGRAPHY(POINT) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  destination_location GEOGRAPHY(POINT) NOT NULL,
  cargo_type VARCHAR(100) NOT NULL,
  vehicle_type VARCHAR(100) NOT NULL,
  weight DECIMAL(10, 2) NOT NULL,
  value DECIMAL(10, 2) NOT NULL,
  deadline DATE NOT NULL,
  loading_time INTEGER NOT NULL, -- minutes
  unloading_time INTEGER NOT NULL, -- minutes
  specifications TEXT,
  status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado', 'cancelado')),
  views_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Frete clicks tracking table
CREATE TABLE frete_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frete_id UUID NOT NULL REFERENCES fretes(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(frete_id, motorista_id)
);

-- Avaliacoes (ratings) table
CREATE TABLE avaliacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  embarcador_id UUID NOT NULL REFERENCES embarcadores(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(embarcador_id, motorista_id)
);

-- Chat conversations table
CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'resolvida')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Chat messages table
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('cpf', 'cnh', 'antt', 'vehicle', 'photo')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  table_name VARCHAR(100),
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Users indexes
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_is_active ON users(is_active);

-- Motoristas indexes
CREATE INDEX idx_motoristas_location ON motoristas USING GIST(location);

-- Embarcadores indexes
CREATE INDEX idx_embarcadores_rating ON embarcadores(rating DESC);

-- Fretes indexes
CREATE INDEX idx_fretes_embarcador ON fretes(embarcador_id);
CREATE INDEX idx_fretes_status ON fretes(status);
CREATE INDEX idx_fretes_origin_location ON fretes USING GIST(origin_location);
CREATE INDEX idx_fretes_destination_location ON fretes USING GIST(destination_location);
CREATE INDEX idx_fretes_created_at ON fretes(created_at DESC);

-- Frete clicks indexes
CREATE INDEX idx_frete_clicks_frete ON frete_clicks(frete_id);
CREATE INDEX idx_frete_clicks_motorista ON frete_clicks(motorista_id);

-- Avaliacoes indexes
CREATE INDEX idx_avaliacoes_embarcador ON avaliacoes(embarcador_id);
CREATE INDEX idx_avaliacoes_motorista ON avaliacoes(motorista_id);

-- Chat conversations indexes
CREATE INDEX idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX idx_chat_conversations_status ON chat_conversations(status);

-- Chat messages indexes
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_messages_unread ON chat_messages(conversation_id) WHERE read_at IS NULL;

-- Documents indexes
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_type ON documents(document_type);

-- Notifications indexes
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Audit logs indexes
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
