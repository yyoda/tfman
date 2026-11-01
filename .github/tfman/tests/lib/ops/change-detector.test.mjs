import { describe, it } from 'node:test';
import { deepStrictEqual, throws } from 'node:assert';
import { calculateExecutionPaths } from '../../../lib/ops/change-detector.mjs';

describe('detect-changes', () => {
    const depsData = {
        dirs: [
            { path: 'app1', providers: ['aws'] },
            { path: 'app2', providers: ['google'] },
            { path: 'app3', providers: ['azure'] }
        ],
        modules: [
            { source: 'modules/mod1', usedIn: ['app1', 'app2'] },
            { source: 'modules/mod2', usedIn: ['app1'] }
        ]
    };

    it('should match the deepest root regardless of directory order', () => {
        const dirs = [
            { path: 'envs/prod', providers: ['aws'] },
            { path: 'envs/prod/dns', providers: ['google'] }
        ];
        for (const orderedDirs of [dirs, [...dirs].reverse()]) {
            for (const root of dirs) {
                const result = calculateExecutionPaths([`${root.path}/main.tf`], { dirs: orderedDirs });
                deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [root]);
            }
        }
    });

    it('should propagate module changes inside a root to consumers', () => {
        const result = calculateExecutionPaths(['envs/prod/modules/x/main.tf'], {
            dirs: [
                { path: 'envs/prod', providers: ['aws'] },
                { path: 'envs/dev', providers: ['google'] }
            ],
            modules: [{ source: 'envs/prod/modules/x', usedIn: ['envs/dev'] }]
        });
        deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [
            { path: 'envs/dev', providers: ['google'] },
            { path: 'envs/prod', providers: ['aws'] }
        ]);
    });

    it('should propagate changes when a root is used as a module', () => {
        const result = calculateExecutionPaths(['envs/base/main.tf'], {
            dirs: [
                { path: 'envs/base', providers: ['aws'] },
                { path: 'envs/prod', providers: ['google'] }
            ],
            modules: [{ source: 'envs/base', usedIn: ['envs/prod'] }]
        });
        deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [
            { path: 'envs/base', providers: ['aws'] },
            { path: 'envs/prod', providers: ['google'] }
        ]);
    });

    it('rejects invalid roots even when no files changed', () => {
        for (const path of ['', 'env/$(id)', 'env/../other', 'env/日本語']) {
            throws(() => calculateExecutionPaths([], { dirs: [{ path }] }), /Invalid root path:/);
            for (const source of ['modules/mod1', '']) {
                throws(() => calculateExecutionPaths([], {
                    modules: [{ source, usedIn: [path] }]
                }), /Invalid root path:/);
            }
        }
    });

    it('does not validate filenames inside valid roots', () => {
        deepStrictEqual(calculateExecutionPaths(['app1/日本語 $(id).tf'], depsData), [
            { path: 'app1', providers: ['aws'] }
        ]);
    });

    it('should detect direct root change', () => {
        const changedFiles = ['app1/main.tf'];
        const result = calculateExecutionPaths(changedFiles, depsData);
        deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [
            { path: 'app1', providers: ['aws'] }
        ]);
    });

    it('should detect module change', () => {
        const changedFiles = ['modules/mod1/main.tf'];
        const result = calculateExecutionPaths(changedFiles, depsData);
        deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [
            { path: 'app1', providers: ['aws'] },
            { path: 'app2', providers: ['google'] }
        ]);
    });

    it('should handle mixed changes', () => {
        const changedFiles = [
            'app3/variables.tf',
            'modules/mod2/outputs.tf'
        ];
        const result = calculateExecutionPaths(changedFiles, depsData);
        deepStrictEqual(result.sort((a, b) => a.path.localeCompare(b.path)), [
            { path: 'app1', providers: ['aws'] },
            { path: 'app3', providers: ['azure'] }
        ]);
    });

    it('should ignore unrelated files', () => {
        const changedFiles = ['README.md', 'outside/other.txt'];
        const result = calculateExecutionPaths(changedFiles, depsData);
        deepStrictEqual(result, []);
    });

    it('should handle new files inside new folder (root)', () => {
        const changedFiles = ['app4/main.tf'];
        // app4 is not in depsData
        const result = calculateExecutionPaths(changedFiles, depsData);
        deepStrictEqual(result, []);
    });
});

describe('declared input changes', () => {
  const dirs = ['envs/hoge/dev', 'envs/hoge/stage', 'envs/hoge/prod', 'envs/hoge/dev/aoai', 'other']
    .map(path => ({ path, providers: ['aws'] }));
  it('selects every root with equivalent star and double-star selectors', () => {
    for (const selector of ['*', '**']) {
      deepStrictEqual(calculateExecutionPaths(['officeIPs.json'], {
        dirs, files: [{ path: 'officeIPs.json', usedIn: [selector] }]
      }), dirs);
    }
  });
  it('matches changed paths with spaces and Japanese characters without declaration validation', () => {
    for (const path of ['dir/with spaces.json', 'dir/日本語.json', 'dir/日本語 ファイル.json']) {
      for (const pattern of ['**', 'dir/']) {
        deepStrictEqual(calculateExecutionPaths([path], {
          dirs, files: [{ path: pattern, usedIn: ['envs/hoge/*'] }]
        }), dirs.slice(0, 3));
      }
    }
  });
  it('selects the declared consumers for both external file cases', () => {
    const files = [
      { path: 'envs/hoge/hoge.json', usedIn: ['envs/hoge/*'] },
      { path: 'officeIPs.json', usedIn: ['*'] }
    ];
    deepStrictEqual(calculateExecutionPaths(['envs/hoge/hoge.json'], { dirs, files }), dirs.slice(0, 3));
    deepStrictEqual(calculateExecutionPaths(['officeIPs.json'], { dirs, files }), dirs);
  });
  it('unions all file edges, root and module matches with providers and no duplicates', () => {
    const files = [
      { path: 'envs/hoge/dev/*.json', usedIn: ['other', 'envs/hoge/dev'] },
      { path: 'envs/**', usedIn: ['envs/hoge/stage'] }
    ];
    const modules = [{ source: 'envs/hoge/dev', usedIn: ['envs/hoge/prod'] }];
    deepStrictEqual(calculateExecutionPaths(['envs/hoge/dev/deleted.json'], { dirs, files, modules }),
      [dirs[0], dirs[2], dirs[4], dirs[1]]);
  });
  it('ignores declaration-only changes and unknown or excluded consumers', () => {
    deepStrictEqual(calculateExecutionPaths(['.tfdeps.json', '.tfdepsextra.json'], {
      dirs, files: [{ path: '**', usedIn: ['*'] }]
    }), []);
    deepStrictEqual(calculateExecutionPaths(['deleted.json'], {
      dirs, files: [{ path: '**', usedIn: ['excluded', 'missing/*'] }]
    }), []);
  });
  it('validates file edges even without changes and preserves legacy behavior', () => {
    for (const files of [null, {}, [{ path: '../x', usedIn: ['*'] }]]) {
      throws(() => calculateExecutionPaths([], { dirs, files }));
    }
    const changes = ['envs/hoge/dev/main.tf'];
    deepStrictEqual(calculateExecutionPaths(changes, { dirs, files: [] }), calculateExecutionPaths(changes, { dirs }));
  });
});
