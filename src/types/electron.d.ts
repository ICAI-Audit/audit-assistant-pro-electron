export {};

declare global {
  interface ElectronAppAPI {
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
