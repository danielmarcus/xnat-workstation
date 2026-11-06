#!/usr/bin/env node
/**
 * The manual release checks, recorded on the commit (CLAUDE.md, "Testing: what to run when").
 *
 * Three suites cannot run on a hosted runner: the offline E2E suite and the sweep (they need a
 * GPU), the live specs (they need the test XNAT's credentials, which stay in the local .env.e2e)
 * and the packaged-edition check. This script runs them on HEAD and posts one GitHub commit
 * status per suite to that commit; release.yml's `release-evidence` job refuses to package a
 * tag whose commit does not carry all three as `success`.
 *
 * Only the outcome, the platform and the duration are posted — no credentials, server names or
 * test output leave this machine. Statuses are posted with your own `gh` login.
 *
 *   npm run release:check                  # build, then all three suites
 *   npm run release:check -- --only live   # re-run one suite (e2e | live | edition), comma-separated
 *   npm run release:check -- --no-post     # run without posting statuses
 *
 * Then tag the same commit: git tag v<version> && git push origin v<version>.
 */
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The contexts release.yml (`release-evidence`) requires — keep the two lists the same.
const SUITES = [
  { key: 'e2e', context: 'release/e2e', script: 'test:e2e:release', label: 'offline E2E + sweep' },
  { key: 'live', context: 'release/live-e2e', script: 'test:e2e:live', label: 'live XNAT specs' },
  { key: 'edition', context: 'release/edition', script: 'test:edition', label: 'packaged edition' },
];

const args = process.argv.slice(2);
const post = !args.includes('--no-post');
const onlyArg = args.find((a, i) => args[i - 1] === '--only') ?? args.find((a) => a.startsWith('--only='))?.slice(7);
const unknown = args.filter((a, i) => !['--no-post', '--only'].includes(a) && !a.startsWith('--only=') && args[i - 1] !== '--only');
if (unknown.length) die(`unknown argument ${unknown.join(' ')}`);
const wanted = onlyArg ? onlyArg.split(',').map((s) => s.trim()) : SUITES.map((s) => s.key);
const badKey = wanted.find((k) => !SUITES.some((s) => s.key === k));
if (badKey) die(`--only takes ${SUITES.map((s) => s.key).join(', ')}; got "${badKey}"`);
const suites = SUITES.filter((s) => wanted.includes(s.key));

function die(msg) {
  console.error(`[release-check] ${msg}`);
  process.exit(1);
}

function capture(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() || r.error?.message || '' };
}

function npmRun(script) {
  const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

// The commit under test must be exactly what is committed, or the status would vouch for code
// that is not in it.
const dirty = capture('git', ['status', '--porcelain']);
if (!dirty.ok) die(`git status failed: ${dirty.err}`);
if (dirty.out) die(`the working tree has uncommitted changes — commit or stash them first:\n${dirty.out}`);
const sha = capture('git', ['rev-parse', 'HEAD']).out;
if (!/^[0-9a-f]{40}$/.test(sha)) die('could not read HEAD');

let repo = '';
if (post) {
  const view = capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  if (!view.ok || !view.out) die(`gh cannot see this repository — install gh and run \`gh auth login\` (or pass --no-post):\n${view.err}`);
  repo = view.out;
  // Checked before an hour of tests, not after: GitHub only takes a status for a commit it has.
  if (!capture('gh', ['api', `repos/${repo}/commits/${sha}`, '--silent']).ok) {
    die(`${repo} has no commit ${sha.slice(0, 7)} — push it first`);
  }
}

function setStatus(suite, state, description) {
  if (!post) return;
  const r = capture('gh', ['api', '-X', 'POST', `repos/${repo}/statuses/${sha}`,
    '-f', `state=${state}`, '-f', `context=${suite.context}`, '-f', `description=${description.slice(0, 140)}`, '--silent']);
  if (!r.ok) console.error(`[release-check] could not post ${suite.context} = ${state}: ${r.err}`);
  return r.ok;
}

const platform = `${process.platform}-${os.arch()}`;
console.log(`[release-check] ${sha.slice(0, 7)} on ${platform}: ${suites.map((s) => s.key).join(', ')}${post ? ` → statuses on ${repo}` : ' (not posting)'}`);

// Every suite launches the built app (dist/), so build HEAD first — never test a stale build.
if (!npmRun('build')) die('npm run build failed — nothing was run or posted');

const results = [];
for (const suite of suites) {
  setStatus(suite, 'pending', `Running on ${platform} (npm run ${suite.script})`);
  const started = Date.now();
  console.log(`\n[release-check] ── ${suite.label}: npm run ${suite.script}`);
  const passed = npmRun(suite.script);
  const minutes = Math.max(1, Math.round((Date.now() - started) / 60_000));
  const posted = setStatus(suite, passed ? 'success' : 'failure',
    `${passed ? 'Passed' : 'Failed'} on ${platform} in ${minutes} min (npm run ${suite.script})`);
  results.push({ suite, passed, minutes, posted });
}

console.log(`\n[release-check] ${sha.slice(0, 7)}:`);
for (const { suite, passed, minutes, posted } of results) {
  const where = !post ? '' : posted ? ` — posted ${suite.context}` : ` — NOT posted ${suite.context}`;
  console.log(`  ${passed ? 'pass' : 'FAIL'}  ${suite.label} (${minutes} min)${where}`);
}
const allPassed = results.every((r) => r.passed);
const allPosted = !post || results.every((r) => r.posted);
if (allPassed && allPosted && post && suites.length === SUITES.length) {
  console.log('\nAll release checks passed on this commit. Tag it: git tag v<version> && git push origin v<version>');
}
process.exit(allPassed && allPosted ? 0 : 1);
