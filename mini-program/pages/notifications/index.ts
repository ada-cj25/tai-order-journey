import { requireSession } from "../../domain/roles";
import type { MiniNotification } from "../../domain/types";
import { loadNotifications, markNotificationRead } from "../../services/workspace";

Page({
  data: { items: [] as MiniNotification[], loading: true },
  onLoad() { requireSession(); },
  async onShow() { try { this.setData({ items: await loadNotifications(), loading: false }); } catch (error) { this.setData({ loading: false }); wx.showToast({ title: error instanceof Error ? error.message : "消息加载失败", icon: "none" }); } },
  async markRead(event: { currentTarget: { dataset: { id: string } } }) {
    const id = event.currentTarget.dataset.id;
    try { await markNotificationRead(id); this.setData({ items: this.data.items.map((item: MiniNotification) => item.id === id ? { ...item, read: true } : item) }); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "标记失败", icon: "none" }); }
  },
  back() { wx.navigateBack(); },
});
