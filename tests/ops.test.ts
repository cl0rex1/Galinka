import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { migrate } from '../server/migrate.js';

const execFileAsync = promisify(execFile);
const database = process.env.TEST_DATABASE_URL;

function findSh(): string | null {
  if (process.platform !== 'win32') return 'sh';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

const shPath = findSh();

test(
  'migrations: applies numbered SQL files cleanly and stays idempotent',
  { skip: !database, timeout: 60000 },
  async () => {
    const adminPool = new Pool({ connectionString: database });
    const tempDbName = `galinka_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const targetUrl = new URL(database!);
    targetUrl.pathname = `/${tempDbName}`;
    let tempPool: Pool | undefined;
    try {
      await adminPool.query(`CREATE DATABASE "${tempDbName}"`);
      tempPool = new Pool({ connectionString: targetUrl.toString() });
      const first = await migrate(tempPool);
      assert.deepEqual(first, [
        '001-base.sql',
        '002-devices-and-signup-invites.sql',
        '003-presence-privacy-avatars.sql',
        '004-search-trgm.sql',
        '005-pins-and-forwarding.sql',
        '006-client-errors.sql',
        '007-messages-014.sql',
      ]);
      const second = await migrate(tempPool);
      assert.deepEqual(second, []);
      const { rows: migs } = await tempPool.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.equal(migs.length, 7);
      const { rows: tables } = await tempPool.query<{ exists: boolean }>(
        "SELECT to_regclass('public.client_errors') IS NOT NULL AS exists",
      );
      assert.equal(tables[0]?.exists, true);
    } finally {
      await tempPool?.end().catch(() => {});
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}" WITH (FORCE)`).catch(() => {});
      await adminPool.end();
    }
  },
);

