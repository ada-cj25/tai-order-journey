import type { MiniShipment } from "./types";

export interface MockShipmentState {
  routeBatches: Record<string, { count: number; final: boolean }>;
  shippedOutsourceIds: string[];
  shipments: MiniShipment[];
  installationReports: Array<{ shipmentId: string; type: "COMPLETE" | "PARTIAL" | "ISSUE"; reportedOn: string; note: string; photoPaths: string[]; transportCost: number | null; recordedAt: string }>;
  acceptance?: { acceptedAt: string; conclusion: string; signaturePath: string; recordedAt: string };
}

const key = (orderId: string) => `tai-mini-shipment-state:${orderId}`;

export function getMockShipmentState(orderId: string): MockShipmentState {
  const saved = wx.getStorageSync<MockShipmentState>(key(orderId));
  return saved && typeof saved === "object" ? { routeBatches: saved.routeBatches ?? {}, shippedOutsourceIds: saved.shippedOutsourceIds ?? [], shipments: saved.shipments ?? [], installationReports: saved.installationReports ?? [], acceptance: saved.acceptance } : { routeBatches: {}, shippedOutsourceIds: [], shipments: [], installationReports: [] };
}

export function saveMockShipmentState(orderId: string, state: MockShipmentState): void {
  wx.setStorageSync(key(orderId), state);
}
