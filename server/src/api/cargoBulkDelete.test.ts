import assert from 'node:assert/strict';
import { buildBulkDeleteWhereForTest } from './cargo.js';

assert.deepEqual(buildBulkDeleteWhereForTest(['a', 'b']), { id: { in: ['a', 'b'] } });
assert.throws(() => buildBulkDeleteWhereForTest([]), /at_least_one_id_required/);
assert.throws(() => buildBulkDeleteWhereForTest(['']), /at_least_one_id_required/);

console.log('cargo bulk delete tests passed');
