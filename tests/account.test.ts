import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;
test(
  'accounts: sliding sessions, devices, password change, one-time invites, file removal',
  { skip: !database, timeout: 60000 },
  async () => {
    const db = new Pool({ connectionString: database });
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-account-'));
    const base = 'http://localhost:3031';
    const accounts: string[] = [];
    let server: ChildProcess | undefined,
      logs = '';
    async function request(url: string, method = 'GET', body?: unknown, cookie = '') {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          Cookie: cookie,
          Origin: base,
          'User-Agent': 'galinka-test',
        },
        body:
          body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }
    try {
      server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: database,
          PORT: '3031',
          INVITE_CODE: 'account-test-shared-invite',
          APP_ORIGIN: base,
          UPLOAD_DIR: directory,
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
      const password = 'account-password-strong';
      const owner = await request('/auth/register', 'POST', {
        username: 'owner' + suffix,
        name: 'Owner',
        password,
        invite: 'account-test-shared-invite',
      });
      assert.equal(owner.status, 201, logs);
      accounts.push(owner.data.id);
      await db.query("UPDATE users SET role='admin' WHERE id=$1", [owner.data.id]);

      // Field-specific validation messages instead of a login hint for every error.
      const long = await request('/me', 'PATCH', { name: 'x'.repeat(41) }, owner.cookie);
      assert.equal(long.status, 400);
      assert.match(long.data.error, /Имя/);

      // One-time invite: works once, then is rejected.
      const created = await request('/admin/invites', 'POST', { note: 'Guest' }, owner.cookie);
      assert.equal(created.status, 201);
      const code = new URL(created.data.url).searchParams.get('signup')!;
      const guest = await request('/auth/register', 'POST', {
        username: 'guest' + suffix,
        name: 'Guest',
        password,
        invite: code,
      });
      assert.equal(guest.status, 201);
      accounts.push(guest.data.id);
      const again = await request('/auth/register', 'POST', {
        username: 'again' + suffix,
        name: 'Again',
        password,
        invite: code,
      });
      assert.equal(again.status, 403);
      const invites = await request('/admin/invites', 'GET', undefined, owner.cookie);
      assert.equal(invites.data[0].used_by, 'Guest');

      // A session close to expiry is renewed on use and keeps the same cookie value.
      await db.query("UPDATE sessions SET expires_at=now()+interval '2 days' WHERE user_id=$1", [
        guest.data.id,
      ]);
      const renewed = await request('/me', 'GET', undefined, guest.cookie);
      assert.equal(renewed.status, 200);
      assert.equal(renewed.cookie, guest.cookie);
      const expiry = await db.query('SELECT expires_at FROM sessions WHERE user_id=$1', [
        guest.data.id,
      ]);
      assert.ok(expiry.rows[0].expires_at > new Date(Date.now() + 29 * 86400_000));

      // Device list, revoking a device, and password change sign out the other devices.
      const second = await request('/auth/login', 'POST', { username: 'guest' + suffix, password });
      const devices = await request('/me/sessions', 'GET', undefined, guest.cookie);
      assert.equal(devices.data.length, 2);
      assert.equal(devices.data[0].current, true);
      assert.equal(devices.data[1].user_agent, 'galinka-test');
      assert.equal(
        (await request(`/me/sessions/${devices.data[1].id}`, 'DELETE', undefined, guest.cookie))
          .status,
        200,
      );
      assert.equal((await request('/me', 'GET', undefined, second.cookie)).status, 401);
      const third = await request('/auth/login', 'POST', { username: 'guest' + suffix, password });
      assert.equal(
        (
          await request(
            '/me/password',
            'POST',
            { current: 'wrong-password-value', password: 'new-password-strong' },
            guest.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/me/password',
            'POST',
            { current: password, password: 'new-password-strong' },
            guest.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await request('/me', 'GET', undefined, third.cookie)).status, 401);
      assert.equal((await request('/me', 'GET', undefined, guest.cookie)).status, 200);

      // Deleting a message removes its attachment from storage and access.
      const chat = (await request('/chats', 'GET', undefined, guest.cookie)).data[0].id;
      const form = new FormData();
      form.append('file', new Blob(['notes'], { type: 'text/plain' }), 'notes.txt');
      const file = await request(`/chats/${chat}/files`, 'POST', form, guest.cookie);
      assert.equal(file.status, 201);
      const message = await request(
        `/chats/${chat}/messages`,
        'POST',
        { fileId: file.data.id, nonce: randomUUID() },
        guest.cookie,
      );
      await access(path.join(directory, file.data.id));
      assert.equal(
        (
          await request(
            `/chats/${chat}/messages/${message.data.id}`,
            'DELETE',
            undefined,
            guest.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${base}/api/files/${file.data.id}`, { headers: { Cookie: guest.cookie } }))
          .status,
        404,
      );
      await assert.rejects(access(path.join(directory, file.data.id)));
    } finally {
      server?.kill('SIGTERM');
      if (server && server.exitCode === null)
        await new Promise((resolve) => server!.once('exit', resolve));
      if (accounts.length) {
        await db.query('DELETE FROM signup_invites WHERE created_by=ANY($1::uuid[])', [accounts]);
        await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
      }
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
