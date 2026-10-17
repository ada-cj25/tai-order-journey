import type { MiniPackageSource } from "./types";

export interface MiniPackageAction {
  orderId: string;
  customerName: string;
  salesNumber: string | null;
  trackingSerial: string;
  productionAreaId: string;
  sourceKey: string;
  kind: MiniPackageSource["kind"];
  label: string;
  actionLabel: string;
  total: number;
}

export interface MiniPackageActionGroup {
  orderId: string;
  customerName: string;
  salesNumber: string | null;
  trackingSerial: string;
  actionCount: number;
  hardwareCount: number;
  hardwareTotal: number;
  manufacturedCount: number;
  outsourcedCount: number;
  sections: Array<{ key: string; label: string; actions: MiniPackageAction[] }>;
}

export function selectPackageActions(actions: MiniPackageAction[], query: string): MiniPackageAction[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return actions;
  return actions.filter((action) => [action.customerName, action.salesNumber ?? "", action.trackingSerial, action.label]
    .some((value) => value.toLocaleLowerCase().includes(keyword)));
}

export function groupPackageActions(actions: MiniPackageAction[]): MiniPackageActionGroup[] {
  const groups = new Map<string, MiniPackageActionGroup>();
  for (const action of actions) {
    let group = groups.get(action.orderId);
    if (!group) {
      group = {
        orderId: action.orderId, customerName: action.customerName, salesNumber: action.salesNumber,
        trackingSerial: action.trackingSerial, actionCount: 0, hardwareCount: 0, hardwareTotal: 0,
        manufacturedCount: 0, outsourcedCount: 0,
        sections: [
          { key: "hardware", label: "五金领用", actions: [] },
          { key: "manufactured", label: "自产包件", actions: [] },
          { key: "outsourced", label: "外购包件", actions: [] },
        ],
      };
      groups.set(action.orderId, group);
    }
    group.actionCount += 1;
    if (action.kind === "HARDWARE_AREA") {
      group.hardwareCount += 1;
      group.hardwareTotal += action.total;
      group.sections[0].actions.push(action);
    } else if (action.kind === "OUTSOURCED_PRODUCT") {
      group.outsourcedCount += 1;
      group.sections[2].actions.push(action);
    } else {
      group.manufacturedCount += 1;
      group.sections[1].actions.push(action);
    }
  }
  return [...groups.values()].map((group) => ({ ...group, sections: group.sections.filter((section) => section.actions.length > 0) }));
}
