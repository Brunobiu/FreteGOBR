# Design Document - FreteGO

## Overview

FreteGO é um marketplace de frete brasileiro construído com arquitetura moderna e escalável. O sistema utiliza React + TypeScript no frontend, Supabase (PostgreSQL) no backend, e implementa segurança robusta através de JWT, Row Level Security (RLS), e proteção em múltiplas camadas.

### Objetivos do Design

- Segurança em primeiro lugar: autenticação JWT, RLS, sanitização de inputs
- Escalabilidade: arquitetura preparada para crescimento
- Performance: lazy loading, caching, otimização de queries
- Testabilidade: cobertura completa com testes unitários e property-based
- Manutenibilidade: código limpo, tipado, e bem documentado

### Princípios Arquiteturais

1. **Separation of Concerns**: Frontend, backend, e banco de dados com responsabilidades claras
2. **Security by Default**: Todas as rotas protegidas por padrão, acesso explícito quando necessário
3. **Data Integrity**: Validação em múltiplas camadas (client, server, database)
4. **Real-time First**: WebSockets/Realtime para chat e notificações
5. **Mobile-First**: Design responsivo priorizando experiência mobile

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  React + TypeScript + Vite + Tailwind CSS                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Public     │  │  Protected   │  │    Admin     │     │
│  │   Routes     │  │   Routes     │  │   Routes     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS + JWT
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Backend                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Auth API    │  │  Database    │  │   Storage    │     │
│  │   (JWT)      │  │  (Postgres)  │  │   (Files)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  Realtime    │  │     RLS      │                        │
│  │ (WebSocket)  │  │  (Security)  │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- React 18+ com TypeScript
- Vite para build e dev server
- Tailwind CSS para estilização
- React Router v6 para roteamento
- React Query para cache e estado servidor
- Zustand para estado global
- React Hook Form + Zod para formulários e validação
- Leaflet para mapas interativos
- Socket.io-client ou Supabase Realtime para chat

**Backend:**
- Supabase (PostgreSQL 15+)
- Supabase Auth para autenticação
- Supabase Storage para arquivos
- Supabase Realtime para comunicação em tempo real
- Row Level Security (RLS) para segurança de dados
- Database Functions para lógica de negócio
- Database Triggers para automações

**Testing:**
- Vitest para testes unitários
- React Testing Library para testes de componentes
- Playwright para testes E2E
- fast-check para property-based testing

**Deployment:**
- Vercel para frontend
- Supabase Cloud para backend



## Components and Interfaces

### Frontend Components

#### 1. Authentication Components

**LoginForm**
```typescript
interface LoginFormProps {
  onSuccess: (user: User) => void;
  onError: (error: Error) => void;
}

interface LoginCredentials {
  phone: string;
  password: string;
}
```

**RegisterForm**
```typescript
interface RegisterFormProps {
  userType: 'motorista' | 'embarcador';
  onSuccess: (user: User) => void;
  onError: (error: Error) => void;
}

interface RegisterData {
  phone: string;
  password: string;
  name: string;
  userType: 'motorista' | 'embarcador';
  companyName?: string; // Required for embarcador
}
```

**PasswordValidator**
```typescript
interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  hasMinLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
}

function validatePassword(password: string): PasswordValidation
```

#### 2. Frete Components

**FreteCard**
```typescript
interface FreteCardProps {
  frete: Frete;
  onClick: (freteId: string) => void;
  showContact: boolean; // false for visitors
}
```

**FreteModal**
```typescript
interface FreteModalProps {
  frete: Frete;
  isOpen: boolean;
  onClose: () => void;
  onContract?: (freteId: string) => void;
}
```

**FreteForm** (Embarcador)
```typescript
interface FreteFormProps {
  initialData?: Partial<Frete>;
  onSubmit: (data: FreteFormData) => Promise<void>;
  onCancel: () => void;
}

interface FreteFormData {
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  cargoType: string;
  vehicleType: string;
  weight: number;
  value: number;
  deadline: Date;
  loadingTime: number; // minutes
  unloadingTime: number; // minutes
  whatsapp: string;
  specifications?: string;
}
```

**FreteFilters**
```typescript
interface FreteFiltersProps {
  onFilterChange: (filters: FreteFilters) => void;
  initialFilters?: Partial<FreteFilters>;
}

interface FreteFilters {
  originCity?: string;
  destinationCity?: string;
  cargoType?: string;
  vehicleType?: string;
  minWeight?: number;
  maxWeight?: number;
  minValue?: number;
  maxValue?: number;
}
```

#### 3. Map Components

**InteractiveMap**
```typescript
interface InteractiveMapProps {
  fretes: Frete[];
  center?: GeographicPoint;
  zoom?: number;
  onMarkerClick: (freteId: string) => void;
}

interface GeographicPoint {
  latitude: number;
  longitude: number;
}
```

**FreteMarker**
```typescript
interface FreteMarkerProps {
  frete: Frete;
  onClick: (freteId: string) => void;
}
```

#### 4. Profile Components

**MotoristaProfile**
```typescript
interface MotoristaProfileProps {
  motorista: Motorista;
  isEditing: boolean;
  onSave: (data: MotoristaUpdateData) => Promise<void>;
}

interface MotoristaUpdateData {
  name: string;
  email?: string;
  cpf?: string;
  cnh?: string;
  antt?: string;
  vehicleType?: string;
  profilePhoto?: File;
}
```

