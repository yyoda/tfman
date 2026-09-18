import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/generate-deps.mjs';

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
