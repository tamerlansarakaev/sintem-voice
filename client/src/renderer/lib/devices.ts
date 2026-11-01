// The name the virtual microphone driver gives its device. Chromium may
// append the transport type, e.g. " (Virtual)", so labels are matched by
// prefix.
const VIRTUAL_MIC_NAME = 'Sintem Voice (Virtual Mic)';

const isVirtualMic = (device: MediaDeviceInfo) =>
  device.label.startsWith(VIRTUAL_MIC_NAME);

// The driver exists only for macOS.
export const VIRTUAL_MIC_SUPPORTED = window.config.platform === 'darwin';

export interface Devices {
  // Microphones to speak into; the virtual microphone's input would loop
  // the translation back in.
  inputs: MediaDeviceInfo[];
  // The output side of the installed virtual microphone: whatever plays
  // into it becomes the microphone's input. null when the driver is not
  // installed.
  virtualMic: MediaDeviceInfo | null;
}

export async function listDevices(): Promise<Devices> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.deviceId !== 'default',
  );
  return {
    inputs: devices.filter(
      (device) => device.kind === 'audioinput' && !isVirtualMic(device),
    ),
    virtualMic:
      devices.find(
        (device) => device.kind === 'audiooutput' && isVirtualMic(device),
      ) ?? null,
  };
}
