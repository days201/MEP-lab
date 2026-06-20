'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_REPO_SLUG = 'days201/MEP-lab';
const EXPECTED_REPO_URL = `https://github.com/${EXPECTED_REPO_SLUG}`;
const FORBIDDEN_REPO_PATTERNS = [
  new RegExp('open[-_\\s]?' + 'cowork', 'i'),
  new RegExp('claude[-_\\s]?' + 'cowork', 'i'),
  new RegExp('open' + 'cowork', 'i'),
];

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

function hasForbiddenOriginalRepoReference(value) {
  return typeof value === 'string' && FORBIDDEN_REPO_PATTERNS.some((pattern) => pattern.test(value));
}

function addViolation(violations, area, message) {
  violations.push({ area, message });
}

function checkPackageMetadata(rootDir, violations) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const expectedFields = [
    ['name', packageJson.name, 'mep-lab'],
    ['homepage', packageJson.homepage, EXPECTED_REPO_URL],
    ['repository.url', packageJson.repository && packageJson.repository.url, `${EXPECTED_REPO_URL}.git`],
    ['bugs.url', packageJson.bugs && packageJson.bugs.url, `${EXPECTED_REPO_URL}/issues`],
  ];

  for (const [field, actual, expected] of expectedFields) {
    if (actual !== expected) {
      addViolation(violations, 'package.json', `${field} must be ${expected}, found ${actual || '<missing>'}`);
    }
  }
}

function checkElectronBuilder(rootDir, violations) {
  const builderConfig = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf8');

  if (!/^\s*owner:\s*days201\s*$/m.test(builderConfig)) {
    addViolation(violations, 'electron-builder.yml', 'publish.owner must remain days201');
  }

  if (!/^\s*repo:\s*MEP-lab\s*$/m.test(builderConfig)) {
    addViolation(violations, 'electron-builder.yml', 'publish.repo must remain MEP-lab');
  }
}

function parseGitRemotes(gitConfigText) {
  const remotes = [];
  let currentRemote = null;

  for (const line of gitConfigText.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[remote "(.+)"\]$/);
    if (sectionMatch) {
      currentRemote = { name: sectionMatch[1], urls: [] };
      remotes.push(currentRemote);
      continue;
    }

    if (line.startsWith('[')) {
      currentRemote = null;
      continue;
    }

    if (currentRemote) {
      const urlMatch = line.match(/^\s*url\s*=\s*(.+?)\s*$/);
      if (urlMatch) {
        currentRemote.urls.push(urlMatch[1]);
      }
    }
  }

  return remotes;
}

function checkGitRemotes(rootDir, violations) {
  const gitConfig = readTextIfExists(path.join(rootDir, '.git', 'config'));
  if (!gitConfig) {
    return;
  }

  for (const remote of parseGitRemotes(gitConfig)) {
    if (remote.name.toLowerCase() === 'upstream') {
      addViolation(violations, 'git remotes', 'remove the upstream remote so pulls cannot accidentally sync from the original repo');
    }

    for (const url of remote.urls) {
      if (hasForbiddenOriginalRepoReference(url)) {
        addViolation(violations, 'git remotes', `${remote.name} points at original repo branding: ${url}`);
      }
    }
  }
}

function checkRepoReferences(rootDir, violations) {
  const candidateFiles = [
    'package.json',
    'package-lock.json',
    'electron-builder.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.github/dependabot.yml',
  ];

  for (const relativePath of candidateFiles) {
    const content = readTextIfExists(path.join(rootDir, relativePath));
    if (content && hasForbiddenOriginalRepoReference(content)) {
      addViolation(violations, relativePath, 'contains a reference that looks like the original repository identity');
    }
  }
}

function checkForkDecoupling(rootDir) {
  const violations = [];

  checkPackageMetadata(rootDir, violations);
  checkElectronBuilder(rootDir, violations);
  checkGitRemotes(rootDir, violations);
  checkRepoReferences(rootDir, violations);

  return { violations };
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const { violations } = checkForkDecoupling(rootDir);

  if (violations.length > 0) {
    console.error('Fork decoupling guard failed:');
    for (const violation of violations) {
      console.error(`- ${violation.area}: ${violation.message}`);
    }
    process.exit(1);
  }

  console.log('Fork decoupling guard passed.');
}

module.exports = {
  checkForkDecoupling,
};

if (require.main === module) {
  main();
}
