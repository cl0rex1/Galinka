import { cpSync, rmSync } from 'node:fs';
rmSync('dist-server/schema.sql', { force: true });
rmSync('dist-server/migrations', { recursive: true, force: true });
cpSync('server/migrations', 'dist-server/migrations', { recursive: true });
