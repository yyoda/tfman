import { describe, it } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { resolveTargets } from '../../scripts/lib/ops/target-selector.mjs';

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
});
