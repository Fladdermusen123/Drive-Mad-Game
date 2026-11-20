/*
# Create ai_solutions table for the Drive Mad AI driver

1. New Tables
- `ai_solutions`
  - `id` (uuid, primary key, auto-generated)
  - `level_key` (text, not null): identifier for the level the solution belongs to (e.g. "level-1")
  - `strategy` (jsonb, not null): the learned driving policy parameters (throttle/brake tendencies, timing plan, control profile)
  - `fitness` (double precision, not null): how far the attempt got, higher is better (distance + speed + survival time)
  - `distance` (double precision, not null): furthest distance reached during the attempt
  - `completed` (boolean, not null, default false): whether the level was finished
  - `duration_ms` (integer, not null, default 0): how long the successful attempt took
  - `attempt` (integer, not null, default 1): which training attempt produced this solution
  - `created_at` (timestamptz, default now())
  - Index on `level_key` for fast lookups.

2. Security
- Enable RLS on `ai_solutions`.
- Grant SELECT, INSERT, UPDATE, DELETE to `anon` + `authenticated` (no sign-in in this app, data is intentionally shared so the AI can learn across sessions).
- Public read/write policies for anon + authenticated.

3. Notes
- No user accounts exist in this app, so rows are shared rather than owner-scoped.
*/

CREATE TABLE IF NOT EXISTS ai_solutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_key text NOT NULL,
  strategy jsonb NOT NULL,
  fitness double precision NOT NULL DEFAULT 0,
  distance double precision NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_solutions_level ON ai_solutions (level_key);

ALTER TABLE ai_solutions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_solutions TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_ai_solutions" ON ai_solutions;
CREATE POLICY "anon_select_ai_solutions" ON ai_solutions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ai_solutions" ON ai_solutions;
CREATE POLICY "anon_insert_ai_solutions" ON ai_solutions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ai_solutions" ON ai_solutions;
CREATE POLICY "anon_update_ai_solutions" ON ai_solutions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_ai_solutions" ON ai_solutions;
CREATE POLICY "anon_delete_ai_solutions" ON ai_solutions
  FOR DELETE TO anon, authenticated USING (true);
