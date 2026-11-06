const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wows-plugin-test-'));
  const tmp = path.join(root, 'temporary files');
  fs.mkdirSync(tmp);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const runs = [];
  const sent = [];
  const chain = new Proxy(() => chain, { get: () => chain });
  const network = {
    get(url, callback) {
      requests.push(String(url));
      const request = new EventEmitter();
      process.nextTick(() => {
        if (options.requestError) {
          request.emit('error', new Error('connection failed'));
          return;
        }
        const response = options.responseError
          ? new Readable({ read() { this.destroy(new Error('response interrupted')); } })
          : Readable.from([Buffer.from('replay data')]);
        response.statusCode = options.statusCode || 200;
        callback(response);
      });
      return request;
    },
  };
  const processMock = options.process || {
    execFile(executable, args, settings, callback) {
      runs.push({ executable, args: Array.from(args), settings });
      const replay = args[3];
      assert.equal(fs.readFileSync(replay, 'utf8'), 'replay data');
      setImmediate(() => {
        if (options.processError) return callback(new Error('renderer failed'), '', 'render error');
        if (!options.missingVideo) fs.writeFileSync(path.join(path.dirname(replay), 'replay.mp4'), 'video data');
        fs.writeFileSync(path.join(path.dirname(replay), 'replay-builds.json'), '{}');
        callback(null, '', '');
      });
    },
    exec() { throw new Error('A shell must never be used'); },
  };
  const fsMock = options.fileError ? {
    ...fs,
    createWriteStream() {
      return new Writable({ write(chunk, encoding, callback) { callback(new Error('disk full')); } });
    },
  } : fs;
  const mocks = {
    koishi: { Schema: chain, h: { video: (data, type) => ({ data, type }) } },
    fs: fsMock, 'node:fs': fsMock,
    http: network, 'node:http': network, https: network, 'node:https': network,
    child_process: processMock, 'node:child_process': processMock,
    'node:os': { tmpdir: () => tmp },
  };
  const exports = {};
  const load = vm.runInThisContext(`(function(require, exports, __dirname) { ${compiled.outputText}\n})`);
  // Keep any legacy uploads directory inside the disposable fixture, too.
  fs.mkdirSync(path.join(root, 'src'));
  load((name) => mocks[name] || require(name), exports, path.join(root, 'src'));
  let action;
  exports.apply({
    command(name) {
      assert.equal(name, 'replay <fileUrl>');
      return { alias(name) { assert.equal(name, '复盘'); return this; }, action(fn) { action = fn; } };
    },
  }, { pythonPath: options.pythonPath === undefined ? 'C:/Program Files/Python/python.exe' : options.pythonPath, replayMessages: ['comment'] });
  return {
    root, tmp, requests, runs, sent,
    invoke: (url) => action({ session: { send: async (message) => sent.push(message) } }, url),
    assertClean: () => assert.deepEqual(fs.readdirSync(tmp), []),
  };
}

test('passes an executable and literal arguments without a shell; returns the video and cleans sidecars', async (t) => {
  const f = fixture(t);
  const result = await f.invoke('https://example.test/ordinary.wowsreplay');
  assert.equal(result.type, 'video/mp4');
  assert.equal(result.data.toString(), 'video data');
  assert.deepEqual(f.sent, ['comment']);
  assert.equal(f.runs.length, 1);
  const run = f.runs[0];
  assert.equal(run.executable, 'C:/Program Files/Python/python.exe');
  assert.equal(run.settings.shell, false);
  assert.deepEqual(run.args.slice(0, 3), ['-m', 'render', '--replay']);
  assert.equal(path.basename(run.args[3]), 'replay.wowsreplay');
  assert.equal(path.dirname(path.dirname(run.args[3])), f.tmp);
  f.assertClean();
});

test('remote names never become local filenames or process options', async (t) => {
  const f = fixture(t);
  for (const name of [
    '$(touch marker)', '`touch marker`', 'a"; touch marker; %23',
    '%24%28touch%20marker%29', 'a%2Fb%5Cc', '空 格',
    '--help', 'first.wowsreplay.second', 'C:\\fake\\replay',
  ]) {
    const result = await f.invoke(`https://example.test/${name}.wowsreplay`);
    assert.equal(result.type, 'video/mp4', name);
    assert.equal(path.basename(f.runs.at(-1).args[3]), 'replay.wowsreplay', name);
    f.assertClean();
  }
});

