import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/generate-deps.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDeclarations } from '../../../lib/ops/file-deps.mjs';
import { calculateExecutionPaths } from '../../../lib/ops/change-detector.mjs';

describe('cli/commands/generate-deps', () => {

  const mockLogger = {
    info: () => {},
    warning: () => {},
    error: () => {}
  };

  const mockRunCommand = async (cmd, args) => {
    if (cmd === 'terraform' && args.includes('-version')) {
      return; // success
    }
    throw new Error('Command failed');
  };

  const mockGetWorkspaceRoot = async () => '/mock/root';
  const mockLoadIgnorePatterns = async () => [];

  it('should generate dependency graph successfully', async (context) => {
    const mockGenerateDependencyGraph = async () => ({
      results: [
        {
          root: 'env/prod',
          status: 'success',
          providers: ['aws'],
          modules: ['mod-a'],
          logs: []
        },
        {
            root: 'env/dev',
            status: 'success',
            providers: ['aws'],
            modules: ['mod-a'],
            logs: []
          }
      ],
      roots: ['env/prod', 'env/dev']
    });

    const mockWriteFile = context.mock.fn();

    const args = { output: 'deps.json' };
    const deps = {
      logger: mockLogger,
      runCommand: mockRunCommand,
      getWorkspaceRoot: mockGetWorkspaceRoot,
      generateDependencyGraph: mockGenerateDependencyGraph,
      loadIgnorePatterns: mockLoadIgnorePatterns,
      loadFileDeclarations: async () => [],
      writeFile: mockWriteFile
    };

    await run(args, deps);

    assert.strictEqual(mockWriteFile.mock.callCount(), 1);
    const [path, content] = mockWriteFile.mock.calls[0].arguments;
    assert.strictEqual(path, 'deps.json');

    const json = JSON.parse(content);
    assert.strictEqual(json.dirs.length, 2);
    assert.strictEqual(json.modules.length, 1);
    assert.strictEqual(json.modules[0].source, 'mod-a');
    assert.deepStrictEqual(json.modules[0].usedIn, ['env/dev', 'env/prod']);
  });

  it('should reject without writing if terraform command fails', async (context) => {

      const writeFile = context.mock.fn();
      const mockRunCommandFail = async () => { throw new Error('Terraform not found'); };

      const deps = {
        logger: mockLogger,
        runCommand: mockRunCommandFail,
        getWorkspaceRoot: mockGetWorkspaceRoot,
        generateDependencyGraph: async () => ({}),
        loadIgnorePatterns: mockLoadIgnorePatterns,
        loadFileDeclarations: async () => [],
        writeFile
      };

      await assert.rejects(run({}, deps), /terraform.*Terraform not found/);
      assert.strictEqual(writeFile.mock.callCount(), 0);
  });

  it('should reject without writing a partial graph if analysis has failures', async (context) => {

    const writeFile = context.mock.fn();
    const mockGenerateFail = async () => ({
        results: [
            { root: 'env/fail', status: 'failure', logs: ['error log'] }
        ],
        roots: ['env/fail']
    });

    const deps = {
        logger: mockLogger,
        runCommand: mockRunCommand,
        getWorkspaceRoot: mockGetWorkspaceRoot,
        generateDependencyGraph: mockGenerateFail,
        loadIgnorePatterns: mockLoadIgnorePatterns,
        loadFileDeclarations: async () => [],
        writeFile
    };

    await assert.rejects(run({}, deps), /Analysis failed for 1 roots/);
    assert.strictEqual(writeFile.mock.callCount(), 0);
  });
});

it('supports local module paths that match Object prototype keys', async (context) => {
  const modules = ['constructor', 'toString', '__proto__'];
  const writeFile = context.mock.fn();
  await run({ root: '/mock/root' }, {
    runCommand: async () => {},
    loadIgnorePatterns: async () => new Set(),
    loadFileDeclarations: async () => [],
    generateDependencyGraph: async () => ({
      results: [{ root: 'env/dev', status: 'success', providers: [], modules, logs: [] }],
    }),
    logger: { info() {}, warning() {}, error() {} },
    writeFile,
  });
  const [path, content] = writeFile.mock.calls[0].arguments;
  assert.strictEqual(path, '/mock/root/.tfdeps.json');
  assert.deepStrictEqual(JSON.parse(content), {
    dirs: [{ path: 'env/dev', providers: [] }],
    modules: [...modules].sort().map(source => ({ source, usedIn: ['env/dev'] })),
  });
});

