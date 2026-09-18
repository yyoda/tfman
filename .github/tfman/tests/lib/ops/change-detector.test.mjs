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