**EmbarcadorProfile**
```typescript
interface EmbarcadorProfileProps {
  embarcador: Embarcador;
  isEditing: boolean;
  onSave: (data: EmbarcadorUpdateData) => Promise<void>;
}

interface EmbarcadorUpdateData {
  name: string;
  companyName: string;
  email?: string;
  whatsapp: string;
  profilePhoto?: File;
}
```

**DocumentUpload**
```typescript
interface DocumentUploadProps {
  documentType: DocumentType;
  currentDocuments: Document[];
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
  maxFiles?: number;
  acceptedFormats: string[];
}

type DocumentType = 'cpf' | 'cnh' | 'antt' | 'vehicle' | 'photo';
```

#### 5. Chat Components

**ChatWidget**
```typescript
interface ChatWidgetProps {
  userId: string;
  isOpen: boolean;
  onToggle: () => void;
}
```

**ChatWindow**
```typescript
interface ChatWindowProps {
  conversationId: string;
  messages: ChatMessage[];
  onSendMessage: (message: string) => Promise<void>;
  onUploadFile?: (file: File) => Promise<void>;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  message: string;
  isAdmin: boolean;
  readAt?: Date;
  createdAt: Date;
}
```

**AdminChatDashboard**
```typescript
interface AdminChatDashboardProps {
  conversations: Conversation[];
  onSelectConversation: (conversationId: string) => void;
  onMarkResolved: (conversationId: string) => Promise<void>;
}

interface Conversation {
  id: string;
  userId: string;
  userName: string;
  status: 'aberta' | 'em_andamento' | 'resolvida';
  unreadCount: number;
  lastMessage?: ChatMessage;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 6. Dashboard Components

**MotoristaD ashboard**
```typescript
interface MotoristaDashboardProps {
  motorista: Motorista;
  fretes: Frete[];
  contractedFretes: Frete[];
}
```

**EmbarcadorDashboard**
```typescript
interface EmbarcadorDashboardProps {
  embarcador: Embarcador;
  myFretes: Frete[];
  allFretes: Frete[];
}
```

**AdminDashboard**
```typescript
interface AdminDashboardProps {
  metrics: PlatformMetrics;
  users: User[];
  fretes: Frete[];
  conversations: Conversation[];
}

interface PlatformMetrics {
  totalActiveUsers: number;
  totalInactiveUsers: number;
  totalMotoristas: number;
  totalEmbarcadores: number;
  activeFretes: number;
  completedFretes: number;
  onlineUsers: number;
  growthData: GrowthData[];
}

interface GrowthData {
  date: Date;
  userCount: number;
  freteCount: number;
}
```

#### 7. Calculator Components

**FreteCalculator**
```typescript
interface FreteCalculatorProps {
  currentLocation: GeographicPoint;
  onLocationChange: (location: GeographicPoint) => void;
}

