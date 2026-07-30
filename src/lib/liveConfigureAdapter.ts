import { commands, type AmpAssignment, type AmpChannel, type ChannelConfig, type ChannelConfigSnapshot, type DiscoveredDevice } from "./bindings";
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

/** Every write goes straight to the device, fire-and-forget — same
 * convention as `LiveControlView.tsx`'s existing `OutputMuteBar`: the next
 * FC=27 poll (already subscribed via `useLiveChannelConfig`) reflects the
 * change back through the same read path, not this call's return value. */
export function createLiveConfigureActions(deviceId: string): ConfigureActions {
  return {
    async setChannelDelayIn(channelIndex, delayInMs) {
      await commands.liveControlSetChannelDelayIn(deviceId, channelIndex, delayInMs).catch((e) => {
        console.error("liveControlSetChannelDelayIn failed", e);
      });
    },
    async setChannelInputMute(channelIndex, muted) {
      await commands.liveControlSetChannelInputMute(deviceId, channelIndex, muted).catch((e) => {
        console.error("liveControlSetChannelInputMute failed", e);
      });
    },
    async setChannelOutput(channelIndex, trimDb, volumeDb, delayOutMs) {
      await commands.liveControlSetChannelOutput(deviceId, channelIndex, trimDb, volumeDb, delayOutMs).catch((e) => {
        console.error("liveControlSetChannelOutput failed", e);
      });
    },
    async setChannelPhaseInvert(channelIndex, inverted) {
      await commands.liveControlSetChannelPhaseInvert(deviceId, channelIndex, inverted).catch((e) => {
        console.error("liveControlSetChannelPhaseInvert failed", e);
      });
    },
    async setChannelOutputMute(channelIndex, muted) {
      await commands.liveControlSetOutputMute(deviceId, channelIndex, muted).catch((e) => {
        console.error("liveControlSetOutputMute failed", e);
      });
    },
    async setChannelPowerMode(channelIndex, mode) {
      await commands.liveControlSetChannelPowerMode(deviceId, channelIndex, mode).catch((e) => {
        console.error("liveControlSetChannelPowerMode failed", e);
      });
    },
    async setEqBand(channelIndex, direction, bandIndex, patch) {
      await commands.liveControlSetEqBand(deviceId, channelIndex, direction, bandIndex, patch).catch((e) => {
        console.error("liveControlSetEqBand failed", e);
      });
    },
    async setCrossoverSlot(channelIndex, direction, slot, patch) {
      await commands.liveControlSetCrossoverSlot(deviceId, channelIndex, direction, slot, patch).catch((e) => {
        console.error("liveControlSetCrossoverSlot failed", e);
      });
    },
  };
}
