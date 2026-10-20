import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = randomBytes(24).toString('hex');
const invite = randomBytes(18).toString('base64url');
try {
  await writeFile(
    '.env',
    `# Generated locally. Never commit this file.\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://galinka:${password}@localhost:54329/galinka\nINVITE_CODE=${invite}\nAPP_ORIGIN=http://localhost:5173\nCOOKIE_SECURE=false\nTRUST_PROXY=0\nPORT=3001\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Создан .env со случайным паролем БД и кодом INVITE_CODE. Для сервера измените APP_ORIGIN на ваш HTTPS-адрес, COOKIE_SECURE=true и TRUST_PROXY=1 за одним reverse proxy.',
  );
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env уже существует; настройки сохранены.');
  else throw error;
}
