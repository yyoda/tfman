import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../cli/commands/detect-changes.mjs';

describe('cli/commands/detect-changes', () => {

  const mockDetectChanges = async (base, head, depGraph) => {
    return depGraph ? ['path/to/affected'] : ['path/to/changed'];
  };

  const mockLoadJson = async (path) => {
    if (path === 'valid-deps.json') return { dependencies: {} };
    throw new Error('File not found');
  };

  const mockSaveJson = async (path, data) => {
     // Mock implementation
     return;
  };

  it('should throw error if required args are missing', async () => {
    await assert.rejects(
      async () => await run({}, { detectChanges: mockDetectChanges }),
      /Missing required arguments: base, head/
    );
  });

  it('should detect changes without dependency graph', async () => {
    const args = { base: 'main', head: 'feature' };
    const result = await run(args, { detectChanges: mockDetectChanges });
    assert.deepStrictEqual(result, ['path/to/changed']);
  });

  it('should detect changes with dependency graph', async () => {
    const args = { base: 'main', head: 'feature', 'deps-file': 'valid-deps.json' };
    const result = await run(args, { 
        detectChanges: mockDetectChanges,
        loadJson: mockLoadJson
    });
    assert.deepStrictEqual(result, ['path/to/affected']);
  });

  it('should fail if the specified deps file cannot be loaded', async (context) => {
    const detectChangesMock = context.mock.fn(mockDetectChanges);
    const args = { base: 'main', head: 'feature', 'deps-file': 'invalid.json' };

    await assert.rejects(
      async () => await run(args, {
        detectChanges: detectChangesMock,
        loadJson: async (path) => {
          throw new Error(`File not found: ${path}`);
        }
      }),
      /invalid\.json/
    );

    assert.strictEqual(detectChangesMock.mock.callCount(), 0);
  });

  it('should save output if output path is provided', async (context) => {
    const args = { base: 'main', head: 'feature', output: 'result.json' };
    const mockSave = context.mock.fn();
    
    await run(args, { 
        detectChanges: mockDetectChanges,
        saveJson: mockSave
    });

    assert.strictEqual(mockSave.mock.callCount(), 1);
    const [path, data] = mockSave.mock.calls[0].arguments;
    assert.strictEqual(path, 'result.json');
    assert.deepStrictEqual(data, { include: ['path/to/changed'] });
  });

});
