// The name the virtual microphone driver gives its device. Chromium may
// append the transport type, e.g. " (Virtual)", so labels are matched by
// prefix.
const VIRTUAL_MIC_NAME = 'Sintem Voice (Virtual Mic)';

const isVirtualMic = (device: MediaDeviceInfo) =>
  device.label.startsWith(VIRTUAL_MIC_NAME);

// The driver exists only for macOS.
export const VIRTUAL_MIC_SUPPORTED = window.config.platform === 'darwin';

// Microphones to speak into; the virtual microphone's input would loop the
// translation back in.
export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId !== 'default' &&
      !isVirtualMic(device),
  );
}

// The output side of the installed virtual microphone: whatever plays into
// it becomes the microphone's input. null when the driver is not installed.
export async function findVirtualOutput() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return (
    devices.find(
      (device) =>
        device.kind === 'audiooutput' &&
        device.deviceId !== 'default' &&
        isVirtualMic(device),
    ) ?? null
  );
}