describe('generate-deps file declarations', () => {
  it('round-trips loaded declarations through generated JSON to both consumer selections', async context => {
    const root = await mkdtemp(join(tmpdir(), 'tfman-declarations-roundtrip-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const files = [
      { path: 'officeIPs.json', usedIn: ['*'] },
      { path: 'envs/hoge/hoge.json', usedIn: ['envs/hoge/*'] }
    ];
    await writeFile(join(root, '.tfdepsextra.json'), JSON.stringify({ files }));
    const roots = ['envs/hoge/dev', 'envs/hoge/stage', 'envs/hoge/prod', 'envs/hoge/dev/aoai', 'other'];
    const dirs = roots.map(path => ({ path, providers: ['aws'] }));
    const capture = context.mock.fn();
    const load = context.mock.fn(async workspace => {
      assert.strictEqual(workspace, root);
      return loadDeclarations(workspace);
    });
    await run({ root }, {
      runCommand: async () => {},
      loadIgnorePatterns: async () => [],
      generateDependencyGraph: async () => ({ results: dirs.map(dir => ({
        root: dir.path, providers: dir.providers, modules: [], logs: [], status: 'success'
      })) }),
      loadFileDeclarations: load,
      logger: { info() {}, warning() {}, error() {} },
      writeFile: capture
    });
    assert.strictEqual(load.mock.callCount(), 1);
    assert.strictEqual(capture.mock.callCount(), 1);
    const [output, content] = capture.mock.calls[0].arguments;
    assert.strictEqual(output, join(root, '.tfdeps.json'));
    const graph = JSON.parse(content);
    assert.deepStrictEqual(graph.files, [files[1], files[0]]);
    const byPath = (a, b) => a.path.localeCompare(b.path);
    assert.deepStrictEqual(calculateExecutionPaths(['envs/hoge/hoge.json'], graph).sort(byPath),
      dirs.slice(0, 3).sort(byPath));
    assert.deepStrictEqual(calculateExecutionPaths(['officeIPs.json'], graph).sort(byPath),
      [...dirs].sort(byPath));
  });

  const dirs = [{ path: 'envs/hoge/dev', providers: ['aws'] }];
  function dependencies(context, declarations) {
    return {
      runCommand: async () => {},
      loadIgnorePatterns: async () => [],
      loadFileDeclarations: async root => {
        assert.strictEqual(root, '/mock/root');
        return declarations;
      },
      generateDependencyGraph: async () => ({ results: dirs.map(dir => ({
        root: dir.path, providers: dir.providers, modules: [], logs: [], status: 'success'
      })) }),
      logger: { info() {}, error() {}, warning: context.mock.fn() },
      writeFile: context.mock.fn()
    };
  }
  it('preserves the exact legacy output for no declarations', async context => {
    const deps = dependencies(context, []);
    await run({ root: '/mock/root' }, deps);
    assert.strictEqual(deps.writeFile.mock.calls[0].arguments[1],
      JSON.stringify({ dirs, modules: [] }, null, 2) + '\n');
  });
  it('sorts files, preserves selectors and warns only about zero matches', async context => {
    const declarations = [
      { path: 'officeIPs.json', usedIn: ['*'] },
      { path: 'envs/hoge/hoge.json', usedIn: ['envs/hoge/*', 'missing'] }
    ];
    const deps = dependencies(context, declarations);
    await run({ root: '/mock/root' }, deps);
    assert.deepStrictEqual(JSON.parse(deps.writeFile.mock.calls[0].arguments[1]).files,
      [declarations[1], declarations[0]]);
    assert.strictEqual(deps.logger.warning.mock.callCount(), 1);
    assert.match(deps.logger.warning.mock.calls[0].arguments[0], /envs\/hoge\/hoge.json.*missing/);
  });
  it('does not write on declaration validation or load failure', async context => {
    const deps = dependencies(context, [{ path: '../bad', usedIn: ['*'] }]);
    await assert.rejects(run({ root: '/mock/root' }, deps), /Invalid/);
    assert.strictEqual(deps.writeFile.mock.callCount(), 0);
    deps.loadFileDeclarations = async () => { throw new Error('invalid JSON'); };
    await assert.rejects(run({ root: '/mock/root' }, deps), /invalid JSON/);
    assert.strictEqual(deps.writeFile.mock.callCount(), 0);
  });
});
