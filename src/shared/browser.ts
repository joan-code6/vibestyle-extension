type ExtensionApi = typeof chrome & {
  sidebarAction?: { open(): Promise<void> };
};

export const api: ExtensionApi = (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser ?? globalThis.chrome;

export const isFirefox = () => typeof api?.sidebarAction !== 'undefined';
