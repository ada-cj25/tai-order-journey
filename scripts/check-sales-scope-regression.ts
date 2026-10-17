import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../server/prisma.service.js';
import { MaterialPackageService } from '../server/material-package.service.js';
import { OrdersService } from '../server/orders.service.js';
import { NotificationsController, TasksController } from '../server/operations.controller.js';
import { requireAttachment } from '../server/order-access.js';
import { localTestAccountsEnabled } from '../server/runtime-config.js';

if (!localTestAccountsEnabled()) throw new Error('仅允许本地非生产数据库，所有测试数据都会回滚');
const db = new PrismaService();
const rollback = new Error('ROLLBACK_SALES_REGRESSION');
try {
  await db.$transaction(async (tx) => {
    const prefix = `scope-${randomUUID()}`;
    const users: Record<string, any> = {};
    for (const unit of ['NOERLI', 'AIKEJU']) for (const suffix of ['1', '2', 'mgr']) {
      const name = `${unit}-${suffix}`;
      users[name] = await tx.employee.create({ data: { employeeNo: `${prefix}-${name}`, username: `${prefix}-${name}`, name, department: unit, businessUnit: unit, role: 'SALES', level: suffix === 'mgr' ? 'SUPERVISOR' : 'STAFF', passwordHash: 'test-only-no-login' } });
    }
    const now = new Date();
    const records: any[] = [];
    for (const unit of ['NOERLI', 'AIKEJU']) for (const suffix of ['1', '2']) {
      const record = await tx.order.create({ data: { trackingSerial: `${prefix}-${unit}-${suffix}`, businessType: `${unit}_FORMAL` as never, siteType: 'FINISHED', customerName: prefix, customerPhone: '00000000000', address: '隔离回滚测试', amount: 1, signedAt: now, standardDueAt: now, promisedAt: now, internalDueAt: now, currentOwnerLabel: '销售', nextAction: '测试', salesId: users[`${unit}-${suffix}`].id } });
      records.push(record);
    }
    // Reproduce the screenshot: an Aikeju order attached to a Noerli salesperson.
    const wrong = await tx.order.create({ data: { ...records[0], id: randomUUID(), trackingSerial: `${prefix}-legacy-wrong`, businessType: 'AIKEJU_FORMAL' } });
    records.push(wrong);
    for (const record of records) {
      await tx.task.create({ data: { orderId: record.id, ownerId: record.salesId, department: record.businessType.startsWith('NOERLI_') ? 'NOERLI' : 'AIKEJU', title: prefix, dueAt: now, reminderAt: now, uniqueKey: `${record.id}:SALES_SCOPE` } });
      for (const user of Object.values(users)) await tx.notification.create({ data: { employeeId: user.id, uniqueKey: `${record.id}:SALES_SCOPE:OVERDUE:${user.id}`, level: 'WARNING', title: prefix, body: '权限测试通知' } });
    }
    const serviceDb = new Proxy(tx, { get(target, key) { if (key === '$transaction') return (operation: any) => typeof operation === 'function' ? operation(tx) : Promise.all(operation); return Reflect.get(target, key); } });
    const service = new OrdersService(serviceDb as never, {} as never, {} as never, new MaterialPackageService(serviceDb as never, {} as never, {} as never));
    for (const unit of ['NOERLI', 'AIKEJU']) for (const suffix of ['mgr', '1', '2']) {
      const user = users[`${unit}-${suffix}`];
      const expected = records.filter(o => o.businessType === `${unit}_FORMAL` && (suffix === 'mgr' || o.salesId === user.id));
      const visible = await service.list(user, { search: prefix, pageSize: '100' });
      assert.deepEqual(visible.items.map(o => o.id).sort(), expected.map(o => o.id).sort(), `${unit}-${suffix} 列表品牌/人员隔离`);
      for (const record of records) {
        if (expected.some(o => o.id === record.id)) assert.equal((await service.detail(record.id, user)).id, record.id);
        else {
          await assert.rejects(service.detail(record.id, user), /无权查看/);
          await assert.rejects(service.saveDraft(record.id, 'REPORT_DEPOSIT', user, {}), /无权处理/);
          await assert.rejects(service.command(record.id, 'REPORT_DEPOSIT', user, {}), /无权处理/);
          const attachment = await tx.attachment.create({ data: { orderId: record.id, category: 'DESIGN_CAD', originalName: 'test.pdf', storageKey: `${prefix}-${randomUUID()}`, mimeType: 'application/pdf', size: 1, uploadedBy: record.salesId } });
          await assert.rejects(requireAttachment(tx, attachment.id, user), /无权访问/);
        }
      }
      const request = { session: { employeeId: user.id, sessionVersion: 0 } } as never;
      const tasks = await new TasksController(serviceDb as never).list(request, suffix === 'mgr' ? 'department' : 'mine');
      assert.ok(tasks.every(task => expected.some(o => o.id === task.orderId)), '待办不得暴露范围外订单');
      const notifications = await new NotificationsController(serviceDb as never).list(request);
      assert.equal(notifications.length, expected.length, '通知按订单范围过滤，历史错误归属通知不能泄漏');
      assert.ok(notifications.every(n => expected.some(o => n.uniqueKey.startsWith(`${o.id}:`))));
      const sameBrand = await service.create({ businessType: `${unit}_FORMAL`, siteType: 'FINISHED', customerName: '成功建单校验', customerPhone: '00000000000', address: '自动回滚', amount: 1, signedAt: now.toISOString(), promisedAt: now.toISOString() } as never, user);
      assert.equal(sameBrand.salesId, user.id);
      assert.equal(sameBrand.businessType, `${unit}_FORMAL`);
      const supplement = await service.create({ businessType: `${unit}_SUPPLEMENT`, parentOrderId: sameBrand.id, amount: 0, signedAt: now.toISOString(), promisedAt: now.toISOString(), supplementType: 'CUSTOMER_ADDITION', responsibilityType: 'CUSTOMER_PAID', supplementReason: '自动回滚测试' } as never, user);
      assert.equal(supplement.salesId, user.id);
      assert.equal(supplement.parentOrderId, sameBrand.id);
      const otherUnit = unit === 'NOERLI' ? 'AIKEJU' : 'NOERLI';
      for (const kind of ['FORMAL', 'SUPPLEMENT']) await assert.rejects(service.create({ businessType: `${otherUnit}_${kind}` } as never, user), /只能创建所属品牌/);
      if (suffix === 'mgr') await assert.rejects(service.saveDraft(expected[0].id, 'REPORT_DEPOSIT', user, {}), /所属销售/);
      console.log(`PASS ${unit}-${suffix}: 列表、详情、附件、草稿、跨品牌建单`);
    }
    throw rollback;
  }, { timeout: 30_000 });
} catch (error) { if (error !== rollback) throw error; }
finally { await db.$disconnect(); }
console.log('销售权限回归通过；测试数据已全部回滚');