test('same-URL concurrent requests use separate working directories', async (t) => {
  const f = fixture(t);
  await Promise.all(Array.from({ length: 4 }, () => f.invoke('https://example.test/replay.wowsreplay')));
  assert.equal(new Set(f.runs.map((run) => run.args[3])).size, 4);
  f.assertClean();
});

test('accepts HTTP(S) replay URLs with query strings and fragments', async (t) => {
  const f = fixture(t);
  for (const url of ['http://example.test/replay.wowsreplay', 'https://example.test/replay.wowsreplay?token=example#fragment']) {
    assert.equal((await f.invoke(url)).type, 'video/mp4');
  }
  assert.equal(f.requests.length, 2);
  f.assertClean();
});

test('rejects missing, malformed, unsupported, and non-replay URLs before any download', async (t) => {
  const f = fixture(t);
  for (const url of [undefined, 'not a URL.wowsreplay', 'file:///tmp/test.wowsreplay', 'ftp://example.test/a.wowsreplay', 'https://example.test/a.txt?fake=.wowsreplay']) {
    assert.equal(typeof await f.invoke(url), 'string');
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.runs.length, 0);
  f.assertClean();
});

test('missing Python configuration does not download or create temporary files', async (t) => {
  const f = fixture(t, { pythonPath: '' });
  assert.match(await f.invoke('https://example.test/replay.wowsreplay'), /Python/);
  assert.equal(f.requests.length, 0);
  f.assertClean();
});

for (const [name, options] of [
  ['renderer failure', { processError: true }],
  ['HTTP failure', { statusCode: 404 }],
  ['request failure', { requestError: true }],
  ['interrupted response', { responseError: true }],
  ['file write failure', { fileError: true }],
]) {
  test(`cleans temporary files after ${name}`, async (t) => {
    const f = fixture(t, options);
    await assert.rejects(f.invoke('https://example.test/replay.wowsreplay'));
    f.assertClean();
    if (!options.processError) assert.equal(f.runs.length, 0);
  });
}

test('missing video returns the existing diagnostic and cleans temporary files', async (t) => {
  const f = fixture(t, { missingVideo: true });
  assert.match(await f.invoke('https://example.test/replay.wowsreplay'), /视频生成失败/);
  f.assertClean();
});

test('shell command substitutions never execute in real subprocesses', { skip: process.platform === 'win32' }, async (t) => {
  const f = fixture(t, { process: childProcess });
  // A harmless executable simulates Python's render CLI and checks the complete argv.
  const executable = path.join(f.root, 'python');
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst assert = require('node:assert/strict');\nconst args = process.argv.slice(2);\nassert.deepEqual(args.slice(0, 3), ['-m', 'render', '--replay']);\nassert.equal(args.length, 4);\nassert.equal(fs.readFileSync(args[3], 'utf8'), 'replay data');\nfs.writeFileSync(path.join(path.dirname(args[3]), path.basename(args[3], '.wowsreplay') + '.mp4'), 'video data');\n`, { mode: 0o700 });
  for (const payload of ['$(touch shell-marker)', '`touch shell-marker`']) {
    const run = fixture(t, {
      pythonPath: executable,
      process: {
        exec: (command, callback) => childProcess.exec(command, { cwd: f.root }, callback),
        execFile: (file, args, options, callback) => childProcess.execFile(file, args, { ...options, cwd: f.root }, callback),
      },
    });
    let result;
    let failure;
    try { result = await run.invoke(`https://example.test/${payload}.wowsreplay`); } catch (error) { failure = error; }
    assert.equal(fs.existsSync(path.join(f.root, 'shell-marker')), false, 'shell command substitution executed');
    assert.ifError(failure);
    assert.equal(result.data.toString(), 'video data');
    run.assertClean();
  }
  const spacedExecutable = path.join(f.root, 'python with spaces');
  fs.copyFileSync(executable, spacedExecutable);
  fs.chmodSync(spacedExecutable, 0o700);
  const spaced = fixture(t, { pythonPath: spacedExecutable, process: childProcess });
  assert.equal((await spaced.invoke('https://example.test/ordinary.wowsreplay')).data.toString(), 'video data');
  spaced.assertClean();
});

test('missing executable rejects and cleans the request directory', async (t) => {
  const f = fixture(t, { pythonPath: path.join(os.tmpdir(), 'missing-wows-python-executable'), process: childProcess });
  await assert.rejects(f.invoke('https://example.test/replay.wowsreplay'));
  f.assertClean();
});
