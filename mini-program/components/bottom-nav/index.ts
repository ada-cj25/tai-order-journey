import { roleWorkspace } from "../../domain/roles";
import { getStoredSession } from "../../domain/store";
import type { NavigationItem } from "../../domain/types";

Component({
  properties: { active: { type: String, value: "tracking" }, allowActiveNavigation: { type: Boolean, value: false } },
  data: { items: [] as NavigationItem[], showFloatingScan: false },
  lifetimes: {
    attached() {
      const employee = getStoredSession();
      const config = employee ? roleWorkspace(employee.role, employee.level) : null;
      this.setData({ items: config?.navigationItems ?? [], showFloatingScan: employee?.role === "WORKSHOP" });
    },
  },
  methods: {
    navigate(event: { currentTarget: { dataset: { key: string; route: string } } }) {
      const { key, route } = event.currentTarget.dataset;
      if (key === this.data.active && !this.data.allowActiveNavigation) return;
      if (key === "sales-create") { wx.navigateTo({ url: route }); return; }
      wx.redirectTo({ url: route });
    },
    openScan() {
      if (this.data.active === "scan") return;
      wx.redirectTo({ url: "/pages/scan/index" });
    }
  }
});
