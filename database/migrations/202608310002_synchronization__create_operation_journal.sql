CREATE TABLE surfaces (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  surface_id text NOT NULL CHECK (length(surface_id) BETWEEN 1 AND 160),
  revision bigint NOT NULL CHECK (revision > 0),
  state bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, surface_id)
);

CREATE TABLE workspace_operations (
  sequence bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor_session_id uuid NOT NULL REFERENCES device_sessions(id),
  protocol_version integer NOT NULL,
  intent jsonb NOT NULL,
  receipt jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, operation_id)
);

CREATE TABLE surface_updates (
  workspace_id uuid NOT NULL,
  surface_id text NOT NULL,
  revision bigint NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  operation_id uuid NOT NULL,
  payload bytea NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, surface_id, revision, ordinal),
  FOREIGN KEY (workspace_id, surface_id)
    REFERENCES surfaces(workspace_id, surface_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, operation_id)
    REFERENCES workspace_operations(workspace_id, operation_id) ON DELETE CASCADE
);

CREATE INDEX workspace_operations_recovery_idx
  ON workspace_operations (workspace_id, sequence);

CREATE INDEX surface_updates_operation_idx
  ON surface_updates (workspace_id, operation_id, ordinal);
