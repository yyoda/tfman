import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../scripts/cli/commands/detect-changes.mjs';

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

  it('should warn and proceed if dependency graph fails to load', async (context) => {
    const mockConsoleWarn = context.mock.method(console, 'warn', () => {});
    const args = { base: 'main', head: 'feature', 'deps-file': 'invalid.json' };
    
    // Should fallback to basic detection (mock returns ['path/to/changed'] when depGraph is null)
    const result = await run(args, { 
        detectChanges: mockDetectChanges,
        loadJson: mockLoadJson
    });
    
    assert.strictEqual(mockConsoleWarn.mock.callCount(), 1);
    assert.deepStrictEqual(result, ['path/to/changed']);
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
