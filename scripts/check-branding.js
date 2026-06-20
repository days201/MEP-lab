'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN_TERMS = [
  'Open ' + 'Cowork',
  'Open' + 'Cowork',
  'open-' + 'cowork',
  'Open' + 'CoworkAI',
  'open' + 'cowork' + '.ai',
  'Claude ' + 'Cowork',
];

const SKIP_DIRS = new Set([
  '.bundle-resources',
  '.claude',
  '.git',
  '.tmp',
  'coverage',
  'dist',
  'dist-electron',
  'dist-lima-agent',
  'dist-mcp',
  'dist-wsl-agent',
  'node_modules',
  'release',
]);

const SKIP_EXTENSIONS = new Set([
  '.bak',
  '.db',
  '.gif',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.log',
  '.map',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
]);

const LEGACY_ALLOWLIST = [
  {
    pattern: /^resources[\\/]installer\.nsh$/,
    reason: 'Windows installer must identify and clean up old upstream-branded installs.',
  },
  {
    pattern: new RegExp(
      '^resources[\\\\/]windows[\\\\/]' + 'Open-' + 'Cowork' + '-Legacy-Cleanup\\.(cmd|ps1)$'
    ),
    reason: 'Legacy cleanup helpers intentionally target old upstream-branded app data.',
  },
  {
    pattern: /^scripts[\\/]build-windows-artifacts\.js$/,
    reason: 'Build helper copies the legacy cleanup tools by their existing filenames.',
  },
  {
    pattern: /^tests[\\/](build-windows-artifacts|windows-legacy-uninstall-remediation)\.test\.ts$/,
    reason: 'Tests assert that legacy cleanup support remains available.',
  },
  {
    pattern: /^src[\\/]main[\\/](config[\\/]config-store|remote[\\/]remote-config-store|mcp[\\/]mcp-config-store|mcp[\\/]mcp-logger|mcp[\\/]gui-operate-server|skills[\\/]plugin-registry-store)\.ts$/,
    reason: 'Stored config paths and encryption seeds are retained for existing installations.',
  },
  {
    pattern: /^tests[\\/](store-encryption|mcp-manager|skills-manager-plugin-install|skills-manager-storage-path)\.test\.ts$/,
    reason: 'Tests cover legacy storage/config path compatibility.',
  },
  {
    pattern: /^src[\\/]tests[\\/]memory[\\/](memory-smoke-harness|memory-service|memory-eval-harness|core-memory-store)\.test\.ts$/,
    reason: 'Tests use historical temporary path prefixes and mocked app paths.',
  },
  {
    pattern: /^src[\\/]tests[\\/]claude[\\/]windows-bash-operations\.test\.ts$/,
    reason: 'Test-only temporary path prefix retained for compatibility coverage.',
  },
  {
    pattern: /^tests[\\/](agent-runner-pi|database-path-recovery|deepseek-common|file-link|markdown-local-link|mcp-manager-streamable-http-oauth|mcp-npx-resolution|mcp-oauth|plugin-runtime-service|recent-workspace-files|tool-output-path|tool-result-utils)\.test\.ts$/,
    reason: 'Tests exercise legacy path or protocol compatibility behavior.',
  },
];

function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('dist') || name === 'cache';
}

function isTextCandidate(filePath) {
  return !SKIP_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAllowlisted(relativePath) {
  return LEGACY_ALLOWLIST.some((entry) => entry.pattern.test(relativePath));
}

function walkFiles(rootDir, currentDir, files) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walkFiles(rootDir, path.join(currentDir, entry.name), files);
      }
      continue;
    }

    if (entry.isFile()) {
      const filePath = path.join(currentDir, entry.name);
      if (isTextCandidate(filePath)) {
        files.push(filePath);
      }
    }
  }
}

function findTerms(content) {
  const lowerContent = content.toLowerCase();
  return FORBIDDEN_TERMS.filter((term) => lowerContent.includes(term.toLowerCase()));
}

function checkBranding(rootDir) {
  const files = [];
  walkFiles(rootDir, rootDir, files);

  const violations = [];
  for (const filePath of files) {
    const relativePath = toPosixRelative(rootDir, filePath);
    if (isAllowlisted(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const term of findTerms(content)) {
      violations.push({ file: relativePath, term });
    }
  }

  return { violations };
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const { violations } = checkBranding(rootDir);

  if (violations.length > 0) {
    console.error('Disallowed legacy branding found:');
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.term}`);
    }
    process.exit(1);
  }

  console.log('Branding guard passed.');
}

module.exports = {
  FORBIDDEN_TERMS,
  LEGACY_ALLOWLIST,
  checkBranding,
};

if (require.main === module) {
  main();
}
