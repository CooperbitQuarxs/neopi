const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cases = [
  'deadline kills shell grandchild and records timeout',
  'run-duration budget preempts a longer step deadline and its child group',
];
function environment(root, name, trace) {
  const home = path.join(root, 'home');
  const temp = path.join(root, 'tmp');
  const env = {
    PATH: process.env.PATH, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_STATE_HOME: path.join(home, '.local/state'), XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_RUNTIME_DIR: path.join(root, 'runtime'), NPI_DECK_HOME: path.join(root, 'deck'),
    NPI_DECK_DEFAULT_CWD: home, NPI_DECK_DB_PATH: path.join(root, 'deck/deck.db'),
    NPI_DECK_UPLOADS_ROOT: path.join(root, 'uploads'), NPI_DECK_KB_ROOT: path.join(root, 'kb'),
    PI_CODING_AGENT_DIR: path.join(root, 'agent'),
    NPI_DECK_ISOLATED_TEST_FILE: fs.realpathSync('apps/server/src/routines/foundations.test.ts'),
    NPI_DECK_ISOLATED_TEST_CASE: name, MAC_HOOK_TRACE: trace,
    NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb',
  };
  for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'NPI_DECK_HOME', 'NPI_DECK_UPLOADS_ROOT', 'NPI_DECK_KB_ROOT', 'PI_CODING_AGENT_DIR']) fs.mkdirSync(env[key], { recursive: true, mode: 0o700 });
  return env;
}
async function main() {
  const receipts = path.resolve(process.argv[2] || 'mac-hook-receipts');
  fs.mkdirSync(receipts, { recursive: true });
  const results = [];
  for (const [index, name] of cases.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-hook-probe-'));
    const trace = path.join(receipts, `${index}.jsonl`);
    const env = environment(root, name, trace);
    const child = Bun.spawn([process.execPath, 'test', '--preload', path.resolve('.github/scripts/mac-hook-preload.cjs'), env.NPI_DECK_ISOLATED_TEST_FILE], {
      env, stdin: 'ignore', stdout: Bun.file(path.join(receipts, `${index}.stdout`)), stderr: Bun.file(path.join(receipts, `${index}.stderr`)),
    });
    let bounded = false;
    const timer = setTimeout(() => { bounded = true; child.kill('SIGKILL'); }, 100_000);
    const code = await child.exited;
    clearTimeout(timer);
    const events = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    const missing = ['spawn', 'abort', 'signal-call', 'leader-exited', 'writer-endpoints', 'ownership-journal']
      .filter(event => !events.some(row => row.event === event));
    const result = { name, pid: child.pid, code, bounded, missing, root, trace };
    results.push(result);
    console.log(JSON.stringify(result));
    // Retain private fixture files when the test could not clean them up.
    // The disposable runner owns their lifetime; never sweep unrelated PIDs.
  }
  fs.writeFileSync(path.join(receipts, 'results.json'), JSON.stringify(results, null, 2));
  if (results.some(result => result.bounded || result.missing.length)) process.exitCode = 1;
}
module.exports = { cases, environment };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
