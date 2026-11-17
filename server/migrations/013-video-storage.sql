-- Publish the converted video by committing its database pointer. Old rows
-- still use the existing UUID filename, including MP4s made by older servers.
ALTER TABLE files ADD COLUMN converted_video boolean NOT NULL DEFAULT false;
