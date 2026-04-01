# Supabase Setup Guide - FreteGO

## Task 2.1: Criar projeto no Supabase

### Step 1: Create Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Fill in the project details:
   - **Name**: FreteGO (or your preferred name)
   - **Database Password**: Choose a strong password (save it securely!)
   - **Region**: Choose closest to your users (e.g., South America for Brazil)
   - **Pricing Plan**: Free tier is sufficient for development

4. Click "Create new project" and wait for provisioning (2-3 minutes)

### Step 2: Get Project Credentials

Once your project is ready:

1. Go to **Settings** > **API** in the left sidebar
2. You'll find these important values:

   - **Project URL**: `https://xxxxxxxxxxxxx.supabase.co`
   - **Project API keys**:
     - `anon` `public` key (safe for frontend)
     - `service_role` key (NEVER expose in frontend!)

### Step 3: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and replace the placeholder values:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   VITE_SUPABASE_SERVICE_KEY=your-service-role-key-here
   ```

3. **IMPORTANT**: Never commit `.env` to version control! It's already in `.gitignore`.

### Step 4: Verify Connection

After setting up the environment variables, you can verify the connection by running:

```bash
npm run dev
```

The application should start without Supabase connection errors.

### Step 5: Enable Required Extensions

The extensions will be enabled automatically when you run the migration files:
- `uuid-ossp` - for UUID generation
- `postgis` - for geographic/location queries

These are enabled in `supabase/migrations/001_initial_schema.sql`.

### Step 6: Run Database Migrations

To create all tables, indexes, functions, triggers, and RLS policies:

**Option A: Using Supabase CLI (Recommended)**

1. Install Supabase CLI (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. Link your project:
   ```bash
   supabase link --project-ref your-project-id
   ```
   
   Find your project-ref in the Supabase Dashboard URL: `https://supabase.com/dashboard/project/[your-project-ref]`

3. Run migrations:
   ```bash
   supabase db push
   ```

**Option B: Manual SQL Execution**

Run the SQL files in order in the Supabase SQL Editor:

1. Go to **SQL Editor** in Supabase Dashboard
2. Create a new query
3. Copy and paste content from `supabase/migrations/001_initial_schema.sql`
4. Click "Run" (or press Ctrl+Enter)
5. Wait for success confirmation
6. Repeat for `002_functions_and_triggers.sql`
7. Repeat for `003_rls_policies.sql`

**Migration Files Overview:**
- `001_initial_schema.sql` - Creates all tables, indexes, and enables extensions
- `002_functions_and_triggers.sql` - Creates database functions and triggers for automation
- `003_rls_policies.sql` - Implements Row Level Security policies for data protection

**Verify Migrations:**

After running migrations, verify in Supabase Dashboard:
- **Table Editor**: Check that all 11 tables exist
- **Database** > **Extensions**: Verify `uuid-ossp` and `postgis` are enabled
- **Database** > **Functions**: Check that custom functions are created
- **Authentication** > **Policies**: Verify RLS policies are active

### Security Checklist

- [ ] Project created with strong database password
- [ ] Environment variables configured in `.env`
- [ ] `.env` file is in `.gitignore` (already done)
- [ ] Service role key is NEVER used in frontend code
- [ ] Anon key is used for frontend Supabase client
- [ ] Database extensions enabled (uuid-ossp, postgis)

### Next Steps

After completing this setup:
- ✅ Task 2.1 Complete: Supabase project configured
- ➡️ Task 2.2: Database schema will be created by running migrations
- ➡️ Task 2.3: RLS policies will be applied
- ➡️ Task 2.4-2.5: Property-based tests for RLS (optional)

### Troubleshooting

**Connection Error**: Verify your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct.

**Extension Error**: Make sure you have permissions to enable extensions. Free tier should have this enabled by default.

**Migration Error**: Check the SQL Editor for detailed error messages. Ensure you're running migrations in order (001, 002, 003).

### Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [PostGIS Documentation](https://postgis.net/documentation/)
