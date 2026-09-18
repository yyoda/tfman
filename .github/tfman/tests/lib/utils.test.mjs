
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFile, readFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runCommand, getWorkspaceRoot, loadJson, appendGithubOutput, assertSafeRootPath } from '../../lib/utils.mjs';

describe('utils.mjs', () => {

  describe('runCommand', () => {
    it('should resolve with stdout when command succeeds', async () => {
      // Use array args for security update and platform independence
      const { stdout } = await runCommand('echo', ['hello', 'world']);
      assert.strictEqual(stdout, 'hello world');
    });

    it('should reject when command fails (non-zero exit code)', async () => {
      // Use 'false' or similar command that exits with 1
      // 'exit 1' is a shell builtin, so it won't work with spawn(..., {shell: false})
      // Using 'false' command which is standard
      await assert.rejects(
        async () => await runCommand('false'),
        (err) => {
          assert.strictEqual(err.code, 1);
          return true;
        }
      );
    });

    it('preserves output whitespace when trimming is disabled', async () => {
      const output = ' leading\tand trailing \n';
      const script = `process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(output)})`;
      const result = await runCommand(process.execPath, ['-e', script], { trimOutput: false });
      assert.deepStrictEqual(result, { stdout: output, stderr: output });
    });

    it('should return stderr content', async () => {
      // Cannot use shell redirection >&2 with shell: false.
      // Need a way to write to stderr without shell.
      // node -e "console.error('warning')" is a portable way
      const { stderr } = await runCommand('node', ['-e', 'console.error("warning")']);
      assert.strictEqual(stderr, 'warning');
    });
  });

  describe('getWorkspaceRoot', () => {
    it('should return a non-empty string', async () => {
      const root = await getWorkspaceRoot();
      assert.strictEqual(typeof root, 'string');
      assert.ok(root.length > 0);
      // Since we are inside a git repo (this workspace), it should return an absolute path
      assert.match(root, /^\//); 
    });
  });

  describe('loadJson', () => {
    
    it('should load valid JSON', async () => {
        const tempFile = join(tmpdir(), `test-utils-${Date.now()}.json`);
        const data = { foo: 'bar', num: 123 };
        
        try {
            await writeFile(tempFile, JSON.stringify(data));
            const loaded = await loadJson(tempFile);
            assert.deepStrictEqual(loaded, data);
        } finally {
            await unlink(tempFile).catch(() => {});
        }
    });

    it('should throw "File not found" error if file does not exist', async () => {
        const nonExistent = join(tmpdir(), `non-existent-${Date.now()}.json`);
        await assert.rejects(
            async () => await loadJson(nonExistent),
            (err) => {
                return err.message.includes('File not found');
            }
        );
    });

    it('should throw "Failed to decode JSON" error on invalid JSON syntax', async () => {
        const invalidFile = join(tmpdir(), `invalid-utils-${Date.now()}.json`);
        try {
            await writeFile(invalidFile, '{ broken json: }'); // Write invalid JSON
            await assert.rejects(
                async () => await loadJson(invalidFile),
                (err) => {
                    return err.message.includes('Failed to decode JSON');
                }
            );
        } finally {
            await unlink(invalidFile).catch(() => {});
        }
    });
  });
});

describe('appendGithubOutput', () => {
  it('appends single-line and multiline values and ignores a falsy file', async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'github-output-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const file = join(cwd, 'output');
    await appendGithubOutput({ text: 'hello', number: 42, missing: undefined, empty: null }, file);
    await appendGithubOutput({ message: 'first\nlast' }, file);
    assert.strictEqual(await readFile(file, 'utf8'),
      'text=hello\nnumber=42\nmissing=\nempty=\nmessage<<ghadelim\nfirst\nlast\nghadelim\n');
    await appendGithubOutput({ message: 'ghadelim' }, '');
    await assert.rejects(appendGithubOutput({ message: 'first\nghadelim\nlast' }, file), /delimiter/);
  });
});

describe('assertSafeRootPath', () => {
  it('returns valid relative root paths unchanged', () => {
    for (const path of ['environments/test1', 'environments/test2', 'A0/b.c_d-e', 'root']) {
      assert.strictEqual(assertSafeRootPath(path), path);
    }
  });

  it('rejects invalid types, segments, and shell syntax', () => {
    for (const path of [undefined, null, 42, {}, [], '', '/', '/root', 'C:/root',
      'root\\child', '.', '..', '.github/root', 'root/.hidden', 'root/../other',
      'root//child', 'root/', 'root/ space', 'root/$(id)', 'root/`id`',
      'root/"x"', "root/'x'", 'root/x;y', 'root/x|y', 'root/x&y',
      'root/x\n', 'root/x\r', 'root/日本語', '-root', '_root']) {
      assert.throws(() => assertSafeRootPath(path), {
        message: `Invalid root path: ${JSON.stringify(path)}`,
      });
    }
  });
});
