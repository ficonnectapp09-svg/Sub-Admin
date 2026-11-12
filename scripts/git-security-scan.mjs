#!/usr/bin/env node
/**
 * Connect App Backoffice - Git Security & Secret Scanner
 * Supports: --mode=pre-commit | --mode=pre-push | --mode=ci | --mode=all
 * Never prints discovered secret values; reports only file path, line/commit, and rule name.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ZERO_SHA = '0000000000000000000000000000000000000000';
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
const SELF_SCANNER_PATH = 'scripts/git-security-scan.mjs';

const PROHIBITED_INSTRUCTION_FILES = new Set(['agent.md', 'agents.md', 'changelog.md']);
const PROHIBITED_DIR_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.tmp',
  '.temp',
  'release',
  'logs',
  'database-backup',
  'db-backup',
  'backups',
  'mongodb-dumps',
  'private-uploads',
  'secure-uploads',
  'customer-documents',
  'vendor-documents',
  'kyc-documents',
  'aadhaar-documents',
  'pan-documents',
  'private-storage',
]);
const PROHIBITED_KEY_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const PROHIBITED_DB_EXTENSIONS = new Set(['.dump', '.bson', '.backup', '.sqlite', '.sqlite3']);

const SECRET_RULES = [
  {
    name: 'AWS Access Key ID',
    regex: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/,
  },
  {
    name: 'AWS Secret Access Key',
    regex: /(?:aws_secret_access_key|secretAccessKey)\s*[:=]\s*['"`]?[A-Za-z0-9/+=]{32,}['"`]?/i,
  },
  {
    name: 'MongoDB URI with Credentials',
    regex: /mongodb(?:\+srv)?:\/\/(?!<)[^:\s<'"`]+:(?!<)[^@\s>'"]+@/,
  },
  {
    name: 'Redis URI with Credentials',
    regex: /rediss?:\/\/[^:\s<'"`]*:(?!<)[^@\s>'"]+@/,
  },
  {
    name: 'Private Key Material',
    regex: new RegExp('-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE ' + 'KEY-----'),
  },
  {
    name: 'Hardcoded JWT Signing Secret',
    regex: /(?:jwt[_-]?secret)\s*(?:\|\||\?\?|=|:)\s*['"`][A-Za-z0-9_!@#$%^&*.\-+=]{8,}['"`]/i,
  },
  {
    name: 'Hardcoded JWT Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'Payment Gateway Secret Key',
    regex: /(?:sk_live_|rk_live_|rzp_live_|whsec_|PAYMENT_SECRET_KEY\s*[:=]\s*['"`]?)[A-Za-z0-9_\-]{12,}/,
  },
  {
    name: 'Google / Firebase API Key',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
  },
  {
    name: 'Service Account Private Key',
    regex: new RegExp('"private_key"\\s*:\\s*"-----BEGIN ' + 'PRIVATE ' + 'KEY-----'),
  },
  {
    name: 'GitHub Token',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    name: 'OAuth Client Secret',
    regex: /(?:oauth_client_secret|client_secret)\s*[:=]\s*['"`](?!<|your_|changeme|example)[A-Za-z0-9_\-+=/.]{12,}['"`]/i,
  },
  {
    name: 'SMTP / Mail Password',
    regex: /(?:smtp_pass(?:word)?|mail_password)\s*[:=]\s*['"`](?!<|your_|changeme|example)[^'"`\s]{6,}['"`]/i,
  },
  {
    name: 'Hardcoded Sensitive Password / Secret',
    regex: /(?:(?:DB_PASSWORD|API_SECRET|PRIVATE_API_KEY|AUTH_SECRET|CLOUDINARY_API_SECRET)\s*[:=]\s*['"`](?!<|your_|changeme|example)[^'"`\s]{8,}['"`]|^(?:DB_PASSWORD|API_SECRET|PRIVATE_API_KEY|AUTH_SECRET|CLOUDINARY_API_SECRET)=(?!<|your_|changeme|example)[^\s'"]{8,})/im,
  },
  {
    name: 'Cloudinary URL with Credentials',
    regex: /cloudinary:\/\/[0-9]+:(?!<)[^@\s<'"`]+@[a-zA-Z0-9_-]+/,
  },
];

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

function gitBuffer(args) {
  try {
    return execFileSync('git', args, { maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function getIgnoredSet(filePaths) {
  const unique = Array.from(new Set(filePaths.map(normalizePath).filter(Boolean)));
  if (unique.length === 0) return new Set();
  try {
    const out = execFileSync(
      'git',
      ['check-ignore', '--no-index', '--stdin', '-z'],
      { input: unique.join('\0') + '\0', encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    );
    return new Set(out.split('\0').filter(Boolean).map(normalizePath));
  } catch (err) {
    // git check-ignore exits with 1 when none of the inputs are ignored
    if (err && typeof err.stdout === 'string' && err.stdout.length > 0) {
      return new Set(err.stdout.split('\0').filter(Boolean).map(normalizePath));
    }
    return new Set();
  }
}

function checkProhibitedPath(rawPath, ignoredSet = null) {
  const norm = normalizePath(rawPath);
  if (!norm) return [];
  const findings = [];
  const parts = norm.split('/');
  const base = parts[parts.length - 1];
  const baseLower = base.toLowerCase();
  const extLower = path.posix.extname(baseLower);

  if (/^\.env($|\.)/i.test(base) && baseLower !== '.env.example') {
    findings.push('Prohibited environment file (.env* other than .env.example)');
  }

  if (PROHIBITED_INSTRUCTION_FILES.has(baseLower)) {
    findings.push(`Prohibited private project file (${base})`);
  }

  for (const seg of parts.slice(0, -1)) {
    if (PROHIBITED_DIR_SEGMENTS.has(seg.toLowerCase())) {
      findings.push(`Prohibited directory (${seg}/)`);
      break;
    }
  }

  if (
    extLower === '.log' ||
    /^(npm-debug|yarn-debug|yarn-error|pnpm-debug)\.log/i.test(base)
  ) {
    findings.push('Prohibited log/debug file');
  }

  if (PROHIBITED_KEY_EXTENSIONS.has(extLower)) {
    findings.push(`Prohibited private key/certificate extension (${extLower})`);
  }

  if (PROHIBITED_DB_EXTENSIONS.has(extLower)) {
    findings.push(`Prohibited database/backup extension (${extLower})`);
  }

  if (/^Backend\/data\/.+\.json$/i.test(norm)) {
    findings.push('Prohibited Backend/data JSON database file');
  }

  if (/^Backend\/uploads\//i.test(norm) && norm !== 'Backend/uploads/.gitkeep') {
    findings.push('Prohibited runtime upload under Backend/uploads/');
  }

  const ignored = ignoredSet ? ignoredSet.has(norm) : getIgnoredSet([norm]).has(norm);
  if (ignored) {
    findings.push('File matches .gitignore (force-staged or tracked ignored file)');
  }

  return findings;
}

function scanBufferForSecrets(rawPath, buf, contextLabel = '') {
  const norm = normalizePath(rawPath);
  const base = path.posix.basename(norm);
  if (!buf || buf.length === 0) return [];
  if (LOCKFILES.has(base) || norm === SELF_SCANNER_PATH) return [];
  if (buf.includes(0)) return []; // skip binary files

  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > 20000) continue;
    for (const rule of SECRET_RULES) {
      if (rule.regex.test(line)) {
        hits.push({
          file: norm,
          line: i + 1,
          rule: rule.name,
          context: contextLabel,
        });
      }
    }
  }
  return hits;
}

function validateGitignoreRules() {
  const mustIgnore = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    '.env.staging',
    '.env.test',
    'Frontend/.env',
    'Frontend/.env.production',
    'Backend/.env',
    'AGENT.md',
    'AGENTS.md',
    'CHANGELOG.md',
    'node_modules/pkg/index.js',
    'dist/app.js',
    'Frontend/dist/index.html',
    'coverage/lcov.info',
    'logs/app.log',
    'private.pem',
    'cert.key',
    'backup.dump',
    'db-backup/snap.bson',
    'kyc-documents/aadhaar.pdf',
    'Backend/data/users.json',
    'Backend/uploads/sample.jpg',
  ];

  const mustAllow = [
    '.env.example',
    'Frontend/.env.example',
    'Backend/.env.example',
    'Backend/uploads/.gitkeep',
    'package.json',
    'Backend/package-lock.json',
    'Frontend/package-lock.json',
    'Frontend/src/services/api.js',
    'Backend/server.js',
  ];

  const ignoredSet = getIgnoredSet([...mustIgnore, ...mustAllow]);
  const errors = [];
  for (const p of mustIgnore) {
    if (!ignoredSet.has(normalizePath(p))) {
      errors.push(`Expected .gitignore to ignore: ${p}`);
    }
  }
  for (const p of mustAllow) {
    if (ignoredSet.has(normalizePath(p))) {
      errors.push(`Expected .gitignore NOT to ignore: ${p}`);
    }
  }
  return errors;
}

function runPreCommit() {
  const raw = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], true) || '';
  const files = raw.split('\0').filter(Boolean);
  const ignoredSet = getIgnoredSet(files);
  const pathIssues = [];
  const secretIssues = [];

  for (const file of files) {
    const pFindings = checkProhibitedPath(file, ignoredSet);
    for (const reason of pFindings) {
      pathIssues.push({ file: normalizePath(file), reason });
    }
    const blob = gitBuffer(['show', `:${normalizePath(file)}`]);
    secretIssues.push(...scanBufferForSecrets(file, blob, 'staged'));
  }

  return { pathIssues, secretIssues, gitignoreIssues: [], scannedCount: files.length };
}

function getOutgoingCommitsFromStdin() {
  let stdinText = '';
  try {
    stdinText = fs.readFileSync(0, 'utf8').trim();
  } catch {
    stdinText = '';
  }

  const commits = new Set();

  if (stdinText) {
    for (const line of stdinText.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const [, localSha, , remoteSha] = parts;
      if (!localSha || localSha === ZERO_SHA) continue;

      let revListOut = null;
      if (!remoteSha || remoteSha === ZERO_SHA) {
        revListOut = git(['rev-list', localSha, '--not', '--remotes'], true);
        if (revListOut === null) {
          revListOut = git(['rev-list', localSha], true);
        }
      } else {
        revListOut = git(['rev-list', `${remoteSha}..${localSha}`], true);
      }

      if (revListOut) {
        for (const c of revListOut.split(/\r?\n/).filter(Boolean)) {
          commits.add(c);
        }
      }
    }
  } else {
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], true)?.trim();
    const range = upstream ? `${upstream}..HEAD` : 'HEAD';
    const revListOut = git(['rev-list', range], true) || '';
    for (const c of revListOut.split(/\r?\n/).filter(Boolean)) {
      commits.add(c);
    }
  }

  return Array.from(commits);
}

function runPrePush() {
  const commits = getOutgoingCommitsFromStdin();
  const pathIssues = [];
  const secretIssues = [];
  const scannedFiles = new Set();

  for (const commit of commits) {
    const changed = git(
      ['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-r', '-z', commit],
      true
    ) || '';
    const commitFiles = changed.split('\0').filter(Boolean).map(normalizePath);
    const ignoredSet = getIgnoredSet(commitFiles);
    for (const norm of commitFiles) {
      scannedFiles.add(`${commit.slice(0, 7)}:${norm}`);

      const pFindings = checkProhibitedPath(norm, ignoredSet);
      for (const reason of pFindings) {
        pathIssues.push({ file: norm, reason, commit: commit.slice(0, 7) });
      }

      const blob = gitBuffer(['show', `${commit}:${norm}`]);
      secretIssues.push(...scanBufferForSecrets(norm, blob, `commit ${commit.slice(0, 7)}`));
    }
  }

  return { pathIssues, secretIssues, gitignoreIssues: [], scannedCount: scannedFiles.size };
}

function runTrackedScan(includeGitignoreCheck = true) {
  const raw = git(['ls-files', '-z'], true) || '';
  const files = raw.split('\0').filter(Boolean);
  const ignoredSet = getIgnoredSet(files);
  const pathIssues = [];
  const secretIssues = [];

  for (const file of files) {
    const norm = normalizePath(file);
    const pFindings = checkProhibitedPath(norm, ignoredSet);
    for (const reason of pFindings) {
      pathIssues.push({ file: norm, reason });
    }
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      secretIssues.push(...scanBufferForSecrets(norm, buf, 'tracked'));
    }
  }

  const gitignoreIssues = includeGitignoreCheck ? validateGitignoreRules() : [];
  return { pathIssues, secretIssues, gitignoreIssues, scannedCount: files.length };
}

function main() {
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'all';

  let result;
  if (mode === 'pre-commit') {
    result = runPreCommit();
  } else if (mode === 'pre-push') {
    result = runPrePush();
  } else if (mode === 'ci' || mode === 'all') {
    result = runTrackedScan(true);
  } else {
    console.error(`Unknown --mode=${mode}. Expected pre-commit, pre-push, ci, or all.`);
    process.exit(2);
  }

  const totalIssues =
    result.pathIssues.length + result.secretIssues.length + result.gitignoreIssues.length;

  if (totalIssues > 0) {
    console.error(`\n[GIT SECURITY BLOCKED] Mode "${mode}" detected ${totalIssues} issue(s):\n`);

    for (const item of result.pathIssues) {
      const commitNote = item.commit ? ` (commit ${item.commit})` : '';
      console.error(`  - [PROHIBITED FILE] ${item.file}${commitNote}: ${item.reason}`);
    }
    for (const item of result.secretIssues) {
      const ctx = item.context ? ` [${item.context}]` : '';
      console.error(`  - [SECRET DETECTED] ${item.file}:${item.line}${ctx}: ${item.rule} [REDACTED]`);
    }
    for (const msg of result.gitignoreIssues) {
      console.error(`  - [GITIGNORE RULE] ${msg}`);
    }

    console.error(
      '\nAction blocked to protect credentials, private documents, and confidential project files.\n' +
        'Remove or unstage prohibited files/secrets before committing or pushing.\n'
    );
    process.exit(1);
  }

  console.log(`[GIT SECURITY PASS] Mode "${mode}" checked ${result.scannedCount} item(s): 0 issues found.`);
}

main();

