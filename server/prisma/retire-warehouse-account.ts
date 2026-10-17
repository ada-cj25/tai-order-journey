import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 未配置");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function retireWarehouseAccount() {
  const result = await prisma.employee.updateMany({
    where: { username: "warehouse", active: true },
    data: { active: false },
  });

  console.log(`已停用仓库演示账号：${result.count} 个`);
}

retireWarehouseAccount().finally(() => prisma.$disconnect());
