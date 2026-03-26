-- FreteGO Database Schema
-- Migration 002: Database Functions and Triggers

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RATING FUNCTIONS
-- ============================================================================

-- Function to update embarcador rating after new rating is added
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

-- ============================================================================
-- FRETE FUNCTIONS
-- ============================================================================

-- Function to increment frete views count
CREATE OR REPLACE FUNCTION increment_frete_views(frete_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE fretes
  SET views_count = views_count + 1,
      updated_at = NOW()
  WHERE id = frete_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to record frete click and update counter
CREATE OR REPLACE FUNCTION record_frete_click(
  frete_id_param UUID,
  motorista_id_param UUID
)
RETURNS VOID AS $$
BEGIN
  -- Insert click record (will be ignored if duplicate due to UNIQUE constraint)
  INSERT INTO frete_clicks (frete_id, motorista_id)
  VALUES (frete_id_param, motorista_id_param)
  ON CONFLICT (frete_id, motorista_id) DO NOTHING;
  
  -- Update clicks count based on actual records
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

-- ============================================================================
-- GEOLOCATION FUNCTIONS
-- ============================================================================

-- Function to find nearby fretes within a radius
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

-- Function to calculate distance between two points in kilometers
CREATE OR REPLACE FUNCTION calculate_distance(
  point1 GEOGRAPHY,
  point2 GEOGRAPHY
)
RETURNS DOUBLE PRECISION AS $$
BEGIN
  RETURN ST_Distance(point1, point2) / 1000;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- USER ACTIVITY FUNCTIONS
-- ============================================================================

-- Function to record user activity (for online status tracking)
CREATE OR REPLACE FUNCTION record_user_activity(user_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET last_activity_at = NOW()
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get online users (active in last 5 minutes)
CREATE OR REPLACE FUNCTION get_online_users_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM users
    WHERE last_activity_at > NOW() - INTERVAL '5 minutes'
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ANALYTICS FUNCTIONS
-- ============================================================================

-- Function to get platform metrics
CREATE OR REPLACE FUNCTION get_platform_metrics()
RETURNS TABLE (
  total_active_users INTEGER,
  total_inactive_users INTEGER,
  total_motoristas INTEGER,
  total_embarcadores INTEGER,
  active_fretes INTEGER,
  completed_fretes INTEGER,
  online_users INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM users WHERE is_active = true),
    (SELECT COUNT(*)::INTEGER FROM users WHERE is_active = false),
    (SELECT COUNT(*)::INTEGER FROM motoristas),
    (SELECT COUNT(*)::INTEGER FROM embarcadores),
    (SELECT COUNT(*)::INTEGER FROM fretes WHERE status = 'ativo'),
    (SELECT COUNT(*)::INTEGER FROM fretes WHERE status = 'encerrado'),
    get_online_users_count();
END;
$$ LANGUAGE plpgsql;

-- Function to get user growth data
CREATE OR REPLACE FUNCTION get_user_growth(
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  date DATE,
  user_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) as date,
    COUNT(*) as user_count
  FROM users
  WHERE created_at BETWEEN start_date AND end_date
  GROUP BY DATE(created_at)
  ORDER BY date ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get frete growth data
CREATE OR REPLACE FUNCTION get_frete_growth(
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  date DATE,
  frete_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) as date,
    COUNT(*) as frete_count
  FROM fretes
  WHERE created_at BETWEEN start_date AND end_date
  GROUP BY DATE(created_at)
  ORDER BY date ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CHAT FUNCTIONS
-- ============================================================================

-- Function to get unread message count for a conversation
CREATE OR REPLACE FUNCTION get_unread_message_count(
  conversation_id_param UUID,
  user_id_param UUID
)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM chat_messages
    WHERE conversation_id = conversation_id_param
      AND sender_id != user_id_param
      AND read_at IS NULL
  );
END;
$$ LANGUAGE plpgsql;

-- Function to mark all messages in a conversation as read
CREATE OR REPLACE FUNCTION mark_messages_as_read(
  conversation_id_param UUID,
  user_id_param UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE chat_messages
  SET read_at = NOW()
  WHERE conversation_id = conversation_id_param
    AND sender_id != user_id_param
    AND read_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to update updated_at on users table
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on motoristas table
CREATE TRIGGER update_motoristas_updated_at
BEFORE UPDATE ON motoristas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on embarcadores table
CREATE TRIGGER update_embarcadores_updated_at
BEFORE UPDATE ON embarcadores
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on fretes table
CREATE TRIGGER update_fretes_updated_at
BEFORE UPDATE ON fretes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on chat_conversations table
CREATE TRIGGER update_chat_conversations_updated_at
BEFORE UPDATE ON chat_conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update embarcador rating after new rating is added or updated
CREATE TRIGGER trigger_update_embarcador_rating
AFTER INSERT OR UPDATE ON avaliacoes
FOR EACH ROW
EXECUTE FUNCTION update_embarcador_rating();

-- Trigger to update conversation updated_at when new message is added
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_on_message
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_on_message();
