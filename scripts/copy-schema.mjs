import { copyFileSync } from 'node:fs';
copyFileSync('server/schema.sql', 'dist-server/schema.sql');
