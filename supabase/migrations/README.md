# FreteGO Database Migrations

This directory contains SQL migration files for the FreteGO database schema.

## Migration Files

### 001_initial_schema.sql
**Purpose**: Creates the foundational database structure

**Contents**:
- Enables required PostgreSQL extensions (`uuid-ossp`, `postgis`)
- Creates 11 core tables:
  - `users` - Base user table for all user types
  - `motoristas` - Motorista-specific data (extends users)
  - `embarcadores` - Embarcador-specific data (extends users)
  - `fretes` - Freight/cargo listings
  - `frete_clicks` - Click tracking for analytics
  - `avaliacoes` - Rating system for embarcadores
  - `chat_conversations` - Support chat conversations
  - `chat_messages` - Chat messages
  - `documents` - User document storage metadata
  - `notifications` - User notifications
  - `audit_logs` - System audit trail
- Creates performance indexes for all tables
- Implements geographic indexes using PostGIS for location-based queries

**Key Features**:
- UUID primary keys for all tables
- Geographic data types for location tracking
- Proper foreign key relationships with CASCADE deletes
- Timestamp tracking (created_at, updated_at)
- Check constraints for data validation

### 002_functions_and_triggers.sql
**Purpose**: Implements database-level business logic and automation

**Functions**:
- `update_updated_at_column()` - Auto-updates timestamp on row changes
- `update_embarcador_rating()` - Recalculates embarcador average rating
- `increment_frete_views()` - Increments view counter for fretes
- `record_frete_click()` - Records click and updates counter (prevents duplicates)
- `find_nearby_fretes()` - Geographic search for fretes within radius
- `calculate_distance()` - Calculates distance between two geographic points
- `record_user_activity()` - Updates user last activity timestamp
- `get_online_users_count()` - Returns count of users active in last 5 minutes
- `get_platform_metrics()` - Returns comprehensive platform statistics
- `get_user_growth()` - Returns user registration growth data
- `get_frete_growth()` - Returns frete posting growth data
- `get_unread_message_count()` - Returns unread message count for conversation
- `mark_messages_as_read()` - Marks all messages in conversation as read

**Triggers**:
- Auto-update `updated_at` on all tables with that column
- Auto-recalculate embarcador rating when new rating is added
- Auto-update conversation timestamp when new message is added

### 003_rls_policies.sql
**Purpose**: Implements Row Level Security for data protection

**Security Model**:
- **Users**: Can view/update own data; admins can view/update all
- **Motoristas**: Can view/update own profile; admins have full access
- **Embarcadores**: Can view/update own profile; motoristas can view public info
- **Fretes**: Public read for active fretes; only owner can modify
- **Documents**: Strict isolation - only owner and admins can access
- **Chat**: Only conversation participants can view/send messages
- **Notifications**: Users can only see their own notifications
- **Audit Logs**: Admin-only access

**Key Policies**:
- Anonymous users can view active fretes (public marketplace)
- Users cannot access other users' private data
- Admins have full access to all tables
- Immutable records (audit logs, clicks) cannot be updated

## Running Migrations

### Using Supabase CLI (Recommended)

```bash
# Link to your project
supabase link --project-ref your-project-ref

# Push all migrations
supabase db push

# Or push specific migration
supabase db push --file supabase/migrations/001_initial_schema.sql
```

### Manual Execution

1. Open Supabase Dashboard > SQL Editor
2. Copy content from migration file
3. Paste and execute
4. Repeat for each file in order (001, 002, 003)

## Verification

After running migrations, verify:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check extensions
SELECT * FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'postgis');

-- Check functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Check policies exist
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public';
```

## Rollback

To rollback migrations (use with caution):

```sql
-- Drop all tables (will cascade to dependent objects)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS avaliacoes CASCADE;
DROP TABLE IF EXISTS frete_clicks CASCADE;
DROP TABLE IF EXISTS fretes CASCADE;
DROP TABLE IF EXISTS embarcadores CASCADE;
DROP TABLE IF EXISTS motoristas CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS update_embarcador_rating CASCADE;
DROP FUNCTION IF EXISTS increment_frete_views CASCADE;
DROP FUNCTION IF EXISTS record_frete_click CASCADE;
DROP FUNCTION IF EXISTS find_nearby_fretes CASCADE;
DROP FUNCTION IF EXISTS calculate_distance CASCADE;
DROP FUNCTION IF EXISTS record_user_activity CASCADE;
DROP FUNCTION IF EXISTS get_online_users_count CASCADE;
DROP FUNCTION IF EXISTS get_platform_metrics CASCADE;
DROP FUNCTION IF EXISTS get_user_growth CASCADE;
DROP FUNCTION IF EXISTS get_frete_growth CASCADE;
DROP FUNCTION IF EXISTS get_unread_message_count CASCADE;
DROP FUNCTION IF EXISTS mark_messages_as_read CASCADE;
```

## Testing Migrations

### Test RLS Policies

```sql
-- Test as anonymous user (should see active fretes only)
SET ROLE anon;
SELECT * FROM fretes; -- Should only return active fretes
RESET ROLE;

-- Test document isolation
-- Create test users and verify they can't access each other's documents
```

### Test Functions

```sql
-- Test rating calculation
INSERT INTO avaliacoes (embarcador_id, motorista_id, rating) 
VALUES ('uuid1', 'uuid2', 5);
-- Check embarcador rating was updated

-- Test nearby fretes
SELECT * FROM find_nearby_fretes(
  ST_GeogFromText('POINT(-46.6333 -23.5505)'), -- São Paulo coordinates
  100 -- 100km radius
);

-- Test platform metrics
SELECT * FROM get_platform_metrics();
```

## Migration Best Practices

1. **Always backup** before running migrations in production
2. **Test migrations** in development environment first
3. **Run migrations in order** (001, 002, 003)
4. **Verify each migration** before proceeding to next
5. **Monitor performance** after adding indexes
6. **Review RLS policies** to ensure proper data isolation

## Troubleshooting

**Error: Extension "postgis" not available**
- Solution: PostGIS should be available in Supabase by default. Contact support if not.

**Error: Permission denied**
- Solution: Ensure you're using the service role key for migrations, not anon key.

**Error: Relation already exists**
- Solution: Migration was already run. Check existing schema or rollback first.

**RLS blocking queries**
- Solution: Verify you're authenticated with correct user type. Check policy conditions.

## Additional Resources

- [Supabase Database Documentation](https://supabase.com/docs/guides/database)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
