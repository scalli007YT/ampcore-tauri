import {
  commands,
  type CrossoverSlotKind,
  type CrossoverSlotPatch,
  type EqBandPatch,
  type EqDirection,
  type LimiterPatch,
  type PowerMode,
  type Project,
  type SourceKind,
} from "./bindings";

/** Every mutation `AmpConfigureView`'s tabs (and `EqEditor`/`LimiterEditor`)
 * can make, abstracted away from *how* — Project mode persists to a
 * `Project` file via `commands.projectsSetX`, Direct Edit mode writes
 * straight to a live device via `commands.liveControlSetX` (see
 * `liveConfigureAdapter.ts`). Optional members mean "not available for this
 * source", signalled by plain `undefined` — call sites early-return on it.
 *
 * As of the 1.1.8 Tier-A pass the only member Direct Edit mode still leaves
 * undefined is `setChannelOhms` — a Project-only concept, gated by
 * `ConfigureCapabilities.ohmsEditable` so it explains itself rather than
 * sitting inert. Every other member has a live wire command; FIR is the one
 * remaining device feature with no action here at all, and its tab says so
 * explicitly instead of offering dead controls.
 *
 * Note that an early-return on `undefined` is silent by design *only* where
 * a capability flag already explains the absence. Adding a new optional
 * member without that gating reintroduces a control that looks live and
 * does nothing. */
export interface ConfigureActions {
  setChannelDelayIn(channelIndex: number, delayInMs: number): Promise<void>;
  setChannelInputMute(channelIndex: number, muted: boolean): Promise<void>;
  setChannelOutput(
    channelIndex: number,
    trimDb: number | null,
    volumeDb: number | null,
    delayOutMs: number | null,
  ): Promise<void>;
  setChannelPhaseInvert(channelIndex: number, inverted: boolean): Promise<void>;
  setChannelOutputMute(channelIndex: number, muted: boolean): Promise<void>;
  setChannelPowerMode(channelIndex: number, mode: PowerMode): Promise<void>;

  setChannelName?(channelIndex: number, side: EqDirection, name: string | null): Promise<void>;
  setOutputBridge?(pairLeaderChannelIndex: number, bridged: boolean): Promise<void>;
  setChannelSource?(channelIndex: number, kind: SourceKind | null, index: number | null): Promise<void>;
  setMatrixCrosspoint?(
    channelIndex: number,
    sourceIndex: number,
    gainDb: number | null,
    active: boolean | null,
  ): Promise<void>;
  setCrossoverSlot?(
    channelIndex: number,
    direction: EqDirection,
    slot: CrossoverSlotKind,
    patch: CrossoverSlotPatch,
  ): Promise<void>;
  setEqBand?(channelIndex: number, direction: EqDirection, bandIndex: number, patch: EqBandPatch): Promise<void>;
  setChannelLimiter?(channelIndex: number, patch: LimiterPatch): Promise<void>;
  setChannelNoiseGate?(channelIndex: number, enabled: boolean, thresholdDbu: number): Promise<void>;
  setChannelOhms?(channelIndex: number, ohms: number): Promise<void>;
}

/** Affordances that are conceptually Project-only (no live-device
 * equivalent exists at all, not just "not implemented yet") — today just the
 * Limiter tab's Ohms field, rendered disabled rather than silently inert. */
export interface ConfigureCapabilities {
  ohmsEditable: boolean;
}

export const PROJECT_CONFIGURE_CAPABILITIES: ConfigureCapabilities = {
  ohmsEditable: true,
};

/** Mechanical extraction of the `commands.projectsSetX(project.id,
 * assignment.id, ...)` bodies every Configure tab used to call directly —
 * same commands, same `onProjectUpdate` callback, just centralized behind
 * `ConfigureActions` so the tabs themselves don't need to know they're
 * targeting a Project. */
export function createProjectConfigureActions(
  projectId: string,
  assignmentId: string,
  onProjectUpdate: (project: Project) => void,
): ConfigureActions {
  return {
    async setChannelDelayIn(channelIndex, delayInMs) {
      const result = await commands.projectsSetChannelDelayIn(projectId, assignmentId, channelIndex, delayInMs);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelInputMute(channelIndex, muted) {
      const result = await commands.projectsSetChannelInputMute(projectId, assignmentId, channelIndex, muted);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelOutput(channelIndex, trimDb, volumeDb, delayOutMs) {
      const result = await commands.projectsSetChannelOutput(
        projectId,
        assignmentId,
        channelIndex,
        trimDb,
        volumeDb,
        delayOutMs,
      );
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelPhaseInvert(channelIndex, inverted) {
      const result = await commands.projectsSetChannelPhaseInvert(projectId, assignmentId, channelIndex, inverted);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelOutputMute(channelIndex, muted) {
      const result = await commands.projectsSetChannelOutputMute(projectId, assignmentId, channelIndex, muted);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelPowerMode(channelIndex, mode) {
      const result = await commands.projectsSetChannelPowerMode(projectId, assignmentId, channelIndex, mode);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelName(channelIndex, side, name) {
      const result = await commands.projectsSetChannelName(projectId, assignmentId, channelIndex, side, name);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setOutputBridge(pairLeaderChannelIndex, bridged) {
      const result = await commands.projectsSetOutputBridge(projectId, assignmentId, pairLeaderChannelIndex, bridged);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelSource(channelIndex, kind, index) {
      const result = await commands.projectsSetChannelSource(projectId, assignmentId, channelIndex, kind, index);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setMatrixCrosspoint(channelIndex, sourceIndex, gainDb, active) {
      const result = await commands.projectsSetMatrixCrosspoint(
        projectId,
        assignmentId,
        channelIndex,
        sourceIndex,
        gainDb,
        active,
      );
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setCrossoverSlot(channelIndex, direction, slot, patch) {
      const result = await commands.projectsSetCrossoverSlot(
        projectId,
        assignmentId,
        channelIndex,
        direction,
        slot,
        patch,
      );
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setEqBand(channelIndex, direction, bandIndex, patch) {
      const result = await commands.projectsSetEqBand(
        projectId,
        assignmentId,
        channelIndex,
        direction,
        bandIndex,
        patch,
      );
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelLimiter(channelIndex, patch) {
      const result = await commands.projectsSetChannelLimiter(projectId, assignmentId, channelIndex, patch);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelNoiseGate(channelIndex, enabled, thresholdDbu) {
      const result = await commands.projectsSetChannelNoiseGate(
        projectId,
        assignmentId,
        channelIndex,
        enabled,
        thresholdDbu,
      );
      if (result.status === "ok") onProjectUpdate(result.data);
    },
    async setChannelOhms(channelIndex, ohms) {
      const result = await commands.projectsSetChannelOhms(projectId, assignmentId, channelIndex, ohms);
      if (result.status === "ok") onProjectUpdate(result.data);
    },
  };
}
