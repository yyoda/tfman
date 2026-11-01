import { describe, it } from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { calculateExecutionPaths } from '../../../lib/ops/change-detector.mjs';
import { parseDeclarations, matchFile, expandSelector, loadDeclarations } from '../../../lib/ops/file-deps.mjs';

describe('file dependencies', () => {
  it('validates and canonicalizes declarations', () => {
    assert.deepStrictEqual(parseDeclarations({ files: [{ path: '*.json', usedIn: ['*'], extra: true }] }),
      [{ path: '*.json', usedIn: ['*'] }]);
    for (const data of [null, [], 1, {}, { files: null }, { files: [null] },
      { files: [{ path: 1, usedIn: ['*'] }] },
      { files: [{ path: 'a', usedIn: [] }] }, { files: [{ path: 'a', usedIn: [1] }] },
      { files: [{ path: 'a', usedIn: ['*'] }, { path: 'a', usedIn: ['*'] }] }]) {
      assert.throws(() => parseDeclarations(data));
    }
    for (const path of ['', '/a', '../a', 'a/../b', '.hidden', '_a', '-a', 'a//b',
      'a//', 'a b', '日本語', 'a\\b', 'a?', 'a**', '**.json', '*a**']) {
      assert.throws(() => parseDeclarations({ files: [{ path, usedIn: ['*'] }] }), path);
      assert.throws(() => parseDeclarations({ files: [{ path: 'a', usedIn: [path] }] }), path);
    }
    assert.throws(() => parseDeclarations({ files: [{ path: 'a', usedIn: ['env/'] }] }));
  });

  it('rejects wildcards in trailing-slash directory prefixes', () => {
    for (const path of ['rules/*/', 'rules/**/']) {
      assert.throws(() => parseDeclarations({ files: [{ path, usedIn: ['*'] }] }),
        /directory prefix must be literal; use a glob such as dir\/\*\*/);
    }
    assert.deepStrictEqual(parseDeclarations({ files: [{ path: 'rules/', usedIn: ['*'] }] }),
      [{ path: 'rules/', usedIn: ['*'] }]);
  });

  it('accepts 64 segments and rejects 65 for paths and selectors', () => {
    for (const count of [64, 65]) {
      const pattern = Array(count).fill('a').join('/');
      for (const entry of [
        { path: pattern, usedIn: ['*'] },
        { path: pattern + '/', usedIn: ['*'] },
        { path: 'a', usedIn: [pattern] }
      ]) {
        const parse = () => parseDeclarations({ files: [entry] });
        if (count === 64) assert.deepStrictEqual(parse(), [entry]);
        else assert.throws(parse, /at most 64 path segments/);
      }
    }
  });

  it('accepts 255-character segments and rejects 256 for paths and selectors', () => {
    for (const count of [255, 256]) {
      const pattern = 'dir/' + 'a'.repeat(count);
      for (const entry of [
        { path: pattern, usedIn: ['*'] },
        { path: pattern + '/', usedIn: ['*'] },
        { path: 'a', usedIn: [pattern] }
      ]) {
        const parse = () => parseDeclarations({ files: [entry] });
        if (count === 255) assert.deepStrictEqual(parse(), [entry]);
        else assert.throws(parse, /at most 255 characters/);
      }
    }
  });

  it('rejects 10000 recursive segments during validation', () => {
    const pattern = '**/'.repeat(10000) + 'x';
    for (const entry of [
      { path: pattern, usedIn: ['*'] },
      { path: 'a', usedIn: [pattern] }
    ]) {
      assert.throws(() => parseDeclarations({ files: [entry] }), /at most 64 path segments/);
    }
  });

  it('matches adjacent recursive segments equivalently', () => {
    for (const path of ['a/b', 'a/x/b', 'a/x/y/b', 'a/x/b/c', 'b']) {
      assert.strictEqual(matchFile('a/**/**/b', path), matchFile('a/**/b', path), path);
    }
  });

  it('matches a changed path with 5000 directory segments without overflowing', () => {
    const [{ path: pattern }] = parseDeclarations({ files: [{ path: '**/x', usedIn: ['*'] }] });
    assert.strictEqual(matchFile(pattern, 'a/'.repeat(5000) + 'x'), true);
    assert.strictEqual(matchFile(pattern, 'a/'.repeat(5000) + 'y'), false);
  });

  it('selects consumers for a matching changed path with 50000 directory segments', () => {
    assert.deepStrictEqual(calculateExecutionPaths(['a/'.repeat(50000) + 'x'], {
      dirs: [{ path: 'env/prod' }],
      files: [{ path: '**/x', usedIn: ['*'] }]
    }), [{ path: 'env/prod', providers: [] }]);
  });

  it('returns no consumers for a non-matching changed path with 50000 directory segments', () => {
    assert.deepStrictEqual(calculateExecutionPaths(['a/'.repeat(50000) + 'y'], {
      dirs: [{ path: 'env/prod' }],
      files: [{ path: '**/x', usedIn: ['*'] }]
    }), []);
  });

  it('matches a deep path with a middle recursive segment', () => {
    assert.strictEqual(matchFile('a/**/z', 'a/' + 'm/'.repeat(50000) + 'z'), true);
  });

  it('rejects a deep path with a middle recursive segment and a different ending', () => {
    assert.strictEqual(matchFile('a/**/z', 'a/' + 'm/'.repeat(50000) + 'q'), false);
  });

  it('matches adversarial wildcard segments quickly', () => {
    const pattern = '*a'.repeat(16) + 'b';
    const segment = 'a'.repeat(64);
    const start = performance.now();
    assert.strictEqual(matchFile(pattern, segment), false);
    assert.strictEqual(matchFile(pattern, segment + 'b'), true);
    assert.ok(performance.now() - start < 2000, 'wildcard matching must complete within 2000ms');
  });

  it('matches exact, deleted, prefix and glob paths without filesystem access', () => {
    for (const [pattern, path, expected] of [
      ['deleted.json', 'deleted.json', true], ['a.json', 'b.json', false],
      ['envs/hoge/', 'envs/hoge/rules/a', true], ['envs/hoge/', 'envs/hoge2/a', false],
      ['rules/*', 'rules/a', true], ['rules/*', 'rules/a/b', false],
      ['rules/**', 'rules/team/rule.json', true], ['rules/**', 'rules/rule.json', true],
      ['a/**/b', 'a/b', true], ['a/**/b', 'a/x/y/b', true],
      ['a/**/b', 'a/x/b/c', false], ['a/**', 'a', true],
      ['**/*.json', 'a.json', true], ['**/*.json', 'a/b.json', true],
      ['**/**/b', 'b', true], ['rules/rule-*.json', 'rules/rule-a.json', true],
      ['*.json', 'aXjson', false]
    ]) assert.strictEqual(matchFile(pattern, path), expected, `${pattern}: ${path}`);
  });

  it('distinguishes all-roots, single-segment and recursive selectors', () => {
    const roots = ['envs/hoge/dev', 'envs/hoge/dev/aoai', 'other'];
    assert.deepStrictEqual(expandSelector('*', roots), roots);
    assert.deepStrictEqual(expandSelector('**', roots), roots);
    assert.deepStrictEqual(expandSelector('*', roots), expandSelector('**', roots));
    assert.deepStrictEqual(expandSelector('envs/hoge/*', roots), roots.slice(0, 1));
    assert.deepStrictEqual(expandSelector('envs/hoge/**', roots), roots.slice(0, 2));
    assert.deepStrictEqual(expandSelector('other', roots), ['other']);
    assert.deepStrictEqual(expandSelector('missing', roots), []);
  });

  it('loads declarations and only tolerates missing files', async () => {
    assert.deepStrictEqual(await loadDeclarations('/workspace', async (path, encoding) => {
      assert.strictEqual(path, '/workspace/.tfdepsextra.json');
      assert.strictEqual(encoding, 'utf8');
      return '{"files":[]}';
    }), []);
    assert.deepStrictEqual(await loadDeclarations('/workspace', async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }), []);
    await assert.rejects(loadDeclarations('/workspace', async () => '{'), SyntaxError);
    await assert.rejects(loadDeclarations('/workspace', async () => '{}'), /array/);
    await assert.rejects(loadDeclarations('/workspace', async () => { throw new Error('read failed'); }), /read failed/);
  });

  it('matches spaces and Japanese changed paths with recursive and prefix patterns', () => {
    for (const path of ['dir/with spaces.json', 'dir/日本語.json', 'dir/日本語 ファイル.json']) {
      assert.strictEqual(matchFile('**', path), true);
      assert.strictEqual(matchFile('dir/', path), true);
      assert.strictEqual(matchFile('other/', path), false);
    }
  });
});
