-- Android builds that draw their own notification (Reply / Mark as read) take data-only pushes.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS native_actions boolean NOT NULL DEFAULT false;
