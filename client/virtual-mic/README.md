# Virtual microphone

Core Audio driver that adds the `Sintem Voice (Virtual Mic)` device. The
client plays the translated speech into its output, and call apps such as
Zoom or Meet pick it up as a microphone.

## Origin

Based on Apple's sample
[Creating an Audio Server Driver Plug-in](https://developer.apple.com/documentation/coreaudio/creating-an-audio-server-driver-plug-in)
(NullAudio), MIT license, see [LICENSE.txt](LICENSE.txt).

Changed for this project during the hackathon:

- **Loopback.** In the sample the input stream gives silence and output
  is discarded. Here output is written to a ring buffer and read back by
  the input stream, which turns the device into a microphone fed by the
  app.
- **Identity.** Own bundle id `com.sintem-voice.virtualmic`, device and
  box UIDs, device name and manufacturer, so it does not clash with other
  NullAudio based drivers.

Installing and removing the driver from the app is done by the client,
see [`src/main.ts`](../src/main.ts).

## Build

From `client/`:

```bash
npm run driver:build
```

The bundle is written to `virtual-mic/build/Release/`. Install it from the
app's Settings: it copies the bundle to `/Library/Audio/Plug-Ins/HAL`
behind the system password prompt and restarts `coreaudiod`, no reboot
needed.
