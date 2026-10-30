import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const envFile = resolve(projectRoot, '.env.local');

try {
  const contents = await readFile(envFile, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const supabaseUrl = process.env.BUDDY_SUPABASE_URL;
const publishableKey = process.env.BUDDY_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
  console.error('Build needs BUDDY_SUPABASE_URL and BUDDY_SUPABASE_PUBLISHABLE_KEY.');
  console.error('Set them in Vercel Project Settings or in a local .env.local file.');
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  console.error('BUDDY_SUPABASE_URL must be a valid HTTPS URL.');
  process.exit(1);
}

if (parsedUrl.protocol !== 'https:') {
  console.error('BUDDY_SUPABASE_URL must use HTTPS.');
  process.exit(1);
}

if (!publishableKey.startsWith('sb_publishable_')) {
  console.error('Use the Supabase publishable key only. Never use a secret or service-role key in the browser.');
  process.exit(1);
}

const runtimeConfig = {
  supabaseUrl: parsedUrl.origin,
  supabasePublishableKey: publishableKey
};

await writeFile(
  resolve(projectRoot, 'dist/runtime-config.js'),
  `window.BuddyConfig = Object.freeze(${JSON.stringify(runtimeConfig)});\n`,
  'utf8'
);

console.log('Buddy Loans static site is ready in dist/.');
