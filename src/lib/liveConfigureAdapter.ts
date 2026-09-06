import { notifications } from "@mantine/notifications";

import { commands, type AmpAssignment, type AmpChannel, type AppError, type ChannelConfig, type ChannelConfigSnapshot, type DiscoveredDevice } from "./bindings";
import type { ConfigureActions, ConfigureCapabilities } from "./configureActions";

/** Direct Edit mode has no Project — Speaker/Join planning and manually
 * authored `ohms` are genuinely inapplicable to a live device, not just
 * "not implemented yet" (see `ConfigureActions`'s per-field split). */
export const LIVE_CONFIGURE_CAPABILITIES: ConfigureCapabilities = {
  speakerPlanning: false,
  outputJoin: false,
  ohmsEditable: false,
};

/** Maps one polled `ChannelConfig` onto the shape `AmpConfigureView`'s tabs
 * already expect (`AmpAssignment["channels"][number]`) — most fields are a
 * direct passthrough since `ChannelEq`/`Limiter`/`MatrixCrosspoint`/
 * `ChannelSource` are literally the same Rust types on both sides (see
 * `channel_config.rs`). Fields with no live-wire equivalent (`ohms`,
 * `speakerLibraryId`, `wayIndex`, `joinGroupId`, `outputBridged`) or no
 * read-side parsing yet (`noiseGateThresholdDbu`) get an honest default —
 * never a value implied to be live-accurate. `channelIndex` with no config
 * yet (poll still pending) synthesizes an all-default channel rather than
 * leaving a hole for callers to crash on. */
function mapLiveChannel(config: ChannelConfig | undefined, channelIndex: number): AmpChannel {
  if (!config) {
    return { channelIndex, ohms: 8, speakerLibraryId: null, wayIndex: null };
  }
  return {
    channelIndex: config.channelIndex,
    ohms: 8,
    speakerLibraryId: null,
    wayIndex: null,
    joinGroupId: null,
    source: config.source,
    matrixCrosspoints: config.matrixCrosspoints,
    delayInMs: config.delayInMs ?? 0,
    inputMuted: config.inputMuted,
    outputTrimDb: config.outputTrimDb ?? 0,
    outputVolumeDb: config.outputVolumeDb ?? 0,
    delayOutMs: config.delayOutMs ?? 0,
    inputEq: config.inputEq,
    outputEq: config.outputEq,
    limiter: config.limiter,
    noiseGateEnabled: config.noiseGateEnabled,
    noiseGateThresholdDbu: 0,
    outputPhaseInverted: config.outputPhaseInverted,
    inputName: config.inputName,
    outputName: config.outputName,
    outputMuted: config.outputMuted,
    outputBridged: false,
    powerMode: config.powerMode ?? "lowOhm",
  };
}

/** Synthesizes an `AmpAssignment`-shaped view of a live `DiscoveredDevice`
 * so `AmpConfigureView`'s tabs need no branching between Project and Live
 * sources — same read path either way. */
export function buildLiveAssignmentViewModel(
  device: DiscoveredDevice,
  snapshot: ChannelConfigSnapshot | undefined,
  channelCount: number,
): AmpAssignment {
  const channels: AmpChannel[] = Array.from({ length: channelCount }, (_, i) =>
    mapLiveChannel(snapshot?.channels.find((c) => c.channelIndex === i), i),
  );
  return {
    id: device.id,
    mac: device.mac,
    label: device.name || device.mac,
    ampModelId: null,
    firmwareVersion: device.firmwareVersion,
    channels,
  };
}

/** Surfaces a failed live write as a red notification, the same way
 * `useLivePresets` already reports FC=59 failures.
 *
 * Every command below returns `bindings.ts`'s `typedError` envelope, which
 * resolves with `{ status: "error" }` for an `AppError` rather than
 * rejecting — `AppError` is a plain `{ message }` struct, not an `Error`
 * instance, so it never hits the `throw` branch in `typedError`. A
 * `.catch()` on these calls is therefore dead code: it was silently
 * dropping every backend-side failure (unknown firmware family, device no
 * longer in discovery, unparseable ip, "no FC=27 poll yet to merge this EQ
 * band against"), leaving the user with a control that just snapped back on
 * the next poll and no explanation. This checks `status` instead.
 *
 * `id: label` dedupes rather than stacking: a slider dragged against a
 * device that is failing every write replaces its own toast instead of
 * emitting one per intermediate value. */
async function reportWrite(
  label: string,
  call: Promise<{ status: "ok"; data: null } | { status: "error"; error: AppError }>,
): Promise<void> {
  const result = await call;
  if (result.status === "error") {
    console.error(`${label} failed`, result.error);
    notifications.show({ id: label, color: "red", title: `${label} failed`, message: result.error.message });
  }
}

/** Every write goes straight to the device, fire-and-forget — same
 * convention as `LiveControlView.tsx`'s existing `OutputMuteBar`: the next
 * FC=27 poll (already subscribed via `useLiveChannelConfig`) reflects the
 * change back through the same read path, not this call's return value.
 * "Fire-and-forget" is about the *wire* (no ACK, no retry — see
 * `live/cvr/write.rs`), not about the command result: a write the backend
 * refused to even send is a real error and goes through `reportWrite`. */
export function createLiveConfigureActions(deviceId: string): ConfigureActions {
  return {
    async setChannelDelayIn(channelIndex, delayInMs) {
      await reportWrite("Set input delay", commands.liveControlSetChannelDelayIn(deviceId, channelIndex, delayInMs));
    },
    async setChannelInputMute(channelIndex, muted) {
      await reportWrite("Set input mute", commands.liveControlSetChannelInputMute(deviceId, channelIndex, muted));
    },
    async setChannelOutput(channelIndex, trimDb, volumeDb, delayOutMs) {
      await reportWrite("Set output trim/volume/delay", commands.liveControlSetChannelOutput(deviceId, channelIndex, trimDb, volumeDb, delayOutMs));
    },
    async setChannelPhaseInvert(channelIndex, inverted) {
      await reportWrite("Set phase invert", commands.liveControlSetChannelPhaseInvert(deviceId, channelIndex, inverted));
    },
    async setChannelOutputMute(channelIndex, muted) {
      await reportWrite("Set output mute", commands.liveControlSetOutputMute(deviceId, channelIndex, muted));
    },
    async setChannelPowerMode(channelIndex, mode) {
      await reportWrite("Set power mode", commands.liveControlSetChannelPowerMode(deviceId, channelIndex, mode));
    },
    async setEqBand(channelIndex, direction, bandIndex, patch) {
      await reportWrite("Set EQ band", commands.liveControlSetEqBand(deviceId, channelIndex, direction, bandIndex, patch));
    },
    async setCrossoverSlot(channelIndex, direction, slot, patch) {
      await reportWrite("Set crossover", commands.liveControlSetCrossoverSlot(deviceId, channelIndex, direction, slot, patch));
    },
  };
}
