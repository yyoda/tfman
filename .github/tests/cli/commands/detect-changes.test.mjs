import { describe, it } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { calculateExecutionPaths } from '../../../scripts/cli/commands/detect-changes.mjs';

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
