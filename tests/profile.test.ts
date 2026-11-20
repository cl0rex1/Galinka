import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;

test(
  'real PostgreSQL: the profile keeps a name, a line about yourself and a login that must be free',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-profile-test-'));
    const db = new Pool({ connectionString: database });
    const invite = 'test-profile-invite-code';
    const port = 3017;
    const base = `http://localhost:${port}`;
    const accounts: string[] = [];
    let logs = '';
    const server: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: database,
        PORT: String(port),
        INVITE_CODE: invite,
        APP_ORIGIN: base,
        UPLOAD_DIR: directory,
        NODE_ENV: 'test',
        PUSH_ENABLED: 'false',
        WEB_PUSH_PUBLIC_KEY: '',
        WEB_PUSH_PRIVATE_KEY: '',
      },
      stdio: 'pipe',
    });
    server.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    const request = async (url: string, method = 'GET', body?: unknown, cookie = '') => {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: base,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json().catch(() => null),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    };
    try {
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {}
        if (i > 100) throw Error('API did not start: ' + logs);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const suffix = randomUUID().slice(0, 8);
      const register = async (name: string) => {
        const r = await request('/auth/register', 'POST', {
          username: `${name}_${suffix}`,
          name,
          password: 'test-password-strong',
          invite,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        accounts.push(r.data.id);
        return { ...r, username: `${name}_${suffix}` };
      };
      const alice = await register('alice');
      const bob = await register('bob');

      // A line about yourself: trimmed, one line, at most 140 characters.
      const saved = await request(
        '/me',
        'PATCH',
        { bio: '  Люблю горы\nи плёнку  ' },
        alice.cookie,
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.bio, 'Люблю горы и плёнку');
      assert.equal(saved.data.name, 'alice', 'fields left out stay as they were');
      assert.equal(
        (await request('/me', 'PATCH', { bio: 'я'.repeat(141) }, alice.cookie)).status,
        400,
      );
      assert.equal((await request('/me', 'GET', undefined, alice.cookie)).data.bio, 'Люблю горы и плёнку');

      // Others see it where they see the person: a shared chat's members and the direct chat.
      const chat = await request('/chats', 'POST', { kind: 'direct', userIds: [alice.data.id] }, bob.cookie);
      assert.ok([200, 201].includes(chat.status), JSON.stringify(chat.data));
      const members = await request(`/chats/${chat.data.id}/members`, 'GET', undefined, bob.cookie);
      assert.equal(
        members.data.find((person: { id: string }) => person.id === alice.data.id).bio,
        'Люблю горы и плёнку',
      );
      const list = await request('/chats', 'GET', undefined, bob.cookie);
      assert.equal(
        list.data.find((item: { id: string }) => item.id === chat.data.id).peer.bio,
        'Люблю горы и плёнку',
      );

      // The login: checked while typing, and a taken one is refused on save.
      const check = async (name: string) =>
        (await request(`/usernames/${encodeURIComponent(name)}`, 'GET', undefined, alice.cookie)).data;
      assert.deepEqual(await check(bob.username), { available: false, valid: true });
      assert.deepEqual(await check(alice.username), { available: true, valid: true }, 'your own');
      assert.deepEqual(await check('no'), { available: false, valid: false });
      assert.deepEqual(await check(`free_${suffix}`), { available: true, valid: true });
      const taken = await request('/me', 'PATCH', { username: bob.username }, alice.cookie);
      assert.equal(taken.status, 409);
      assert.equal(taken.data.error, 'Этот логин уже занят.');
      assert.equal((await request('/me', 'PATCH', { username: 'Плохой' }, alice.cookie)).status, 400);
      const renamed = await request('/me', 'PATCH', { username: `New_${suffix}` }, alice.cookie);
      assert.equal(renamed.status, 200);
      assert.equal(renamed.data.username, `new_${suffix}`, 'logins are stored in lower case');
      assert.equal((await check(`new_${suffix}`)).available, true);
      // Unknown fields are refused rather than silently ignored.
      assert.equal((await request('/me', 'PATCH', { role: 'admin' }, alice.cookie)).status, 400);
    } finally {
      server.kill();
      if (accounts.length)
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]).catch(() => {});
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
