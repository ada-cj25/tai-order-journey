import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccount } from '../account-policy.js';
import { orderScope } from '../order-access.js';
import { salesBusinessTypes, salesRoleLabel } from './sales-policy.js';
import { LOCAL_SALES } from './local-sales-roster.js';

test('sales units are canonical, unknown assignments fail closed, and UI labels distinguish hierarchy', () => {
  const base = { employeeNo: 'S1', username: 'test-sales', name: '测试', department: '测试', role: 'SALES' };
  for (const value of [null, '', '诺尔丽', 'UNKNOWN', 'constructor']) {
    assert.deepEqual(salesBusinessTypes(value), []);
    assert.throws(() => validateAccount({ ...base, businessUnit: value }));
    assert.deepEqual(orderScope({ id: 'mine', role: 'SALES', businessUnit: value, level: 'SUPERVISOR', workshop: null }), { businessType: { in: [] }, creationMode: 'SALES_STANDARD' });
  }
  assert.equal(validateAccount({ ...base, businessUnit: 'AIKEJU' }).businessUnit, 'AIKEJU');
  assert.equal(salesRoleLabel({ businessUnit: 'AIKEJU', level: 'SUPERVISOR' }), '艾可居销售主管');
  assert.equal(salesRoleLabel({ businessUnit: 'NOERLI', level: 'STAFF' }), '诺尔丽销售员');
  for (const unit of ['NOERLI', 'AIKEJU']) assert.equal(LOCAL_SALES.filter(s => s.businessUnit === unit && s.level === 'STAFF').length, 2);
  assert.equal(new Set(LOCAL_SALES.map(s => s.username)).size, 4);
});
