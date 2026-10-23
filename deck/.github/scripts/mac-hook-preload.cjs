// Diagnostic observers only. Forward every native operation without cancelling readers.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const start = performance.now();
const output = process.env.MAC_HOOK_TRACE;
const tracked = new Set([process.pid]);
const labels = new WeakMap();
const emit = (event, data = {}) => fs.appendFileSync(output, JSON.stringify({ time: new Date().toISOString(), ms: performance.now() - start, pid: process.pid, event, ...data }) + '\n');
function command(bin, args) {
  try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { return { status: error.status, stdout: error.stdout?.toString(), stderr: error.stderr?.toString() }; }
}
function snapshot(reason) {
  const table = command('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command=']);
  if (typeof table === 'string') {
    const rows = table.trim().split('\n').map(line => ({ line, fields: line.trim().split(/\s+/) }));
    let changed;
    do {
      changed = false;
      for (const { fields } of rows) if (tracked.has(Number(fields[1])) && !tracked.has(Number(fields[0]))) {
        tracked.add(Number(fields[0])); changed = true;
      }
    } while (changed);
    emit('ps', { reason, rows: rows.filter(row => tracked.has(Number(row.fields[0]))).map(row => row.line) });
  } else emit('ps-error', { reason, result: table });
  const pids = [...tracked].join(',');
  emit('writer-endpoints', { reason, pids, result: command('/usr/sbin/lsof', ['-nP', '-a', '-p', pids, '-d', '1,2']) });
  emit('bun-descriptors', { reason, result: command('/usr/sbin/lsof', ['-nP', '-p', String(process.pid)]) });
  const journal = path.join(process.env.NPI_DECK_HOME || '', 'run', 'owned.json');
  try { emit('ownership-journal', { reason, journal, bytes: fs.readFileSync(journal, 'utf8') }); }
  catch (error) { emit('ownership-journal', { reason, journal, error: error.code }); }
}
const getReader = ReadableStream.prototype.getReader;
ReadableStream.prototype.getReader = function (...args) {
  const reader = Reflect.apply(getReader, this, args);
  const label = labels.get(this);
  if (label) {
    const read = reader.read;
    reader.read = async function (...args) {
      try {
        const result = await Reflect.apply(read, this, args);
        emit(result.done ? 'EOF' : 'read', { ...label, bytes: result.value?.byteLength });
        return result;
      } catch (error) { emit('read-error', { ...label, error: String(error) }); throw error; }
    };
    reader.closed.then(() => emit('reader-closed', label), error => emit('reader-close-error', { ...label, error: String(error) }));
  }
  return reader;
};
const spawn = Bun.spawn;
Bun.spawn = function (...args) {
  const proc = Reflect.apply(spawn, Bun, args);
  const options = Array.isArray(args[0]) ? args[1] : args[0];
  const cmd = Array.isArray(args[0]) ? args[0] : options?.cmd;
  // The two original tests use precisely this command shape. Ignore backend helpers.
  if (cmd?.some(arg => typeof arg === 'string' && arg.includes('sleep 30 & echo $!'))) {
    tracked.add(proc.pid);
    emit('spawn', { child: proc.pid, cmd, detached: options?.detached });
    for (const stream of ['stdout', 'stderr']) if (proc[stream] instanceof ReadableStream) labels.set(proc[stream], { child: proc.pid, stream });
    const kill = proc.kill;
    proc.kill = function (...args) {
      emit('signal-call', { child: proc.pid, signal: args[0] ?? 'SIGTERM' });
      snapshot('before-signal');
      const result = Reflect.apply(kill, this, args);
      emit('signal-return', { child: proc.pid });
      for (const delay of [0, 100, 1000, 10000]) setTimeout(() => snapshot(`after-signal-${delay}`), delay).unref();
      return result;
    };
    proc.exited.then(code => { emit('leader-exited', { child: proc.pid, code, signal: proc.signalCode }); snapshot('leader-exited'); });
    setTimeout(() => snapshot('before-deadline'), 300).unref();
    setTimeout(() => snapshot('after-four-second-bound'), 4500).unref();
    setTimeout(() => snapshot('hook-stall'), 12000).unref();
    setTimeout(() => snapshot('before-natural-sleep-exit'), 28000).unref();
  }
  return proc;
};
const abort = AbortController.prototype.abort;
AbortController.prototype.abort = function (...args) {
  emit('abort', { reason: String(args[0]) });
  return Reflect.apply(abort, this, args);
};
const kill = process.kill;
process.kill = function (...args) {
  emit('process-signal', { target: args[0], signal: args[1] });
  return Reflect.apply(kill, process, args);
};
process.on('exit', code => emit('test-process-exit', { code }));
emit('preload', { platform: process.platform, bun: Bun.version });
