import { describe, it } from 'node:test';
import { deepStrictEqual, throws } from 'node:assert';
import { resolveTargets } from '../../../lib/ops/target-selector.mjs';

describe('select-targets', () => {
    const depsData = {
        dirs: [
            { path: 'app1', providers: ['aws'] },
            { path: 'app2', providers: ['google'] }
        ]
    };

    it('should select direct targets', () => {
        const { includeList, failedTargets } = resolveTargets(['app1'], depsData);
        deepStrictEqual(includeList, [{ path: 'app1', providers: ['aws'] }]);
        deepStrictEqual(failedTargets, []);
    });

    it('should select targets with trailing slash', () => {
        const { includeList, failedTargets } = resolveTargets(['app2/'], depsData);
        deepStrictEqual(includeList, [{ path: 'app2', providers: ['google'] }]);
        deepStrictEqual(failedTargets, []);
    });

    it('should report failed targets', () => {
        const { includeList, failedTargets } = resolveTargets(['foo'], depsData);
        deepStrictEqual(includeList, []);
        deepStrictEqual(failedTargets, ['foo']);
    });

    it('should deduplicate normalized targets', () => {
        const { includeList, failedTargets } = resolveTargets(['app1', 'app1/', './app1'], depsData);
        deepStrictEqual(includeList, [{ path: 'app1', providers: ['aws'] }]);
        deepStrictEqual(failedTargets, []);
    });

    it('should normalize leading dot slash and trailing slash', () => {
        const { includeList, failedTargets } = resolveTargets(['./app2/'], depsData);
        deepStrictEqual(includeList, [{ path: 'app2', providers: ['google'] }]);
        deepStrictEqual(failedTargets, []);
    });

    it('should preserve first-occurrence order', () => {
        const { includeList, failedTargets } = resolveTargets(['app1', 'app2', 'app1'], depsData);
        deepStrictEqual(includeList, [
            { path: 'app1', providers: ['aws'] },
            { path: 'app2', providers: ['google'] }
        ]);
        deepStrictEqual(failedTargets, []);
    });

    it('should deduplicate failed targets by normalized path', () => {
        const { includeList, failedTargets } = resolveTargets(['foo', 'foo/', 'app1'], depsData);
        deepStrictEqual(includeList, [{ path: 'app1', providers: ['aws'] }]);
        deepStrictEqual(failedTargets, ['foo']);
    });
});

it('rejects invalid graph roots before lookup', () => {
    for (const path of ['', 'env/$(id)', 'env//root', '.github/root']) {
        throws(() => resolveTargets([], { dirs: [{ path }] }), /Invalid root path:/);
    }
});

it('reports invalid normalized targets as validation errors', () => {
    for (const target of ['', './', '../root', './env/$(id)/', 'env/`id`', 'env/日本語', null]) {
        throws(() => resolveTargets([target], { dirs: [] }), /Invalid root path:/);
    }
});
