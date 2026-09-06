import type { Telemetry } from "./bindings";

/** One channel's slice of a heartbeat, with every field `null` when there's
 * no telemetry at all, when this channel is past the end of the packet's
 * arrays, or when the backend couldn't compute the value (`outputLevelDb`
 * stays `null` for a model with no known rated voltage — see
 * `telemetry.rs`). Callers render `null` as unlit/"—", never as `0`: a
 * fabricated zero reads as a real "silent, cold, 0V" measurement. */
export interface ChannelTelemetry {
  /** Input level in dB relative to 1V (NOT true dBFS — the wire adapter has
   * no calibrated full-scale reference, see `telemetry_v118.rs`). Labeled
   * "dBV" in the UI for that reason. */
  inputDbv: number | null;
  /** Output level in dB relative to the device's rated RMS voltage, so
   * `0dB` = rated max output. */
  outputLevelDb: number | null;
  outputVoltage: number | null;
  outputCurrent: number | null;
  temperatureC: number | null;
  /** Limiter gain reduction, as a non-positive dB value (the wire carries
   * the magnitude; the reference implementation negates it the same way).
   * `0` means "not limiting" and is a real reading, not a placeholder. */
  gainReductionDb: number | null;
}

export const NO_CHANNEL_TELEMETRY: ChannelTelemetry = {
  inputDbv: null,
  outputLevelDb: null,
  outputVoltage: null,
  outputCurrent: null,
  temperatureC: null,
  gainReductionDb: null,
};

function at(values: (number | null)[] | undefined, index: number): number | null {
  return values?.[index] ?? null;
}

/** `20*log10(v / reference)`, mirroring `live/dsp.rs`'s `voltage_to_db` —
 * including its refusal to produce a number for a non-positive voltage or
 * reference (log of zero is `-Infinity`, which would peg a meter at the
 * floor as if it were a real reading). */
export function voltageToDb(voltage: number | null, referenceVolts: number | null): number | null {
  if (voltage === null || referenceVolts === null) return null;
  if (voltage <= 0 || referenceVolts <= 0) return null;
  return 20 * Math.log10(voltage / referenceVolts);
}

/** `ratedRmsVoltage` is the fallback dB reference for `outputLevelDb`, taken
 * from `capability.topology.ratedRmsVoltage` — i.e. the datasheet rating of
 * the model the user actually assigned to this device. The backend fills
 * `Telemetry.output_level_db` itself only when the device's factory firmware
 * string embeds a recognizable model designation
 * (`rated_rms_voltage_from_firmware_string`), which plenty of real units
 * don't; without this fallback their output meters sit dead at the floor
 * while V and A read fine. Both paths use the same datasheet table, so this
 * is a second route to a real rating, not a guessed default — with no model
 * assigned it stays `null` and the meter stays honestly unlit. */
export function channelTelemetry(
  telemetry: Telemetry | undefined,
  channelIndex: number,
  ratedRmsVoltage: number | null,
): ChannelTelemetry {
  if (!telemetry) return NO_CHANNEL_TELEMETRY;
  const gr = at(telemetry.limiters, channelIndex);
  const outputVoltage = at(telemetry.outputVoltages, channelIndex);
  return {
    inputDbv: at(telemetry.inputDbfs, channelIndex),
    outputLevelDb:
      at(telemetry.outputLevelDb, channelIndex) ??
      voltageToDb(outputVoltage, telemetry.ratedRmsVoltage ?? ratedRmsVoltage),
    outputVoltage,
    outputCurrent: at(telemetry.outputCurrents, channelIndex),
    // `temperatures` is 5 long: [0-3] per-channel, [4] PSU — a channel index
    // past 3 has no reading of its own rather than borrowing the PSU's.
    temperatureC: channelIndex < 4 ? at(telemetry.temperatures, channelIndex) : null,
    gainReductionDb: gr === null ? null : -Math.abs(gr),
  };
}


/** Peak-to-RMS voltage ratio for a sine wave. Mirrors
 * `PEAK_HEADROOM_FACTOR` in `LimiterEditor.tsx`, which documents why √2 —
 * not 2 — is the voltage-domain factor for a power-domain doubling. */
const PEAK_TO_RMS_FACTOR = Math.SQRT2;

/** A limiter threshold expressed on the same dB scale as `outputLevelDb`
 * (`0dB` = the model's rated RMS output), so a threshold can be drawn
 * directly against an output level meter.
 *
 * `"peak"` thresholds are divided by √2 first: `thresholdVp` is a *peak*
 * voltage, and putting it on an RMS-referenced scale unconverted reads
 * ~3dB hot. Note that conversion is exact only for a sine — against real
 * program material, whose crest factor is whatever it happens to be, this
 * is "the level of a sine that would just touch this threshold", which is
 * the right thing for a scale marker but not a claim about the audio.
 *
 * `null` when there's no reading or the model has no known rated voltage —
 * the same honest gap `outputLevelDb` has, and for the same reason. */
export function limiterThresholdToDb(
  thresholdVolts: number | null,
  kind: "rms" | "peak",
  ratedRmsVoltage: number | null,
): number | null {
  if (thresholdVolts === null) return null;
  return voltageToDb(kind === "peak" ? thresholdVolts / PEAK_TO_RMS_FACTOR : thresholdVolts, ratedRmsVoltage);
}
