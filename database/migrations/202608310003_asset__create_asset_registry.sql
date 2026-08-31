CREATE TABLE assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved', 'uploaded', 'ready', 'rejected', 'deleted')),
  purpose text NOT NULL CHECK (purpose IN ('user', 'derived')),
  mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 255),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 20000000),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  object_key text NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 1024),
  upload_token_hash bytea CHECK (upload_token_hash IS NULL OR octet_length(upload_token_hash) = 32),
  upload_expires_at timestamptz,
  derivation_key text,
  producer text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_session_id uuid NOT NULL REFERENCES device_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX assets_workspace_derivation_idx
  ON assets (workspace_id, derivation_key)
  WHERE derivation_key IS NOT NULL;

CREATE INDEX assets_workspace_state_idx
  ON assets (workspace_id, state, created_at);
