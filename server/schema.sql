-- PostgreSQL production schema for Deskline M1
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL, name text NOT NULL, role text NOT NULL CHECK (role IN ('admin','manager','kam')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,email));
CREATE TABLE IF NOT EXISTS inventory_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), centre text NOT NULL, unit_name text NOT NULL, product_type text NOT NULL, market text NOT NULL, seats int NOT NULL, price numeric(12,2) NOT NULL, floor_price numeric(12,2) NOT NULL, available int NOT NULL DEFAULT 0, available_from date, amenities jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), company text NOT NULL, contact text, source text, channel text, stage text NOT NULL DEFAULT 'CAPTURED', score int, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS requirements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE, product_type text, seats int, market text, budget numeric(12,2), move_in_date date, tenure text, fit_out text, notes text, confidence jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
-- Application transaction should SET LOCAL app.tenant_id before queries.
CREATE POLICY tenant_inventory ON inventory_units USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_leads ON leads USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_users ON users USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_requirements ON requirements USING (lead_id IN (SELECT id FROM leads WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
