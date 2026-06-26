export {};

declare global {
  interface ElectronAppAPI {
    getDownloadsPath: () => Promise<string>;
    openPath: (targetPath: string) => Promise<string>;
    exportFile: (payload: {
      defaultFilename: string;
      buffer: ArrayBuffer;
      mimeType?: string;
      showSaveDialog?: boolean;
    }) => Promise<string | null>;
  }

  interface Window {
    electronAPI?: {
      platform: string;
      app?: ElectronAppAPI;
    };
  }
}
