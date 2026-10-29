import { getPref } from './prefs';

// Virtual audio drivers expose an output device whatever plays into it
// becomes the input of a matching microphone.
export const VIRTUAL_DEVICE =
  /blackhole|vb-?audio|cable input|voicemeeter|loopback|soundflower|virtual/i;

export async function listVirtualOutputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) =>
      device.kind === 'audiooutput' &&
      device.deviceId !== 'default' &&
      VIRTUAL_DEVICE.test(device.label),
  );
}

// Microphones to speak into; a virtual device's input would loop the
// translation back in.
export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId !== 'default' &&
      !VIRTUAL_DEVICE.test(device.label),
  );
}

// The added virtual microphone, matched by id and then by name because
// ids can change between launches. null when not added or not connected.
export async function findVirtualOutput() {
  const added = getPref('virtualMic');
  if (!added) return null;
  const outputs = await listVirtualOutputs();
  return (
    outputs.find((device) => device.deviceId === added.deviceId) ??
    outputs.find((device) => device.label === added.label) ??
    null
  );
}
