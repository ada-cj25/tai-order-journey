import { runtime } from "../config/runtime";
import { getMockNotifications, getMockWorkspace, markMockNotificationRead } from "../domain/mock-workspaces";
import type { MiniNotification, MiniWorkspace } from "../domain/types";
import { miniRequest } from "./client";

export function loadRoleWorkspace(): Promise<MiniWorkspace> {
  return runtime.mode === "mock" ? Promise.resolve(getMockWorkspace()) : miniRequest<MiniWorkspace>("/api/v1/mini/workspace");
}

export function loadNotifications(): Promise<MiniNotification[]> {
  return runtime.mode === "mock" ? Promise.resolve(getMockNotifications()) : miniRequest<MiniNotification[]>("/api/v1/mini/notifications");
}

export function markNotificationRead(id: string): Promise<void> {
  if (runtime.mode === "mock") {
    try { markMockNotificationRead(id); return Promise.resolve(); }
    catch (error) { return Promise.reject(error); }
  }
  return miniRequest(`/api/v1/mini/notifications/${id}/read`, { method: "POST" }).then(() => undefined);
}