interface RouteComparison {
  frete: Frete;
  distance: number; // km
  estimatedTime: number; // hours
  totalDays: number;
  loadingTime: number; // minutes
  unloadingTime: number; // minutes
  value: number;
  profitPerDay: number;
}
```

### Backend Interfaces

#### 1. Authentication Service

```typescript
interface AuthService {
  register(data: RegisterData): Promise<AuthResponse>;
  login(credentials: LoginCredentials): Promise<AuthResponse>;
  logout(userId: string): Promise<void>;
  refreshToken(refreshToken: string): Promise<AuthResponse>;
  resetPassword(phone: string): Promise<void>;
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
}

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
```

#### 2. User Service

```typescript
interface UserService {
  getUserById(userId: string): Promise<User>;
  updateUser(userId: string, data: Partial<User>): Promise<User>;
  deactivateUser(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  getUsersByType(userType: UserType): Promise<User[]>;
}

type UserType = 'motorista' | 'embarcador' | 'admin';
```

#### 3. Frete Service

```typescript
interface FreteService {
  createFrete(embarcadorId: string, data: FreteFormData): Promise<Frete>;
  updateFrete(freteId: string, data: Partial<FreteFormData>): Promise<Frete>;
  deleteFrete(freteId: string): Promise<void>;
  getFreteById(freteId: string): Promise<Frete>;
  getActiveFretes(filters?: FreteFilters): Promise<Frete[]>;
  getFretesByEmbarcador(embarcadorId: string): Promise<Frete[]>;
  recordFreteClick(freteId: string, motoristaId: string): Promise<void>;
  incrementFreteViews(freteId: string): Promise<void>;
}
```

#### 4. Document Service

```typescript
interface DocumentService {
  uploadDocument(userId: string, documentType: DocumentType, file: File): Promise<Document>;
  getDocumentsByUser(userId: string): Promise<Document[]>;
  deleteDocument(documentId: string): Promise<void>;
  getSignedUrl(documentId: string): Promise<string>;
}

interface Document {
  id: string;
  userId: string;
  documentType: DocumentType;
  fileUrl: string;
  fileName: string;
  createdAt: Date;
}
```

#### 5. Chat Service

```typescript
interface ChatService {
  createConversation(userId: string): Promise<Conversation>;
  getConversationByUser(userId: string): Promise<Conversation>;
  sendMessage(conversationId: string, senderId: string, message: string, isAdmin: boolean): Promise<ChatMessage>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  markMessagesAsRead(conversationId: string, userId: string): Promise<void>;
  updateConversationStatus(conversationId: string, status: ConversationStatus): Promise<void>;
  getAllConversations(): Promise<Conversation[]>; // Admin only
}

type ConversationStatus = 'aberta' | 'em_andamento' | 'resolvida';
```

#### 6. Rating Service

```typescript
interface RatingService {
  createRating(motoristaId: string, embarcadorId: string, rating: number, comment?: string): Promise<Rating>;
  getRatingsByEmbarcador(embarcadorId: string): Promise<Rating[]>;
  getAverageRating(embarcadorId: string): Promise<number>;
  hasRated(motoristaId: string, embarcadorId: string): Promise<boolean>;
}

interface Rating {
  id: string;
  embarcadorId: string;
  motoristaId: string;
  rating: number;
  comment?: string;
  createdAt: Date;
}
```

#### 7. Geolocation Service

```typescript
interface GeolocationService {
  geocodeAddress(address: string): Promise<GeographicPoint>;
  reverseGeocode(point: GeographicPoint): Promise<string>;
  calculateDistance(point1: GeographicPoint, point2: GeographicPoint): number;
  findNearbyFretes(location: GeographicPoint, radiusKm: number): Promise<Frete[]>;
}
```

#### 8. Analytics Service

```typescript
interface AnalyticsService {
  getPlatformMetrics(): Promise<PlatformMetrics>;
  getUserGrowth(startDate: Date, endDate: Date): Promise<GrowthData[]>;
  getFreteGrowth(startDate: Date, endDate: Date): Promise<GrowthData[]>;
  getOnlineUsers(): Promise<number>;
  recordUserActivity(userId: string): Promise<void>;
}
```



## Data Models

### Database Schema

#### users
```sql
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

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_is_active ON users(is_active);
```

#### motoristas
```sql
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

CREATE INDEX idx_motoristas_location ON motoristas USING GIST(location);
```

#### embarcadores
```sql
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

CREATE INDEX idx_embarcadores_rating ON embarcadores(rating DESC);
```

#### fretes
```sql
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

CREATE INDEX idx_fretes_embarcador ON fretes(embarcador_id);
CREATE INDEX idx_fretes_status ON fretes(status);
CREATE INDEX idx_fretes_origin_location ON fretes USING GIST(origin_location);
CREATE INDEX idx_fretes_destination_location ON fretes USING GIST(destination_location);
CREATE INDEX idx_fretes_created_at ON fretes(created_at DESC);
```

#### frete_clicks
```sql
CREATE TABLE frete_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  frete_id UUID NOT NULL REFERENCES fretes(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(frete_id, motorista_id)
);

CREATE INDEX idx_frete_clicks_frete ON frete_clicks(frete_id);
CREATE INDEX idx_frete_clicks_motorista ON frete_clicks(motorista_id);
```

#### avaliacoes
```sql
CREATE TABLE avaliacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  embarcador_id UUID NOT NULL REFERENCES embarcadores(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(embarcador_id, motorista_id)
);

CREATE INDEX idx_avaliacoes_embarcador ON avaliacoes(embarcador_id);
CREATE INDEX idx_avaliacoes_motorista ON avaliacoes(motorista_id);
```

#### chat_conversations
```sql
CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'resolvida')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX idx_chat_conversations_status ON chat_conversations(status);
```

#### chat_messages
```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_messages_unread ON chat_messages(conversation_id) WHERE read_at IS NULL;
```

#### documents
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('cpf', 'cnh', 'antt', 'vehicle', 'photo')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_type ON documents(document_type);
```

#### notifications
```sql
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

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
```

