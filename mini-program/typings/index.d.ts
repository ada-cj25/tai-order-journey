type MiniInstance<T extends Record<string, unknown>> = T & {
  data: Record<string, any>;
  setData(data: Record<string, unknown>): void;
};

declare function App<T extends Record<string, unknown>>(options: T & ThisType<MiniInstance<T>>): void;
declare function Page<T extends Record<string, unknown>>(options: T & ThisType<MiniInstance<T>>): void;
declare function Component<T extends Record<string, unknown>>(options: T & ThisType<MiniInstance<T>>): void;
declare function getCurrentPages(): Array<{ route: string }>;

declare const wx: {
  getStorageSync<T = unknown>(key: string): T;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): { keys: string[] };
  getSystemInfoSync(): { platform: string };
  login(options: { success?: (result: { code: string }) => void; fail?: () => void }): void;
  navigateTo(options: { url: string }): void;
  redirectTo(options: { url: string }): void;
  reLaunch(options: { url: string }): void;
  navigateBack(options?: { delta?: number }): void;
  showToast(options: { title: string; icon?: "success" | "error" | "none"; duration?: number }): void;
  showModal(options: { title: string; content: string; confirmText?: string; cancelText?: string; showCancel?: boolean; success?: (result: { confirm: boolean; cancel: boolean }) => void; fail?: (error: { errMsg: string }) => void }): void;
  scanCode(options: { onlyFromCamera?: boolean; success?: (result: { result: string }) => void; fail?: () => void }): void;
  chooseMedia(options: { count?: number; mediaType?: string[]; sourceType?: string[]; success?: (result: { tempFiles: Array<{ tempFilePath: string; size: number }> }) => void }): void;
  chooseMessageFile(options: { count: number; type: "all" | "file" | "image" | "video"; success?: (result: { tempFiles: Array<{ path: string; name: string; size: number; type: string }> }) => void; fail?: () => void }): void;
  saveFile(options: { tempFilePath: string; success?: (result: { savedFilePath: string }) => void; fail?: () => void }): void;
  showActionSheet(options: { itemList: string[]; success?: (result: { tapIndex: number }) => void; fail?: () => void }): void;
  stopPullDownRefresh(): void;
  uploadFile(options: Record<string, unknown>): void;
  request(options: Record<string, unknown>): void;
  setClipboardData(options: { data: string; success?: () => void }): void;
  downloadFile(options: Record<string, unknown>): void;
  openDocument(options: Record<string, unknown>): void;
  previewImage(options: { urls: string[]; current?: string }): void;
};
