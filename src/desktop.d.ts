import type { UpdateStatus } from './updates';

export type DesktopNotificationStatus = {
  supported: boolean;
  enabled: boolean;
  background: boolean;
};

declare global {
  interface Window {
    galinkaDesktop?: {
      status: () => Promise<UpdateStatus>;
      check: () => Promise<UpdateStatus>;
      download: () => Promise<UpdateStatus>;
      install: () => Promise<boolean>;
      releases: () => Promise<void>;
      setAutoDownload: (enabled: boolean) => Promise<UpdateStatus>;
      onStatus: (callback: (status: UpdateStatus) => void) => () => void;
      notifications: {
        status: () => Promise<DesktopNotificationStatus>;
        setEnabled: (enabled: boolean) => Promise<DesktopNotificationStatus>;
        show: (options: { chatId: string }) => Promise<boolean>;
        clear: () => Promise<void>;
        onOpen: (callback: (chatId: string) => void) => () => void;
      };
    };
  }
}
