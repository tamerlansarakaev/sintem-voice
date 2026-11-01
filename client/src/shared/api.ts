export const IPC = {
  subtitlesOpen: 'subtitles:open',
  subtitlesClosed: 'subtitles:closed',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  backendUrl: 'config:backend-url',
  voiceLoad: 'voice:load',
  voiceSave: 'voice:save',
  virtualMicInstall: 'virtual-mic:install',
  virtualMicUninstall: 'virtual-mic:uninstall',
} as const;

// The voice sample: the text read aloud and a base64 16-bit mono WAV.
export interface VoiceSample {
  text: string;
  wav: string;
}

export interface ConfigApi {
  getBackendUrl(): Promise<string>;
  platform: NodeJS.Platform;
}

export interface VoiceApi {
  load(): Promise<VoiceSample | null>;
  save(voice: VoiceSample): Promise<void>;
}

// Installs or removes the virtual microphone driver; both ask for the
// administrator password and reject when it is refused.
export interface VirtualMicApi {
  install(): Promise<void>;
  uninstall(): Promise<void>;
}

export interface SubtitlesApi {
  open(): void;
  // Returns a function that removes the listener.
  onClosed(callback: () => void): () => void;
}

export interface WindowControlsApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

export interface ExposedApi {
  config: ConfigApi;
  voice: VoiceApi;
  virtualMic: VirtualMicApi;
  subtitles: SubtitlesApi;
  windowControls: WindowControlsApi;
}
