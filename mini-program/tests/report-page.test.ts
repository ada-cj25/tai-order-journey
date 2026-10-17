import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
let reportPage: Record<string, any> | undefined;
let navigateBackCount = 0;

(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  getSystemInfoSync: () => ({ platform: "devtools" }),
  showToast: () => undefined,
  showModal: ({ cancelText, confirmText, success, fail }: {
    cancelText?: string;
    confirmText?: string;
    success: (result: { confirm: boolean }) => void;
    fail?: (error: { errMsg: string }) => void;
  }) => {
    if ((cancelText?.length ?? 0) > 4 || (confirmText?.length ?? 0) > 4) {
      fail?.({ errMsg: "showModal:fail button text too long" });
      return;
    }
    success({ confirm: true });
  },
  navigateBack: () => { navigateBackCount += 1; },
};
(globalThis as any).Page = (definition: Record<string, any>) => { reportPage = definition; };

const store = await import("../domain/store.ts");
await import("../pages/report/index.ts");

test("部分报工后留在当前页面，可直接一键补齐剩余面积", async () => {
  assert.ok(reportPage);
  store.setMockSession("TEST-WORKER-PANEL-03");
  const task = store.getMockWorkshopWorkbench().actionable.find((item) => item.productionNumber === "TEST-DEMO-AREA-01")!;
  const page = {
    ...reportPage,
    data: { ...reportPage.data, taskId: task.id },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
  await page.loadTask();
  const partial = Math.floor((Number(task.completedQty) + Number(task.plannedQty)) / 2);
  page.changeQuantity({ detail: { value: String(partial) } });
  await page.submitProgress();
  assert.equal(page.data.task.completedQty, partial);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(navigateBackCount, 0);
  page.confirmComplete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getTask(task.id), undefined);
  assert.equal(store.getMockWorkshopWorkbench().completedToday.some((item) => item.id === task.id), true);
});