test(
  'ops: metrics auth, prometheus exposition, client errors, and admin monitoring',
  { skip: !database, timeout: 60000 },
  async () => {
    const adminPool = new Pool({ connectionString: database });
    const tempDbName = `galinka_ops_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const targetUrl = new URL(database!);
    targetUrl.pathname = `/${tempDbName}`;
    await adminPool.query(`CREATE DATABASE "${tempDbName}"`);
    const tempDatabase = targetUrl.toString();
    const db = new Pool({ connectionString: tempDatabase });
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-ops-'));
    const base = 'http://localhost:3034';
    const uniqueError = `ops-error-${randomUUID()}`;
    let server: ChildProcess | undefined;
    let logs = '';

    async function request(url: string, method = 'GET', body?: unknown, cookie = '') {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Cookie: cookie,
          Origin: base,
          'User-Agent': 'galinka-ops-test',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        text,
        data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text,
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }

    try {
      server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: tempDatabase,
          PORT: '3034',
          INVITE_CODE: 'ops-test-shared-invite',
          APP_ORIGIN: base,
          UPLOAD_DIR: directory,
          METRICS_TOKEN: 'secret-metrics-token',
          NODE_ENV: 'test',
          PUSH_ENABLED: 'false',
          WEB_PUSH_PUBLIC_KEY: '',
          WEB_PUSH_PRIVATE_KEY: '',
          COOKIE_SECURE: 'false',
        },
        stdio: 'pipe',
      });
      server.stderr?.on('data', (chunk) => (logs += chunk));
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const suffix = randomUUID().slice(0, 8);
      const password = 'ops-password-strong';
      const owner = await request('/auth/register', 'POST', {
        username: 'opsadmin' + suffix,
        name: 'Ops Admin',
        password,
        invite: 'ops-test-shared-invite',
      });
      assert.equal(owner.status, 201, logs);

      // Non-admin user is rejected by admin monitoring and metrics endpoints.
      const unauthMetrics = await fetch(`${base}/api/metrics`);
      assert.equal(unauthMetrics.status, 401);
      const badTokenMetrics = await fetch(`${base}/api/metrics`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      assert.equal(badTokenMetrics.status, 401);
      const memberMetrics = await fetch(`${base}/api/metrics`, {
        headers: { Cookie: owner.cookie },
      });
      assert.equal(memberMetrics.status, 403);
      const memberMonitor = await request('/admin/monitoring', 'GET', undefined, owner.cookie);
      assert.equal(memberMonitor.status, 403);

      await db.query("UPDATE users SET role='admin' WHERE id=$1", [owner.data.id]);

      const reported = await request(
        '/client-errors',
        'POST',
        {
          message: uniqueError,
          stack: 'Error: boom\n  at app.ts:1:1',
          url: '/app',
          release: '0.13.0',
        },
        owner.cookie,
      );
      assert.equal(reported.status, 201);

      const monitoring = await request('/admin/monitoring', 'GET', undefined, owner.cookie);
      assert.equal(monitoring.status, 200);
      assert.equal(monitoring.data.health.ok, true);
      assert.ok(monitoring.data.metrics.requests.total >= 1);
      assert.ok(
        monitoring.data.errors.some(
          (entry: { message: string; username?: string }) =>
            entry.message === uniqueError && entry.username === 'opsadmin' + suffix,
        ),
      );

      const bearerMetrics = await fetch(`${base}/api/metrics`, {
        headers: { Authorization: 'Bearer secret-metrics-token' },
      });
      assert.equal(bearerMetrics.status, 200);
      assert.match(bearerMetrics.headers.get('content-type') || '', /text\/plain/);
      const prom = await bearerMetrics.text();
      assert.match(prom, /galinka_up 1/);
      assert.match(prom, /galinka_http_requests_total \d+/);
      assert.match(prom, /galinka_client_errors_total \d+/);

      const adminCookieMetrics = await fetch(`${base}/api/metrics`, {
        headers: { Cookie: owner.cookie },
      });
      assert.equal(adminCookieMetrics.status, 200);

      const cleared = await request('/admin/client-errors', 'DELETE', undefined, owner.cookie);
      assert.equal(cleared.status, 200);
      const afterClear = await request('/admin/monitoring', 'GET', undefined, owner.cookie);
      assert.equal(afterClear.status, 200);
      assert.equal(afterClear.data.errors.length, 0);
    } finally {
      server?.kill();
      await db.end().catch(() => {});
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}" WITH (FORCE)`).catch(() => {});
      await adminPool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'deploy.sh: backs up DB, detects failed health check, and rolls back automatically',
  { skip: !shPath, timeout: 30000 },
  async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'galinka-deploy-'));
    const posixDir = workDir.replace(/\\/g, '/');
    const prevSha = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const nextSha = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    let failNewVersion = true;

    const httpServer = createServer(async (req, res) => {
      let activeBuild = prevSha;
      try {
        activeBuild = (await readFile(path.join(workDir, 'active_build'), 'utf8')).trim();
      } catch {}
      if (req.url === '/api/health') {
        if (failNewVersion && activeBuild === nextSha) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.13.0', build: activeBuild }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      const port = (httpServer.address() as { port: number }).port;

      await writeFile(path.join(workDir, 'head'), `${prevSha}\n`);
      await writeFile(path.join(workDir, 'active_build'), `${prevSha}\n`);
      await writeFile(path.join(workDir, 'log'), '');

      const mockGit = `#!/bin/sh
set -eu
STATE="${posixDir}"
case "$1" in
  rev-parse)
    tr -d '\\r\\n' < "$STATE/head"
    ;;
  pull)
    printf 'git pull %s\\n' "$2" >> "$STATE/log"
    printf '%s\\n' "${nextSha}" > "$STATE/head"
    ;;
  reset)
    printf 'git reset %s %s\\n' "$2" "$3" >> "$STATE/log"
    printf '%s\\n' "$3" > "$STATE/head"
    ;;
  *)
    echo "unexpected git args: $*" >&2
    exit 2
    ;;
esac
`;
      const mockCompose = `#!/bin/sh
set -eu
STATE="${posixDir}"
case "$1" in
  exec)
    shift 3
    case "$*" in
      *pg_dump*)
        printf 'compose dump\\n' >> "$STATE/log"
        printf 'backup-dump-v1\\n'
        ;;
      *pg_restore*)
        payload=$(cat)
        [ "$payload" = "backup-dump-v1" ]
        printf 'compose restore\\n' >> "$STATE/log"
        ;;
    esac
    ;;
  stop)
    printf 'compose stop %s\\n' "$2" >> "$STATE/log"
    ;;
  up)
    printf 'compose up %s\\n' "\${BUILD_SHA:-}" >> "$STATE/log"
    printf '%s\\n' "\${BUILD_SHA:-}" > "$STATE/active_build"
    ;;
  *)
    echo "unexpected compose args: $*" >&2
    exit 2
    ;;
esac
`;
      await writeFile(path.join(workDir, 'mock-git.sh'), mockGit);
      await writeFile(path.join(workDir, 'mock-compose.sh'), mockCompose);

      const deployScript = path.resolve('scripts/deploy.sh').replace(/\\/g, '/');
      const env = {
        ...process.env,
        GIT_CMD: `sh ${posixDir}/mock-git.sh`,
        COMPOSE_CMD: `sh ${posixDir}/mock-compose.sh`,
        HEALTH_URL: `http://127.0.0.1:${port}/api/health`,
        VERSION_URL: `http://127.0.0.1:${port}/api/version`,
        BACKUP_DIR: `${posixDir}/backups`,
        HEALTH_RETRIES: '2',
        HEALTH_INTERVAL: '0',
      };

      // Failure case: new build fails health check -> deploy exits 1 and rolls back git, DB, and build.
      await assert.rejects(
        () => execFileAsync(shPath!, [deployScript], { env }),
        (err: { code?: number }) => err.code === 1,
      );
      const rollbackLog = (await readFile(path.join(workDir, 'log'), 'utf8')).trim().split('\n');
      assert.deepEqual(rollbackLog, [
        'compose dump',
        'git pull --ff-only',
        `compose up ${nextSha}`,
        `git reset --hard ${prevSha}`,
        'compose stop app',
        'compose restore',
        `compose up ${prevSha}`,
      ]);
      assert.equal((await readFile(path.join(workDir, 'head'), 'utf8')).trim(), prevSha);
      assert.equal((await readFile(path.join(workDir, 'active_build'), 'utf8')).trim(), prevSha);

      // Success case: healthy new build deploys cleanly without rollback.
      failNewVersion = false;
      await writeFile(path.join(workDir, 'log'), '');
      await execFileAsync(shPath!, [deployScript], { env });
      const okLog = (await readFile(path.join(workDir, 'log'), 'utf8')).trim().split('\n');
      assert.deepEqual(okLog, ['compose dump', 'git pull --ff-only', `compose up ${nextSha}`]);
      assert.equal((await readFile(path.join(workDir, 'active_build'), 'utf8')).trim(), nextSha);
    } finally {
      httpServer.close();
      await rm(workDir, { recursive: true, force: true });
    }
  },
);
