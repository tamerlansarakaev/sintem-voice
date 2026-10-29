// Settings page: interface language, input microphone and the virtual
// microphone the translation plays into.
const uiLanguageSelect = document.getElementById('ui-language');
const inputMic = document.getElementById('input-mic');
const inputMicHint = document.getElementById('input-mic-hint');
const vmStatus = document.getElementById('vm-status');
const vmHint = document.getElementById('vm-hint');
const vmDevice = document.getElementById('vm-device');
const vmToggle = document.getElementById('vm-toggle');
const vmMix = document.getElementById('vm-mix');

uiLanguageSelect.value = uiLanguage;
uiLanguageSelect.addEventListener('change', () =>
  setUiLanguage(uiLanguageSelect.value),
);

inputMic.addEventListener('change', () =>
  prefs.set('inputMic', inputMic.value || null),
);

vmMix.checked = prefs.get('mixOriginal', false);
vmMix.addEventListener('change', () => prefs.set('mixOriginal', vmMix.checked));

vmToggle.addEventListener('click', async () => {
  if (prefs.get('virtualMic')) {
    prefs.set('virtualMic', null);
  } else {
    const outputs = await listVirtualOutputs();
    const device =
      outputs.find((output) => output.deviceId === vmDevice.value) ?? outputs[0];
    if (!device) return;
    prefs.set('virtualMic', { deviceId: device.deviceId, label: device.label });
  }
  refreshDevices();
});

async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const selected = prefs.get('inputMic') ?? '';
  inputMic.replaceChildren(new Option(t('settings.inputDefault'), ''));
  for (const device of devices) {
    if (device.kind !== 'audioinput' || device.deviceId === 'default') continue;
    // A virtual device's input would loop the translation back in.
    if (VIRTUAL_DEVICE.test(device.label)) continue;
    inputMic.add(new Option(device.label || device.deviceId, device.deviceId));
  }
  inputMic.value = selected;
  if (inputMic.selectedIndex < 0) inputMic.value = '';
}

async function refreshDevices() {
  await listInputs();
  updateAppState({ virtualMic: await findVirtualOutput() });
}

function renderInputLock() {
  inputMic.disabled = appState.recording;
  inputMicHint.textContent = t(
    appState.recording ? 'settings.inputLocked' : 'settings.inputHint',
  );
}

async function renderVirtualMic() {
  const added = prefs.get('virtualMic');
  const device = appState.virtualMic;
  const outputs = added ? [] : await listVirtualOutputs();

  let status;
  let hint = '';
  if (added && device) {
    status = appState.hasVoice ? 'Ready' : 'Added';
    hint = appState.hasVoice ? device.label : t('settings.addedHint');
  } else if (added) {
    status = 'Unavailable';
    hint = t('settings.missingHint', { name: added.label });
  } else if (outputs.length > 0) {
    status = 'NotAdded';
  } else {
    status = 'Unavailable';
    hint = t('settings.unavailableHint');
  }

  vmStatus.textContent = t(`settings.status${status}`);
  vmStatus.dataset.status = status.toLowerCase();
  vmHint.textContent = hint;
  vmHint.hidden = !hint;

  const selected = vmDevice.value;
  vmDevice.replaceChildren(
    ...outputs.map((output) => new Option(output.label, output.deviceId)),
  );
  if (selected) vmDevice.value = selected;
  vmDevice.hidden = outputs.length < 2;

  vmToggle.textContent = t(added ? 'settings.remove' : 'settings.add');
  vmToggle.classList.toggle('danger', Boolean(added));
  vmToggle.disabled = (!added && outputs.length === 0) || appState.recording;
}

document.addEventListener('appstatechange', () => {
  renderInputLock();
  renderVirtualMic();
});
document.addEventListener('uilanguagechange', () => {
  uiLanguageSelect.value = uiLanguage;
  listInputs();
  renderInputLock();
  renderVirtualMic();
});
navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

renderInputLock();
refreshDevices();
