CREATE TABLE deleted_workspaces (
  workspace_id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL,
  backup_retention_until timestamptz NOT NULL,
  CHECK (backup_retention_until >= deleted_at)
);

CREATE TABLE asset_deletion_queue (
  object_key text PRIMARY KEY CHECK (length(object_key) BETWEEN 1 AND 1024),
  workspace_id uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500)
);

CREATE INDEX asset_deletion_queue_pending_idx
  ON asset_deletion_queue (queued_at)
  WHERE completed_at IS NULL;

CREATE FUNCTION delete_workspace_active_data(
  target_workspace_id uuid,
  actor_session_id uuid,
  retention_days integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  queued_assets integer;
BEGIN
  IF retention_days < 1 OR retention_days > 365 THEN
    RAISE EXCEPTION 'backup retention must be between one and 365 days'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

  IF NOT EXISTS (
    SELECT 1
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      JOIN device_sessions ds ON ds.id = wm.session_id
     WHERE w.id = target_workspace_id
       AND w.deleted_at IS NULL
       AND wm.session_id = actor_session_id
       AND wm.role = 'owner'
       AND ds.revoked_at IS NULL
       AND ds.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'only an active owner can delete this workspace'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO deleted_workspaces (workspace_id, deleted_at, backup_retention_until)
  VALUES (
    target_workspace_id,
    now(),
    now() + make_interval(days => retention_days)
  );

  INSERT INTO asset_deletion_queue (object_key, workspace_id)
  SELECT object_key, workspace_id
    FROM assets
   WHERE workspace_id = target_workspace_id
  ON CONFLICT (object_key) DO NOTHING;
  GET DIAGNOSTICS queued_assets = ROW_COUNT;

  DELETE FROM workspaces WHERE id = target_workspace_id;

  DELETE FROM device_sessions ds
   WHERE NOT EXISTS (
     SELECT 1 FROM workspace_members wm WHERE wm.session_id = ds.id
   );

  RETURN queued_assets;
END;
$$;
