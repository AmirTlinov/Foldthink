CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE device_sessions (
  id uuid PRIMARY KEY,
  secret_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, session_id)
);

CREATE TABLE bootstrap_claims (
  bootstrap_hash bytea PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE join_capabilities (
  token_hash bytea PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by_session_id uuid NOT NULL REFERENCES device_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_sessions_active_secret_idx
  ON device_sessions (secret_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX workspace_members_session_idx
  ON workspace_members (session_id, workspace_id);
