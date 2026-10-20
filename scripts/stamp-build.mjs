import { readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const id = (process.env.BUILD_SHA || version).replace(/[^a-zA-Z0-9._-]/g, '');
const sw = await readFile('dist/sw.js', 'utf8');
await writeFile('dist/sw.js', sw.replace('__RELEASE__', id));