#### audit_logs
```sql
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

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

### TypeScript Data Models

```typescript
interface User {
  id: string;
  phone: string;
  userType: 'motorista' | 'embarcador' | 'admin';
  name: string;
  email?: string;
  cpf?: string;
  profilePhotoUrl?: string;
  isActive: boolean;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface Motorista extends User {
  cnh?: string;
  antt?: string;
  vehicleType?: string;
  vehicleDocuments?: Record<string, any>;
  location?: GeographicPoint;
}

interface Embarcador extends User {
  companyName: string;
  whatsapp: string;
  rating: number;
  totalRatings: number;
  location?: GeographicPoint;
}

interface Frete {
  id: string;
  embarcadorId: string;
  embarcador?: Embarcador;
  origin: string;
  originLocation: GeographicPoint;
  destination: string;
  destinationLocation: GeographicPoint;
  cargoType: string;
  vehicleType: string;
  weight: number;
  value: number;
  deadline: Date;
  loadingTime: number;
  unloadingTime: number;
  specifications?: string;
  status: 'ativo' | 'encerrado' | 'cancelado';
  viewsCount: number;
  clicksCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface GeographicPoint {
  latitude: number;
  longitude: number;
}
```

### Database Functions

#### update_embarcador_rating
```sql
CREATE OR REPLACE FUNCTION update_embarcador_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE embarcadores
  SET 
    rating = (
      SELECT AVG(rating)::DECIMAL(3,2)
      FROM avaliacoes
      WHERE embarcador_id = NEW.embarcador_id
    ),
    total_ratings = (
      SELECT COUNT(*)
      FROM avaliacoes
      WHERE embarcador_id = NEW.embarcador_id
    ),
    updated_at = NOW()
  WHERE id = NEW.embarcador_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_embarcador_rating
AFTER INSERT OR UPDATE ON avaliacoes
FOR EACH ROW
EXECUTE FUNCTION update_embarcador_rating();
```

#### increment_frete_views
```sql
CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE fretes
  SET views_count = views_count + 1,
      updated_at = NOW()
  WHERE id = frete_id_param;
END;
$$ LANGUAGE plpgsql;
```

#### record_frete_click
```sql
CREATE OR REPLACE FUNCTION record_frete_click(
  frete_id_param UUID,
  motorista_id_param UUID
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO frete_clicks (frete_id, motorista_id)
  VALUES (frete_id_param, motorista_id_param)
  ON CONFLICT (frete_id, motorista_id) DO NOTHING;
  
  UPDATE fretes
  SET clicks_count = (
    SELECT COUNT(*)
    FROM frete_clicks
    WHERE frete_id = frete_id_param
  ),
  updated_at = NOW()
  WHERE id = frete_id_param;
END;
$$ LANGUAGE plpgsql;
```

#### find_nearby_fretes
```sql
CREATE OR REPLACE FUNCTION find_nearby_fretes(
  user_location GEOGRAPHY,
  radius_km INTEGER DEFAULT 100
)
RETURNS TABLE (
  frete_id UUID,
  distance_km DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    ST_Distance(f.origin_location, user_location) / 1000 AS distance_km
  FROM fretes f
  WHERE f.status = 'ativo'
    AND ST_DWithin(f.origin_location, user_location, radius_km * 1000)
  ORDER BY distance_km ASC;
END;
$$ LANGUAGE plpgsql;
```

### Row Level Security Policies

#### users table
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can view their own data, admins can view all
CREATE POLICY users_select_policy ON users
FOR SELECT
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can update their own data, admins can update all
CREATE POLICY users_update_policy ON users
FOR UPDATE
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only admins can delete users
CREATE POLICY users_delete_policy ON users
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);
```

#### fretes table
```sql
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;

-- Everyone can view active fretes
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT
USING (status = 'ativo' OR embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only embarcadores can insert fretes
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM embarcadores
    WHERE id = auth.uid()
  )
);

-- Only frete owner or admin can update
CREATE POLICY fretes_update_policy ON fretes
FOR UPDATE
USING (
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only frete owner or admin can delete
CREATE POLICY fretes_delete_policy ON fretes
FOR DELETE
USING (
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);
```

#### documents table
```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Only document owner or admin can view
CREATE POLICY documents_select_policy ON documents
FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only document owner can insert
CREATE POLICY documents_insert_policy ON documents
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Only document owner or admin can delete
CREATE POLICY documents_delete_policy ON documents
FOR DELETE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);
```

#### chat_messages table
```sql
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Only conversation participants can view messages
CREATE POLICY chat_messages_select_policy ON chat_messages
FOR SELECT
USING (
  sender_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = conversation_id AND user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only conversation participants can insert messages
CREATE POLICY chat_messages_insert_policy ON chat_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid() AND (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND user_type = 'admin'
    )
  )
);
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Password Hashing Verification

*For any* valid password string, after hashing with bcrypt, verifying the hash against the original password should return true.

**Validates: Requirements 1.1**

### Property 2: Password Validation Rules

*For any* string, the password validator should accept it if and only if it has at least 6 characters, contains at least 1 letter, and contains at least 1 number.

**Validates: Requirements 1.6, 3.3, 3.4**

### Property 3: SQL Injection Prevention

*For any* input string containing SQL injection patterns (e.g., `'; DROP TABLE--`, `' OR '1'='1`), the sanitization function should escape or remove dangerous characters, preventing SQL execution.

**Validates: Requirements 1.7**

### Property 4: RLS Document Isolation

*For any* Motorista user ID and any set of documents in the database, querying documents with that user's credentials should return only documents where `user_id` matches the querying user's ID.

**Validates: Requirements 2.1**

### Property 5: Public Frete Access

*For any* frete with status 'ativo', querying without authentication should successfully return the frete data (excluding private fields like embarcador phone).

**Validates: Requirements 2.6**

### Property 6: Phone Number Uniqueness

*For any* phone number already registered in the system, attempting to register a new account with the same phone number should fail with a uniqueness validation error.

**Validates: Requirements 3.2**

### Property 7: Signed URL Expiration

*For any* document, generating a signed URL with expiration time T should produce a URL that is valid before time T and invalid after time T.

**Validates: Requirements 4.8**

### Property 8: Frete Click Counter Increment

*For any* frete, recording a click should increment the `clicks_count` by exactly 1, and the new count should equal the old count plus 1.

**Validates: Requirements 6.6**

### Property 9: Filter Matching

*For any* set of filter criteria (origin, destination, cargo type, etc.) and any set of fretes, the filtered results should only include fretes where ALL filter conditions are satisfied.

**Validates: Requirements 7.5, 21.7**

### Property 10: Rating Average Calculation

*For any* embarcador with any set of ratings, the calculated average rating should equal the sum of all rating values divided by the count of ratings, rounded to 2 decimal places.

**Validates: Requirements 9.3**

### Property 11: Duplicate Rating Prevention

*For any* motorista-embarcador pair where a rating already exists, attempting to submit a second rating should fail with a duplicate constraint error.

**Validates: Requirements 9.6**

### Property 12: Distance-Based Sorting

*For any* reference location and any set of fretes, when sorted by proximity, each frete should be closer to or equal distance from the reference point compared to the next frete in the list.

**Validates: Requirements 11.3**

### Property 13: Route Distance Calculation Consistency

*For any* route defined by origin and destination coordinates, calculating the distance multiple times should always return the same value (deterministic calculation).

**Validates: Requirements 12.2**

### Property 14: Chat Message Persistence

*For any* chat message sent in a conversation, querying the conversation's message history should include that message with matching content, sender ID, and timestamp.

**Validates: Requirements 13.7**

### Property 15: File Size Validation

*For any* file with size exceeding the configured maximum (e.g., 10MB), the upload validation should reject the file before storage.

**Validates: Requirements 19.8**

### Property 16: File Format Validation

*For any* file with extension not in the allowed list (PDF, JPG, PNG), the upload validation should reject the file with a format error.

**Validates: Requirements 19.9**

### Property 17: Geocoding Validity

*For any* valid address string, geocoding should return coordinates where latitude is between -90 and 90, and longitude is between -180 and 180.

**Validates: Requirements 25.4**

### Property 18: Serialization Round Trip

*For any* valid system object (User, Frete, Motorista, Embarcador), serializing to JSON then deserializing should produce an object equivalent to the original.

**Validates: Requirements 26.5**

### Property 19: JWT Token Claims

*For any* authenticated user, the generated JWT token should contain claims for user ID, user type, and expiration time, and these claims should be verifiable with the signing key.

**Validates: Requirements 1.2**

### Property 20: Filter Composition (AND Logic)

*For any* two or more filters applied simultaneously, the result set should be the intersection of results from each individual filter (not the union).

**Validates: Requirements 21.7**



## Error Handling

### Error Categories

#### 1. Authentication Errors

**InvalidCredentialsError**
- Thrown when login credentials are incorrect
- HTTP Status: 401 Unauthorized
- User Message: "Telefone ou senha incorretos"
- Logging: Log attempt with phone number (not password)

**TokenExpiredError**
- Thrown when JWT token has expired
- HTTP Status: 401 Unauthorized
- User Message: "Sessão expirada. Por favor, faça login novamente"
- Action: Attempt automatic refresh token flow

**UnauthorizedError**
- Thrown when user attempts to access resource without permission
- HTTP Status: 403 Forbidden
- User Message: "Você não tem permissão para acessar este recurso"
- Logging: Log security event with user ID and attempted resource

#### 2. Validation Errors

**ValidationError**
- Thrown when input data fails validation rules
- HTTP Status: 400 Bad Request
- User Message: Specific field errors (e.g., "Senha deve ter no mínimo 6 caracteres")
- Response Format:
```typescript
{
  error: "ValidationError",
  fields: {
    password: ["Deve ter no mínimo 6 caracteres", "Deve conter pelo menos 1 letra"],
    phone: ["Número de telefone inválido"]
  }
}
```

**DuplicateError**
- Thrown when attempting to create resource with duplicate unique field
- HTTP Status: 409 Conflict
- User Message: "Este telefone já está cadastrado"
- Logging: Log attempt with conflicting value

#### 3. Resource Errors

**NotFoundError**
- Thrown when requested resource doesn't exist
- HTTP Status: 404 Not Found
- User Message: "Recurso não encontrado"
- Logging: Log with resource type and ID

**ForbiddenError**
- Thrown when user tries to modify resource they don't own
- HTTP Status: 403 Forbidden
- User Message: "Você não pode modificar este recurso"
- Logging: Log security event with user ID and resource ID

#### 4. File Upload Errors

**FileSizeError**
- Thrown when file exceeds size limit
- HTTP Status: 413 Payload Too Large
- User Message: "Arquivo muito grande. Tamanho máximo: 10MB"

**FileFormatError**
- Thrown when file format is not allowed
- HTTP Status: 415 Unsupported Media Type
- User Message: "Formato de arquivo não suportado. Use PDF, JPG ou PNG"

**StorageError**
- Thrown when file storage operation fails
- HTTP Status: 500 Internal Server Error
- User Message: "Erro ao fazer upload do arquivo. Tente novamente"
- Logging: Log full error with stack trace

#### 5. Database Errors

**DatabaseError**
- Thrown when database operation fails
- HTTP Status: 500 Internal Server Error
- User Message: "Erro interno do servidor. Tente novamente mais tarde"
- Logging: Log full error with query details (sanitized)
- Action: Notify admin if critical

**ConnectionError**
- Thrown when database connection fails
- HTTP Status: 503 Service Unavailable
- User Message: "Serviço temporariamente indisponível"
- Logging: Log connection details
- Action: Attempt reconnection, notify admin

#### 6. External Service Errors

**GeocodeError**
- Thrown when geocoding service fails
- HTTP Status: 502 Bad Gateway
- User Message: "Não foi possível localizar o endereço. Verifique e tente novamente"
- Action: Retry with exponential backoff

**WhatsAppError**
- Thrown when WhatsApp link generation fails
- HTTP Status: 500 Internal Server Error
- User Message: "Erro ao abrir WhatsApp. Tente novamente"
- Logging: Log with phone number and message template

#### 7. Real-time Communication Errors

**WebSocketError**
- Thrown when WebSocket connection fails
- User Message: "Conexão perdida. Reconectando..."
- Action: Automatic reconnection with exponential backoff

**MessageDeliveryError**
- Thrown when chat message fails to deliver
- User Message: "Mensagem não enviada. Tentar novamente?"
- Action: Queue message for retry

### Error Handling Strategy

#### Frontend Error Handling

```typescript
interface ErrorHandler {
  handleError(error: Error): void;
  displayError(message: string, type: ErrorType): void;
  logError(error: Error, context: Record<string, any>): void;
}

type ErrorType = 'validation' | 'auth' | 'network' | 'server' | 'unknown';

// Global error boundary for React
class GlobalErrorBoundary extends React.Component {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to error tracking service
    logError(error, { componentStack: errorInfo.componentStack });
    
    // Display user-friendly message
    displayError("Algo deu errado. Tente recarregar a página", 'unknown');
  }
}

// API error interceptor
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Attempt token refresh
      return refreshTokenAndRetry(error.config);
    }
    
    if (error.response?.status === 403) {
      displayError("Você não tem permissão para esta ação", 'auth');
    }
    
    if (!error.response) {
      displayError("Erro de conexão. Verifique sua internet", 'network');
    }
    
    return Promise.reject(error);
  }
);
```

#### Backend Error Handling

```typescript
// Global error handler middleware
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // Log error with context
  logger.error({
    error: err.message,
    stack: err.stack,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  // Determine error type and response
  if (err instanceof ValidationError) {
    return res.status(400).json({
      error: 'ValidationError',
      fields: err.fields
    });
  }
  
  if (err instanceof UnauthorizedError) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Autenticação necessária'
    });
  }
  
  // Default to 500 for unknown errors
  res.status(500).json({
    error: 'InternalServerError',
    message: 'Erro interno do servidor'
  });
}

// Database error handler
function handleDatabaseError(err: any): never {
  if (err.code === '23505') { // Unique violation
    throw new DuplicateError(err.detail);
  }
  
  if (err.code === '23503') { // Foreign key violation
    throw new ValidationError({ reference: ['Referência inválida'] });
  }
  
  // Log and throw generic error
  logger.error('Database error:', err);
  throw new DatabaseError('Erro ao acessar banco de dados');
}
```

### Retry Logic

```typescript
interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  let delay = config.initialDelay;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxAttempts) {
        break;
      }
      
      // Wait before retry
      await sleep(delay);
      
      // Exponential backoff
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }
  
  throw lastError!;
}

// Usage for geocoding
const geocodeWithRetry = (address: string) =>
  retryWithBackoff(
    () => geocodeService.geocode(address),
    {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2
    }
  );
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime?: number;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number,
    private timeout: number
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime! > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failureCount = 0;
    this.state = 'closed';
  }
  
  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
    }
  }
}

// Usage for external services
const geocodeCircuitBreaker = new CircuitBreaker(5, 60000); // 5 failures, 60s timeout
```



## Testing Strategy

### Overview

FreteGO utiliza uma abordagem dual de testes: testes unitários para casos específicos e edge cases, e testes baseados em propriedades (property-based testing) para validação universal de comportamentos. Esta combinação garante cobertura abrangente e confiança na corretude do sistema.

### Property-Based Testing

Property-based testing valida que propriedades universais se mantêm verdadeiras para todos os inputs válidos. Utilizaremos a biblioteca **fast-check** para JavaScript/TypeScript.

#### Configuration

- Minimum 100 iterations per property test
- Each test must reference its design document property
- Tag format: `Feature: fretego, Property {number}: {property_text}`

#### Example Property Tests

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './auth';

describe('Property Tests - Authentication', () => {
  // Feature: fretego, Property 1: Password Hashing Verification
  it('should verify any hashed password against original', () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 6, maxLength: 100 }),
        async (password) => {
          const hash = await hashPassword(password);
          const isValid = await verifyPassword(password, hash);
          expect(isValid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: fretego, Property 2: Password Validation Rules
  it('should accept passwords with 6+ chars, 1+ letter, 1+ number', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 6, maxLength: 100 }),
        (password) => {
          const hasLetter = /[a-zA-Z]/.test(password);
          const hasNumber = /[0-9]/.test(password);
          const isValid = validatePassword(password);
          
          expect(isValid).toBe(hasLetter && hasNumber);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property Tests - Filters', () => {
  // Feature: fretego, Property 9: Filter Matching
  it('should return only fretes matching all filter criteria', () => {
    fc.assert(
      fc.property(
        fc.array(freteArbitrary()),
        fc.record({
          originCity: fc.option(fc.string(), { nil: undefined }),
          cargoType: fc.option(fc.string(), { nil: undefined }),
          minValue: fc.option(fc.float({ min: 0 }), { nil: undefined })
        }),
        (fretes, filters) => {
          const results = applyFilters(fretes, filters);
          
          results.forEach(frete => {
            if (filters.originCity) {
              expect(frete.origin).toContain(filters.originCity);
            }
            if (filters.cargoType) {
              expect(frete.cargoType).toBe(filters.cargoType);
            }
            if (filters.minValue !== undefined) {
              expect(frete.value).toBeGreaterThanOrEqual(filters.minValue);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: fretego, Property 20: Filter Composition (AND Logic)
  it('should apply filters with AND logic, not OR', () => {
    fc.assert(
      fc.property(
        fc.array(freteArbitrary()),
        fc.string(),
        fc.string(),
        (fretes, originCity, cargoType) => {
          const filter1Results = applyFilters(fretes, { originCity });
          const filter2Results = applyFilters(fretes, { cargoType });
          const bothFiltersResults = applyFilters(fretes, { originCity, cargoType });
          
          // Result should be intersection, not union
          expect(bothFiltersResults.length).toBeLessThanOrEqual(
            Math.min(filter1Results.length, filter2Results.length)
          );
          
          // Every result should satisfy both conditions
          bothFiltersResults.forEach(frete => {
            expect(frete.origin).toContain(originCity);
            expect(frete.cargoType).toBe(cargoType);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property Tests - Serialization', () => {
  // Feature: fretego, Property 18: Serialization Round Trip
  it('should preserve object equality after serialize/deserialize', () => {
    fc.assert(
      fc.property(
        freteArbitrary(),
        (frete) => {
          const json = JSON.stringify(frete);
          const deserialized = JSON.parse(json);
          
          expect(deserialized).toEqual(frete);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Custom arbitraries for domain objects
function freteArbitrary() {
  return fc.record({
    id: fc.uuid(),
    embarcadorId: fc.uuid(),
    origin: fc.string({ minLength: 3, maxLength: 100 }),
    destination: fc.string({ minLength: 3, maxLength: 100 }),
    cargoType: fc.constantFrom('Grãos', 'Carga Seca', 'Refrigerada', 'Líquidos'),
    vehicleType: fc.constantFrom('Carreta', 'Truck', 'Toco', 'Bitrem'),
    weight: fc.float({ min: 100, max: 50000 }),
    value: fc.float({ min: 500, max: 50000 }),
    status: fc.constantFrom('ativo', 'encerrado', 'cancelado'),
    viewsCount: fc.nat(),
    clicksCount: fc.nat()
  });
}
```

### Unit Testing

Unit tests focus on specific examples, edge cases, and integration points.

#### Example Unit Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { validatePassword } from './auth';

describe('Unit Tests - Password Validation', () => {
  it('should reject password with less than 6 characters', () => {
    expect(validatePassword('abc12')).toBe(false);
  });

  it('should reject password without letters', () => {
    expect(validatePassword('123456')).toBe(false);
  });

  it('should reject password without numbers', () => {
    expect(validatePassword('abcdef')).toBe(false);
  });

  it('should accept valid password', () => {
    expect(validatePassword('abc123')).toBe(true);
  });

  it('should accept password with special characters', () => {
    expect(validatePassword('abc123!@#')).toBe(true);
  });
});

describe('Unit Tests - Frete Click Counter', () => {
  it('should increment clicks_count by 1', async () => {
    const frete = await createTestFrete();
    const initialCount = frete.clicksCount;
    
    await recordFreteClick(frete.id, testMotoristaId);
    
    const updated = await getFreteById(frete.id);
    expect(updated.clicksCount).toBe(initialCount + 1);
  });

  it('should not increment on duplicate click from same motorista', async () => {
    const frete = await createTestFrete();
    
    await recordFreteClick(frete.id, testMotoristaId);
    const countAfterFirst = (await getFreteById(frete.id)).clicksCount;
    
    await recordFreteClick(frete.id, testMotoristaId);
    const countAfterSecond = (await getFreteById(frete.id)).clicksCount;
    
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
```

### Integration Testing

Integration tests verify that components work together correctly.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestClient } from './test-utils';

describe('Integration Tests - Frete Workflow', () => {
  let embarcadorClient: TestClient;
  let motoristaClient: TestClient;

  beforeAll(async () => {
    embarcadorClient = await createTestClient('embarcador');
    motoristaClient = await createTestClient('motorista');
  });

  it('should complete full frete posting and contracting flow', async () => {
    // Embarcador posts frete
    const frete = await embarcadorClient.post('/api/fretes', {
      origin: 'São Paulo, SP',
      destination: 'Rio de Janeiro, RJ',
      cargoType: 'Grãos',
      vehicleType: 'Carreta',
      weight: 25000,
      value: 5000,
      deadline: '2024-12-31'
    });
    
    expect(frete.id).toBeDefined();
    expect(frete.status).toBe('ativo');
    
    // Motorista views frete (public access)
    const publicFrete = await motoristaClient.get(`/api/fretes/${frete.id}`);
    expect(publicFrete.origin).toBe('São Paulo, SP');
    
    // Motorista clicks to contract
    await motoristaClient.post(`/api/fretes/${frete.id}/click`);
    
    // Verify click was recorded
    const analytics = await embarcadorClient.get(`/api/fretes/${frete.id}/analytics`);
    expect(analytics.clicksCount).toBe(1);
  });
});

describe('Integration Tests - Chat System', () => {
  it('should deliver messages in real-time between user and admin', async () => {
    const userClient = await createTestClient('motorista');
    const adminClient = await createTestClient('admin');
    
    // User sends message
    const message = await userClient.post('/api/chat/messages', {
      message: 'Preciso de ajuda'
    });
    
    // Admin should see message
    const conversations = await adminClient.get('/api/chat/conversations');
    const userConversation = conversations.find(c => c.userId === userClient.userId);
    
    expect(userConversation).toBeDefined();
    expect(userConversation.lastMessage.message).toBe('Preciso de ajuda');
    
    // Admin responds
    await adminClient.post(`/api/chat/conversations/${userConversation.id}/messages`, {
      message: 'Como posso ajudar?'
    });
    
    // User should see response
    const messages = await userClient.get(`/api/chat/conversations/${userConversation.id}/messages`);
    expect(messages).toHaveLength(2);
    expect(messages[1].message).toBe('Como posso ajudar?');
  });
});
```

### End-to-End Testing

E2E tests validate complete user workflows using Playwright.

```typescript
import { test, expect } from '@playwright/test';

test.describe('E2E - Motorista Registration and Frete Search', () => {
  test('should register as motorista and search for fretes', async ({ page }) => {
    // Navigate to home
    await page.goto('/');
    
    // Click register as motorista
    await page.click('text=Sou Motorista');
    
    // Fill registration form
    await page.fill('[name="phone"]', '11999999999');
    await page.fill('[name="password"]', 'senha123');
    await page.fill('[name="name"]', 'João Silva');
    await page.click('button[type="submit"]');
    
    // Should redirect to dashboard
    await expect(page).toHaveURL('/motorista/dashboard');
    await expect(page.locator('text=João Silva')).toBeVisible();
    
    // Search for fretes
    await page.fill('[placeholder="Origem"]', 'São Paulo');
    await page.click('button:has-text("Buscar")');
    
    // Should display results
    await expect(page.locator('[data-testid="frete-card"]')).toHaveCount.greaterThan(0);
    
    // Click on first frete
    await page.locator('[data-testid="frete-card"]').first().click();
    
    // Should open modal with details
    await expect(page.locator('[data-testid="frete-modal"]')).toBeVisible();
    await expect(page.locator('text=Contratar')).toBeVisible();
  });
});

test.describe('E2E - Embarcador Post Frete', () => {
  test('should post new frete and view analytics', async ({ page }) => {
    // Login as embarcador
    await page.goto('/login');
    await page.fill('[name="phone"]', '11988888888');
    await page.fill('[name="password"]', 'senha123');
    await page.click('button[type="submit"]');
    
    // Navigate to post frete
    await page.click('text=Postar Frete');
    
    // Fill frete form
    await page.fill('[name="origin"]', 'São Paulo, SP');
    await page.fill('[name="destination"]', 'Curitiba, PR');
    await page.selectOption('[name="cargoType"]', 'Grãos');
    await page.selectOption('[name="vehicleType"]', 'Carreta');
    await page.fill('[name="weight"]', '25000');
    await page.fill('[name="value"]', '5000');
    await page.fill('[name="deadline"]', '2024-12-31');
    await page.click('button:has-text("Publicar")');
    
    // Should show success message
    await expect(page.locator('text=Frete publicado com sucesso')).toBeVisible();
    
    // Should appear in my fretes list
    await page.click('text=Meus Fretes');
    await expect(page.locator('text=São Paulo, SP')).toBeVisible();
    await expect(page.locator('text=Curitiba, PR')).toBeVisible();
  });
});
```

### Security Testing

```typescript
describe('Security Tests', () => {
  it('should prevent SQL injection in search', async () => {
    const maliciousInput = "'; DROP TABLE fretes; --";
    const results = await searchFretes({ originCity: maliciousInput });
    
    // Should return empty results, not throw error
    expect(results).toEqual([]);
    
    // Verify table still exists
    const allFretes = await getAllFretes();
    expect(allFretes).toBeDefined();
  });

  it('should prevent unauthorized access to other user documents', async () => {
    const motorista1Client = await createTestClient('motorista');
    const motorista2Client = await createTestClient('motorista');
    
    // Motorista 1 uploads document
    const doc = await motorista1Client.uploadDocument('cnh', testFile);
    
    // Motorista 2 tries to access
    const response = await motorista2Client.get(`/api/documents/${doc.id}`);
    
    expect(response.status).toBe(403);
  });

  it('should reject requests without valid JWT', async () => {
    const response = await fetch('/api/fretes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* frete data */ })
    });
    
    expect(response.status).toBe(401);
  });
});
```

### Performance Testing

```typescript
describe('Performance Tests', () => {
  it('should load fretes page within 2 seconds', async () => {
    const start = Date.now();
    await page.goto('/fretes');
    await page.waitForSelector('[data-testid="frete-card"]');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(2000);
  });

  it('should handle 100 concurrent frete searches', async () => {
    const searches = Array.from({ length: 100 }, () =>
      searchFretes({ originCity: 'São Paulo' })
    );
    
    const start = Date.now();
    await Promise.all(searches);
    const duration = Date.now() - start;
    
    // Should complete within reasonable time
    expect(duration).toBeLessThan(5000);
  });
});
```

### Test Coverage Goals

- Unit Tests: 80%+ code coverage
- Integration Tests: All critical user flows
- E2E Tests: All main user journeys
- Property Tests: All correctness properties from design
- Security Tests: All authentication and authorization paths
- Performance Tests: All user-facing pages and API endpoints

### Continuous Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

