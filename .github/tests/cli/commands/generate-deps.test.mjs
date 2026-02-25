import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../scripts/cli/commands/generate-deps.mjs';

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
  const mockGetRepoName = async () => 'mock-repo';

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
      getRepoName: mockGetRepoName,
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

  it('should exit if terraform command fails', async (context) => {
      // We need to mock process.exit to prevent test runner from exiting
      const mockExit = context.mock.method(process, 'exit', () => { throw new Error('Process exited'); });
      
      const mockRunCommandFail = async () => { throw new Error('Terraform not found'); };
      
      const deps = {
        logger: mockLogger,
        runCommand: mockRunCommandFail,
        getWorkspaceRoot: mockGetWorkspaceRoot,
        generateDependencyGraph: async () => ({}),
        loadIgnorePatterns: mockLoadIgnorePatterns,
        getRepoName: mockGetRepoName, // Provide mock to avoid using default
        writeFile: async () => {} 
      };

      await assert.rejects(async () => await run({}, deps), /Process exited/);
      assert.strictEqual(mockExit.mock.callCount(), 1);
      assert.strictEqual(mockExit.mock.calls[0].arguments[0], 1);
  });

  it('should exit if analysis has failures', async (context) => {
    const mockExit = context.mock.method(process, 'exit', () => { throw new Error('Process exited'); });

    const mockGenerateFail = async () => ({
        results: [
            { root: 'env/fail', status: 'error', logs: ['error log'] }
        ],
        roots: ['env/fail']
    });

    const deps = {
        logger: mockLogger,
        runCommand: mockRunCommand,
        getWorkspaceRoot: mockGetWorkspaceRoot,
        generateDependencyGraph: mockGenerateFail,
        loadIgnorePatterns: mockLoadIgnorePatterns,
        getRepoName: mockGetRepoName, // Provide mock to avoid using default
        writeFile: async () => {}
    };

    await assert.rejects(async () => await run({}, deps), /Process exited/);
    assert.strictEqual(mockExit.mock.callCount(), 1);
  });
});
