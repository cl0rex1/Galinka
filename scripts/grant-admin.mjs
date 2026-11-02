import { Pool } from 'pg';
const username = process.argv[2];
if (!username || !/^[a-z0-9_]{3,24}$/.test(username) || !process.env.DATABASE_URL) {
  console.error('Usage: npm run admin:grant -- username (DATABASE_URL is required)');
  process.exit(1);
}
const db = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await db.query(
    "UPDATE users SET role='admin' WHERE username=$1 AND NOT blocked RETURNING username",
    [username],
  );
  if (!result.rowCount) throw Error('Active account not found. Register the account first.');
  console.log('Administrator role granted. Sign in to /admin with this account.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
