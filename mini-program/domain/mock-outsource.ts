type MockArrival = { id: string; quantity: number; arrivedOn: string };
type MockLine = { id: string; name: string; usageArea: string; unit: string; plannedQty: number; initialArrivals: MockArrival[] };

const mockLinesByOrder: Record<string, MockLine[]> = {
  "TEST-DEMO-LIN-ORDER-002": [
    { id: "mock-lin-countertop", name: "台面", usageArea: "整单", unit: "件", plannedQty: 2,
      initialArrivals: [{ id: "mock-lin-arrival-1", quantity: 1, arrivedOn: "2026-09-12" }] },
  ],
  "TEST-DEMO-ZHOU-ORDER-001": [
    { id: "outsource-countertop", name: "岩板台面", usageArea: "卫生间", unit: "件", plannedQty: 1,
      initialArrivals: [{ id: "mock-zhou-arrival-1", quantity: 1, arrivedOn: "2026-09-12" }] },
    { id: "outsource-mirror", name: "智能镜", usageArea: "卫生间", unit: "件", plannedQty: 1, initialArrivals: [] },
  ],
};

export const mockArrivalKey = (orderId: string, lineId: string) => orderId === "TEST-DEMO-LIN-ORDER-002"
  ? `tai-mini-outsource-arrivals:${orderId}`
  : `tai-mini-outsource-arrivals:${orderId}:${lineId}`;

export function getMockOutsourceLines(orderId: string) {
  return (mockLinesByOrder[orderId] ?? []).map((line) => {
    const stored = wx.getStorageSync<MockArrival[]>(mockArrivalKey(orderId, line.id));
    const arrivals = Array.isArray(stored) ? stored : line.initialArrivals;
    const arrivedQty = arrivals.reduce((sum, row) => sum + row.quantity, 0);
    return { id: line.id, name: line.name, usageArea: line.usageArea, note: null, unit: line.unit, plannedQty: line.plannedQty,
      arrivedQty, remainingQty: Math.max(0, line.plannedQty - arrivedQty), shipped: false, arrivals };
  });
}
