#!/usr/bin/env node
// One-command Cloudflare setup: sign in, create the storage, deploy, set the key.
// Safe to re-run; anything already done is skipped.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = path.join(ROOT, 'wrangler.toml');
const KEY_FILE = path.join(ROOT, '.brief-key');
const PLACEHOLDER = 'replace_with_your_kv_namespace_id';

const say = (message) => console.log(`\n${message}`);

/** Run wrangler, showing its output so the browser prompts are visible. */
function wrangler(args, { capture = false, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], {
      cwd: ROOT,
      stdio: [input === null ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });
    let output = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    if (input !== null) child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`wrangler ${args[0]} exited with code ${code}`));
    });
  });
}

/** `wrangler whoami` exits 0 whether or not you are signed in, so read what it says. */
export function needsLogin(output) {
  return /not authenticated|please run .?wrangler login/i.test(output);
}

/** Pull the namespace id out of whatever shape wrangler prints it in. */
export function readNamespaceId(output) {
  const patterns = [
    /id\s*=\s*"([0-9a-f]{32})"/i,
    /"id"\s*:\s*"([0-9a-f]{32})"/i,
    /\b([0-9a-f]{32})\b/,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function configuredId(config) {
  const match = config.match(/\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*"([^"]+)"/);
  const id = match ? match[1] : null;
  return id && id !== PLACEHOLDER ? id : null;
}

export function readSiteUrl(output) {
  const match = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  return match ? match[0] : null;
}

/** 32 characters that survive copy, paste and a URL without escaping. */
export function newKey(bytes = randomBytes(24)) {
  return bytes.toString('base64url');
}

async function main() {
  say('1/4  Checking your Cloudflare sign-in...');
  let whoami = '';
  try {
    whoami = await wrangler(['whoami'], { capture: true });
  } catch {
    whoami = 'not authenticated';
  }
  if (needsLogin(whoami)) {
    say('     Not signed in yet. A browser window will open - approve the access request.');
    await wrangler(['login']);
  } else {
    say('     Already signed in.');
  }

  const config = await fs.readFile(CONFIG, 'utf8');
  if (configuredId(config)) {
    say('2/4  Storage already set up. Skipping.');
  } else {
    say('2/4  Creating the storage your briefs live in...');
    const output = await wrangler(['kv', 'namespace', 'create', 'BRIEFS'], { capture: true });
    const id = readNamespaceId(output);
    if (!id) {
      throw new Error(
        'Could not find the namespace id in wrangler\'s output.\n'
        + `Copy the id it printed into ${CONFIG}, replacing ${PLACEHOLDER}, then run this again.`,
      );
    }
    await fs.writeFile(CONFIG, config.replace(PLACEHOLDER, id), 'utf8');
    say('     Done - saved to wrangler.toml.');
  }

  say('3/4  Deploying...');
  const deployed = await wrangler(['deploy'], { capture: true });
  const site = readSiteUrl(deployed) || 'https://daily-brief.<your-account>.workers.dev';

  say('4/4  Setting your key...');
  let key = (await fs.readFile(KEY_FILE, 'utf8').catch(() => '')).trim();
  if (key) {
    say('     Key already set (kept in .brief-key). Skipping.');
  } else {
    key = newKey();
    await wrangler(['secret', 'put', 'BRIEF_KEY'], { input: key });
    await fs.writeFile(KEY_FILE, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  say([
    'All set.',
    '',
    'On your phone, open this link (it unlocks the app once):',
    `  ${site}/#key=${key}`,
    '',
    'Then iPhone: Share button, "Add to Home Screen".  Android: browser menu, "Install app".',
    'If the installed app asks for a key, paste the part after key= above.',
    '',
    'For the morning run to send briefs, add the key to your Claude project as an',
    'environment variable (Project settings, Cloud environment, the gear icon):',
    `  DAILY_BRIEF_KEY=${key}`,
    'Do not paste the key into a chat. Your app\'s address is fine to share:',
    `  ${site}`,
  ].join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  main().catch((error) => {
    console.error(`\nSetup stopped: ${error.message}`);
    process.exit(1);
  });
}
