import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaService } from '../server/prisma.service.js';
import { LOCAL_SALES } from '../server/domain/local-sales-roster.js';
import { localTestAccountsEnabled } from '../server/runtime-config.js';

if (!localTestAccountsEnabled()) throw new Error('销售测试账号只能初始化到 localhost 非生产数据库');
const apply = process.argv.includes('--apply');
const db = new PrismaService();
try {
  const passwordHash = apply ? await hash('erp123456', 12) : '';
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    const results: unknown[] = [];
    const employees = new Map<string, { id: string; department: string }>();
    for (const item of LOCAL_SALES) {
      const supervisor = await tx.employee.findUnique({ where: { username: item.supervisor } });
      if (!supervisor || supervisor.role !== 'SALES' || supervisor.level !== 'SUPERVISOR' || supervisor.businessUnit !== item.businessUnit) throw new Error(`${item.supervisor} 主管配置不符；未更改现有账号`);
      const { supervisor: manager, ...input } = item;
      const existing = await tx.employee.findFirst({ where: { OR: [{ username: item.username }, { employeeNo: item.employeeNo }] } });
      if (existing && (existing.username !== item.username || existing.employeeNo !== item.employeeNo || existing.role !== 'SALES' || existing.level !== 'STAFF' || existing.businessUnit !== item.businessUnit)) throw new Error(`${item.username} 与已有账号冲突，未覆盖`);
      let employee = existing;
      if (!employee && apply) {
        employee = await tx.employee.create({ data: { ...input, passwordHash, mustChangePassword: false } });
        await tx.securityAudit.create({ data: { targetId: employee.id, action: 'LOCAL_SALES_CREATED', metadata: { username: item.username, businessUnit: item.businessUnit, supervisor: manager, source: 'local-sales-20260831' } } });
      }
      results.push({ username: item.username, supervisor: manager, status: existing ? '保留已有账号、密码及启用状态' : apply ? '已创建' : '将创建' });
      if (employee) employees.set(item.username, employee);
      const trackingSerial = `TEST-SALES-${item.businessUnit}-${item.employeeNo}`;
      const sample = await tx.order.findUnique({ where: { trackingSerial } });
      if (sample && employee && (sample.salesId !== employee.id || sample.businessType !== `${item.businessUnit}_FORMAL`)) throw new Error(`${trackingSerial} 归属已变化，未覆盖`);
      if (!sample && apply && employee) {
        const order = await tx.order.create({ data: {
          trackingSerial, businessType: `${item.businessUnit}_FORMAL` as never, siteType: 'FINISHED',
          customerName: `权限测试 · ${item.name}`, customerPhone: '00000000000', address: '仅供本地权限测试，无真实客户', amount: 1000,
          signedAt: new Date('2026-08-31T10:00:00+08:00'), standardDueAt: new Date('2026-09-30T17:00:00+08:00'), promisedAt: new Date('2026-09-30T17:00:00+08:00'), internalDueAt: new Date('2026-09-30T17:00:00+08:00'),
          currentOwnerLabel: item.name, nextAction: '报备定金收款信息', salesId: employee.id,
          events: { create: { actorId: employee.id, type: 'LOCAL_SALES_TEST_CREATED', title: '本地销售权限测试订单', description: '验证主管查看本品牌、销售员只查看本人订单；无真实合同或付款。', toStage: 'DEPOSIT_PENDING' } },
        } });
        await tx.securityAudit.create({ data: { targetId: order.id, action: 'LOCAL_SALES_SAMPLE_CREATED', metadata: { trackingSerial, salesId: employee.id } } });
      }
      results.push({ trackingSerial, status: sample ? '保留现有订单和后续测试进度' : apply ? '已创建测试订单' : '将创建测试订单' });
    }
    // Only repair the known old local demo sales identities; never run a broad seed.
    const wrongOrders = await tx.order.findMany({ where: { businessType: { in: ['AIKEJU_FORMAL', 'AIKEJU_SUPPLEMENT'] }, sales: { username: { in: ['sales', 'sales2'] }, role: 'SALES', businessUnit: 'NOERLI' } }, include: { sales: { select: { username: true } } } });
    for (const order of wrongOrders) {
      const username = order.sales.username === 'sales' ? 'aikejusales1' : 'aikejusales2';
      const target = employees.get(username);
      results.push({ trackingSerial: order.trackingSerial, from: order.sales.username, to: username, status: apply ? '已纠正跨品牌归属' : '将纠正跨品牌归属' });
      if (apply && target) {
        if (order.parentOrderId) {
          const parent = await tx.order.findUniqueOrThrow({ where: { id: order.parentOrderId } });
          if (parent.salesId !== target.id && parent.salesId !== order.salesId) throw new Error('父子单归属不一致，停止修复');
        }
        const changed = await tx.order.updateMany({ where: { id: order.id, salesId: order.salesId, updatedAt: order.updatedAt }, data: { salesId: target.id } });
        if (changed.count !== 1) throw new Error('订单在修复时发生变化，请重新核对');
        await tx.task.updateMany({ where: { orderId: order.id, ownerId: order.salesId, status: { in: ['PENDING', 'OVERDUE'] } }, data: { ownerId: target.id, department: target.department } });
        const metadata = { oldSalesId: order.salesId, newSalesId: target.id, businessType: order.businessType, source: 'local-sales-20260831' };
        await tx.orderEvent.create({ data: { orderId: order.id, type: 'SALES_BRAND_CORRECTED', title: '纠正本地测试订单销售归属', description: '艾可居订单从旧诺尔丽测试账号归入艾可居销售员；保留原编号、业务进度、附件、草稿及历史操作。', metadata } });
        await tx.securityAudit.create({ data: { targetId: order.id, action: 'LOCAL_SALES_BRAND_CORRECTED', metadata } });
      }
    }
    return results;
  }, { timeout: 30_000 });
  console.log(JSON.stringify({ mode: apply ? '已应用' : '预览；加 --apply 才会写入', results: result }, null, 2));
} finally { await db.$disconnect(); }
