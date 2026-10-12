ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by TEXT;
UPDATE tasks SET created_by = 'legacy-migration' WHERE created_by IS NULL;
ALTER TABLE tasks ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_org_id_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_org_id_unique UNIQUE (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_org_id_unique') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_org_id_unique UNIQUE (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_project_tenant_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_project_tenant_fk
      FOREIGN KEY (organization_id, project_id)
      REFERENCES projects(organization_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_tenant_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_tenant_fk
      FOREIGN KEY (organization_id, assignee_id)
      REFERENCES users(organization_id, id) ON DELETE SET NULL (assignee_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES background_jobs(id),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS task_audit_logs_append_only ON task_audit_logs;
CREATE TRIGGER task_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON task_audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE INDEX IF NOT EXISTS idx_projects_org_updated
  ON projects (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_org_updated
  ON tasks (organization_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_project_status
  ON tasks (organization_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee
  ON tasks (organization_id, assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_due_date
  ON tasks (organization_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_status
  ON tasks (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_task_audit_org_created
  ON task_audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_background_jobs_ready
  ON background_jobs (run_at, created_at) WHERE status = 'pending';

INSERT INTO organizations (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Demo Organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, organization_id, name, description)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Getting Started',
  'Sample project for local development.'
)
ON CONFLICT (id) DO NOTHING;
