import { notifications } from "@mantine/notifications";

import {
  commands,
  type AmpAssignment,
  type AmpChannel,
  type AppError,
  type ChannelConfig,
  type ChannelConfigSnapshot,
  type DeviceBridgeSnapshot,
  type DiscoveredDevice,
  type LiveWriteAck,
} from "./bindings";
import type { ConfigureActions, ConfigureCapabilities } from "./configureActions";
import { showRollingNotification } from "./rollingNotification";

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
function mapLiveChannel(config: ChannelConfig | undefined, channelIndex: number, bridged: boolean): AmpChannel {
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
    // Real device state, from the FC=50 poll. Both channels of a pair report
    // the pair's single flag — the wire has one byte per pair, not per
    // channel.
    outputBridged: bridged,
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
  bridge?: DeviceBridgeSnapshot,
): AmpAssignment {
  // Bridge state comes from the FC=50 poll, not the FC=27 snapshot — see
  // `live/cvr/bridge.rs`. Indexed by pair, so channels 0/1 both read pair 0
  // and channels 2/3 both read pair 1, matching the vendor's own mapping
  // (`bridges[0]` = out 1, `bridges[1]` = out 3). A pair the device has not
  // answered for yet is `null`, which reads as not bridged here.
  const channels: AmpChannel[] = Array.from({ length: channelCount }, (_, i) =>
    mapLiveChannel(
      snapshot?.channels.find((c) => c.channelIndex === i),
      i,
      bridge?.bridged?.[Math.floor(i / 2)] ?? false,
    ),
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
 * Failures deliberately carry **no `id`**, so they stack, and
 * `autoClose: false`, so they persist until dismissed. A failed write means
 * the device did not take the value — losing that behind a newer toast is
 * the one outcome that must not happen silently. `<Notifications limit>` in
 * `main.tsx` caps how many pile up.
 *
 * The burst protection that the old `id` provided now lives where it belongs:
 * `notifySuccess` stays silent for coalesced writes, and the backend collapses
 * repeated writes to one parameter before they ever reach the wire (see
 * `WriteRegistry::submit`), so a drag no longer generates a toast per
 * intermediate value in the first place. */
async function reportWrite(
  label: string,
  call: Promise<{ status: "ok"; data: LiveWriteAck } | { status: "error"; error: AppError }>,
): Promise<void> {
  const result = await call;
  if (result.status === "error") {
    console.error(`${label} failed`, result.error);
    notifications.show({
      color: "red",
      title: `${label} failed`,
      message: result.error.message,
      autoClose: false,
    });
    return;
  }
  notifySuccess(label, result.data);
}

/** Green counterpart to the red failure toast: confirms the device actually
 * acknowledged the write, which is the whole point of the ACK path (see
 * `live/cvr/request.rs`'s `WriteRegistry`).
 *
 * Mirror image of the failure toast on purpose. Successes roll — a stream of
 * writes to one control shows a single confirmation that replaces itself
 * rather than a stack — and auto-close quickly. A success is reassurance;
 * missing one costs nothing, whereas missing a failure costs a wrong value on
 * the amp.
 *
 * Rolling goes through `showRollingNotification` rather than a stable `id`,
 * because `notifications.show()` silently *ignores* a repeated id instead of
 * replacing it — see that helper's doc for the two Mantine behaviours involved.
 *
 * Two deliberate silences:
 * - a command whose packets were *all* coalesced never reached the wire; the
 *   newer write that superseded it reports instead, so toasting here would
 *   double-count a single user action; and
 * - `attempts` is only spelled out when it exceeds 1, since needing refires
 *   is the notable case — "1/6" on every write is noise. */
function notifySuccess(label: string, ack: LiveWriteAck): void {
  if (ack.packets > 0 && ack.coalesced === ack.packets) return;

  const sent = ack.packets - ack.coalesced;
  const parts = [`${sent} packet${sent === 1 ? "" : "s"} in ${ack.elapsedMs} ms`];
  if (ack.attempts > 1) parts.push(`${ack.attempts} attempts`);
  if (ack.coalesced > 0) parts.push(`${ack.coalesced} coalesced`);

  showRollingNotification(label, {
    color: "green",
    title: `${label} confirmed`,
    message: `Acknowledged by device — ${parts.join(", ")}`,
    autoClose: 1500,
  });
}

/** Every write goes straight to the device, and each call now resolves only
 * once the device has acknowledged the packet at the transport level, or
 * rejects after the backend's refire budget is spent (see
 * `live/cvr/request.rs`'s `WriteRegistry`). What that confirms is *delivery* —
 * not that the device applied the value — so the display still comes from the
 * read path: the next FC=27 poll, already subscribed via
 * `useLiveChannelConfig`, reflects the real state back. Nothing here is
 * optimistic.
 *
 * Both failure modes therefore reach `reportWrite`: a write the backend
 * refused to build or send, and one the device never acknowledged. */
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
    async setMatrixCrosspoint(channelIndex, sourceIndex, gainDb, active) {
      await reportWrite(
        "Set matrix crosspoint",
        commands.liveControlSetMatrixCrosspoint(deviceId, channelIndex, sourceIndex, gainDb, active),
      );
    },
    async setChannelNoiseGate(channelIndex, enabled, thresholdDbu) {
      await reportWrite("Set noise gate", commands.liveControlSetChannelNoiseGate(deviceId, channelIndex, enabled, thresholdDbu));
    },
    async setChannelLimiter(channelIndex, patch) {
      await reportWrite("Set limiter", commands.liveControlSetChannelLimiter(deviceId, channelIndex, patch));
    },
    async setChannelName(channelIndex, side, name) {
      await reportWrite("Set channel name", commands.liveControlSetChannelName(deviceId, channelIndex, side, name));
    },
    /** FC=11 carries only the source *kind*. The positional `index` this
     * app tracks alongside it has no wire equivalent, and clearing a source
     * (`kind === null`) is not something FC=11 can express — a live channel
     * always has some source selected. Both are rejected up front rather
     * than sent as a packet that would mean something else. */
    /** Re-enabled now that `bridgedPairs` gives the UI a real readback —
     * see the `outputBridged` note in `mapLiveChannel`. `channelIndex` is
     * the pair's leader; FC=50 addresses pairs by their leader channel. */
    async setOutputBridge(pairLeaderChannelIndex, bridged) {
      await reportWrite("Set bridge", commands.liveControlSetOutputBridge(deviceId, pairLeaderChannelIndex, bridged));
    },
    async setChannelSource(channelIndex, kind) {
      if (kind === null) {
        notifications.show({
          color: "red",
          title: "Set source failed",
          message: "A live channel always has a source — pick Analog, Dante or AES3 instead of clearing it.",
          autoClose: false,
        });
        return;
      }
      await reportWrite("Set source", commands.liveControlSetChannelSource(deviceId, channelIndex, kind));
    },
  };
}
