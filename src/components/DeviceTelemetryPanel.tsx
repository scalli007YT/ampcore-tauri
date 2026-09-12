import type { ReactNode } from "react";
import { Badge, Divider, Group, ScrollArea, Stack, Table, Text } from "@mantine/core";
import type { ChannelConfig, ChannelConfigSnapshot, ChannelEq, DiscoveredDevice, Telemetry } from "../lib/bindings";

export interface DeviceTelemetryPanelProps {
  device: DiscoveredDevice;
  telemetry?: Telemetry;
  channelConfig?: ChannelConfigSnapshot;
}

/** This app's live telemetry only ever comes from one function code today —
 * see `live/cvr/protocol.rs`'s `FC_HEARTBEAT = 6`. Shown as its own field so
 * it's visible in the UI, not just something stated in chat. */
const TELEMETRY_FUNCTION_CODE = "6 (HEARTBEAT)";
const CHANNEL_CONFIG_FUNCTION_CODE = "27 (SYNC_DATA)";

/** Compact label/value pair for the summary sections — several per row via
 * the wrapping `Group` they sit in, not one row per field. */
function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Text size="10px" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xs" ff="monospace">
        {value}
      </Text>
    </div>
  );
}

function msAgo(timestamp: number | null): string {
  if (timestamp === null) return "—";
  return `${((Date.now() - timestamp) / 1000).toFixed(1)}s ago`;
}

function fmtNum(value: number | null, unit: string, decimals = 1): string {
  return value === null ? "—" : `${value.toFixed(decimals)}${unit}`;
}

/** "lowShelf" -> "Low Shelf", "butterworth12" -> "Butterworth 12" — display
 * nicety only, the raw enum value is what's actually parsed. */
function formatEnum(value: string): string {
  const spaced = value.replace(/([A-Z])/g, " $1").replace(/(\d+)/g, " $1");
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1)).trim();
}

function EqTable({ label, eq }: { label: string; eq: ChannelEq }) {
  const rows = [
    { pos: "HP", filterType: eq.hp.filterType as string, freqHz: eq.hp.freqHz, gainDb: null as number | null, q: null as number | null, active: eq.hp.active },
    ...eq.bands.map((b, i) => ({ pos: String(i + 1), filterType: b.filterType as string, freqHz: b.freqHz, gainDb: b.gainDb, q: b.q, active: b.active })),
    { pos: "LP", filterType: eq.lp.filterType as string, freqHz: eq.lp.freqHz, gainDb: null as number | null, q: null as number | null, active: eq.lp.active },
  ];
  return (
    <div>
      <Text size="xs" c="dimmed" mb={4}>
        {label}
      </Text>
      <Table.ScrollContainer minWidth={380}>
        <Table withRowBorders={false} mb="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Band</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Freq</Table.Th>
            <Table.Th>Gain</Table.Th>
            <Table.Th>Q</Table.Th>
            <Table.Th>Active</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.pos} style={{ opacity: r.active ? 1 : 0.5 }}>
              <Table.Td ff="monospace" fw={600}>
                {r.pos}
              </Table.Td>
              <Table.Td>{formatEnum(r.filterType)}</Table.Td>
              <Table.Td ff="monospace">{fmtNum(r.freqHz, "Hz", 0)}</Table.Td>
              <Table.Td ff="monospace">{r.gainDb === null ? "—" : fmtNum(r.gainDb, "dB")}</Table.Td>
              <Table.Td ff="monospace">{r.q === null ? "—" : r.q.toFixed(2)}</Table.Td>
              <Table.Td>{r.active ? "yes" : "no"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}

function ChannelConfigBlock({ channel }: { channel: ChannelConfig }) {
  const label = String.fromCharCode(65 + channel.channelIndex);
  return (
    <div>
      <Text fw={600} size="sm" mb="xs">
        Channel {label}
      </Text>
      <Group gap="lg" wrap="wrap" mb="sm">
        <InfoField label="input name" value={channel.inputName ?? `In${channel.channelIndex + 1}`} />
        <InfoField label="output name" value={channel.outputName ?? `Out${label}`} />
        <InfoField label="load" value={fmtNum(channel.loadOhms, "Ω")} />
        <InfoField
          label="backup"
          value={
            channel.backupPriority.enabled
              ? `${channel.backupPriority.first}/${channel.backupPriority.second} @ ${channel.backupPriority.thresholdDb}dB`
              : "off"
          }
        />
        <InfoField label="delay in" value={fmtNum(channel.delayInMs, "ms")} />
        <InfoField label="input muted" value={channel.inputMuted ? "yes" : "no"} />
        <InfoField label="output trim" value={fmtNum(channel.outputTrimDb, "dB")} />
        <InfoField label="output volume" value={fmtNum(channel.outputVolumeDb, "dB")} />
        <InfoField label="output muted" value={channel.outputMuted ? "yes" : "no"} />
        <InfoField label="delay out" value={fmtNum(channel.delayOutMs, "ms")} />
        <InfoField label="phase inverted" value={channel.outputPhaseInverted ? "yes" : "no"} />
        <InfoField label="noise gate" value={channel.noiseGateEnabled ? "enabled" : "disabled"} />
        <InfoField label="FIR" value={channel.firBypassed ? "bypassed" : "enabled"} />
        <InfoField label="power mode" value={channel.powerMode ? formatEnum(channel.powerMode) : "—"} />
        <InfoField
          label="source"
          value={channel.source ? `${formatEnum(channel.source.kind)} ${channel.source.index}` : "—"}
        />
      </Group>

      <Text size="xs" c="dimmed" mb={4}>
        Per-source trim/delay
      </Text>
      <Table withRowBorders={false} mb="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Source</Table.Th>
            <Table.Th>Trim</Table.Th>
            <Table.Th>Delay</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>Analog</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.analogTrimDb, "dB")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.analogDelayMs, "ms")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Dante</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.danteTrimDb, "dB")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.danteDelayMs, "ms")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>AES3</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.aes3TrimDb, "dB")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.aes3DelayMs, "ms")}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      <Text size="xs" c="dimmed" mb={4}>
        Matrix crosspoints
      </Text>
      <Table withRowBorders={false} mb="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Src</Table.Th>
            <Table.Th>Gain</Table.Th>
            <Table.Th>Active</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {channel.matrixCrosspoints.map((mx) => (
            <Table.Tr key={mx.sourceIndex}>
              <Table.Td ff="monospace">{mx.sourceIndex}</Table.Td>
              <Table.Td ff="monospace">{fmtNum(mx.gainDb, "dB")}</Table.Td>
              <Table.Td>{mx.active ? "yes" : "no"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <EqTable label="Input EQ" eq={channel.inputEq} />
      <EqTable label="Output EQ" eq={channel.outputEq} />

      <Text size="xs" c="dimmed" mb={4}>
        Limiter
      </Text>
      <Table withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th></Table.Th>
            <Table.Th>Enabled</Table.Th>
            <Table.Th>Threshold</Table.Th>
            <Table.Th>Attack/Hold</Table.Th>
            <Table.Th>Release</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>RMS</Table.Td>
            <Table.Td>{channel.limiter.rms.enabled ? "yes" : "no"}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.limiter.rms.thresholdVrms, "Vrms")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.limiter.rms.attackMs, "ms")}</Table.Td>
            <Table.Td ff="monospace">
              {channel.limiter.rms.releaseMultiplier === null ? "—" : `${channel.limiter.rms.releaseMultiplier}×`}
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Peak</Table.Td>
            <Table.Td>{channel.limiter.peak.enabled ? "yes" : "no"}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.limiter.peak.thresholdVp, "Vp")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.limiter.peak.holdMs, "ms")}</Table.Td>
            <Table.Td ff="monospace">{fmtNum(channel.limiter.peak.releaseMs, "ms")}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </div>
  );
}

function ChannelConfigSection({ snapshot }: { snapshot: ChannelConfigSnapshot }) {
  return (
    <div>
      <Group gap="lg" wrap="wrap" mb="md">
        <InfoField label="function code" value={CHANNEL_CONFIG_FUNCTION_CODE} />
        <InfoField label="received" value={msAgo(snapshot.receivedAt)} />
        <InfoField
          label="rotary locked"
          value={snapshot.rotaryLocked === null ? "— (unknown)" : snapshot.rotaryLocked ? "yes" : "no"}
        />
        <InfoField
          label="standby"
          value={snapshot.standby === null ? "— (unknown)" : snapshot.standby ? "yes" : "no"}
        />
        <InfoField label="preset" value={snapshot.presetName ?? "—"} />
      </Group>
      <Stack gap="xl">
        {snapshot.channels.map((ch) => (
          <ChannelConfigBlock key={ch.channelIndex} channel={ch} />
        ))}
      </Stack>
    </div>
  );
}

/** Standalone-device telemetry view for the Live Control tab — deliberately
 * not `AmpConfigureView` (that component is `AmpAssignment`/Project-shaped;
 * a bare `DiscoveredDevice` has no project link this phase). No meters — one
 * row per channel with every field as a column, not one row per value. */
export function DeviceTelemetryPanel({ device, telemetry, channelConfig }: DeviceTelemetryPanelProps) {
  const outputCount = telemetry?.outputVoltages.length ?? device.outputChannels ?? 0;
  const inputCount = telemetry?.inputVoltages.length ?? device.analogInputChannels ?? 0;
  const firmwareSupported = device.firmwareFamily === "1.1.8" || device.firmwareFamily === "1.1.9";

  return (
    <ScrollArea h="100%">
      <Stack p="md" gap="lg" className="min-w-0">
        <Group justify="space-between" align="flex-start">
          <Text fw={600}>{device.name || device.mac}</Text>
          <Badge color={device.online ? "green" : "gray"} variant="light">
            {device.online ? "Online" : "Offline"}
          </Badge>
        </Group>

        <Group gap="lg" wrap="wrap">
          <InfoField label="id" value={device.id} />
          <InfoField label="driver" value={device.driverId} />
          <InfoField label="brand" value={device.brand} />
          <InfoField label="mac" value={device.mac} />
          <InfoField label="ip" value={device.ip} />
          <InfoField label="firmware version" value={device.firmwareVersion || "unknown"} />
          <InfoField label="firmware family" value={device.firmwareFamily ?? "unknown"} />
          <InfoField label="gain max" value={device.gainMax} />
          <InfoField label="analog in ch" value={device.analogInputChannels} />
          <InfoField label="digital in ch" value={device.digitalInputChannels} />
          <InfoField label="output ch" value={device.outputChannels} />
          <InfoField label="machine state" value={device.machineState} />
          <InfoField label="last seen" value={msAgo(device.lastSeenAt)} />
        </Group>

        <Divider />

        <Text fw={500} size="sm" c="dimmed">
          Telemetry
        </Text>

        {!telemetry ? (
          <Text c="dimmed" size="sm">
            {firmwareSupported ? "Waiting for telemetry…" : "Telemetry isn't supported on this device's firmware yet."}
          </Text>
        ) : (
          <>
            <Group gap="lg" wrap="wrap">
              <InfoField label="function code" value={TELEMETRY_FUNCTION_CODE} />
              <InfoField label="machine mode" value={telemetry.machineMode} />
              <InfoField label="received" value={msAgo(telemetry.receivedAt)} />
              <InfoField
                label="rated RMS voltage"
                value={telemetry.ratedRmsVoltage === null ? "unknown model" : `${telemetry.ratedRmsVoltage}V`}
              />
            </Group>

            <div>
              <Text fw={500} size="sm" c="dimmed" mb="xs">
                Outputs
              </Text>
              {/* Seven columns of monospace readings don't compress; below
                * their natural width the table scrolls sideways in place
                * instead of widening the whole panel. */}
              <Table.ScrollContainer minWidth={420}>
                <Table withRowBorders={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Ch</Table.Th>
                    <Table.Th>V</Table.Th>
                    <Table.Th>A</Table.Th>
                    <Table.Th>Ω</Table.Th>
                    <Table.Th>Level</Table.Th>
                    <Table.Th>Limiter</Table.Th>
                    <Table.Th>State</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Array.from({ length: outputCount }, (_, i) => {
                    const voltage = telemetry.outputVoltages[i] ?? 0;
                    const current = telemetry.outputCurrents[i] ?? 0;
                    const impedance = telemetry.outputImpedance[i] ?? 0;
                    const levelDb = telemetry.outputLevelDb[i] ?? null;
                    const limiter = telemetry.limiters[i] ?? 0;
                    const state = telemetry.outputStates[i] ?? 0;
                    return (
                      <Table.Tr key={i}>
                        <Table.Td ff="monospace" fw={600}>
                          {String.fromCharCode(65 + i)}
                        </Table.Td>
                        <Table.Td ff="monospace">{voltage.toFixed(1)}</Table.Td>
                        <Table.Td ff="monospace">{current.toFixed(2)}</Table.Td>
                        <Table.Td ff="monospace">{impedance.toFixed(0)}</Table.Td>
                        <Table.Td ff="monospace">{levelDb === null ? "—" : levelDb.toFixed(1)}</Table.Td>
                        <Table.Td ff="monospace">{limiter.toFixed(1)}</Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={state === 0 ? "gray" : "orange"} variant="outline">
                            {state}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </div>

            <div>
              <Text fw={500} size="sm" c="dimmed" mb="xs">
                Inputs
              </Text>
              <Table.ScrollContainer minWidth={320}>
                <Table withRowBorders={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Ch</Table.Th>
                    <Table.Th>Level</Table.Th>
                    <Table.Th>V</Table.Th>
                    <Table.Th>State</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Array.from({ length: inputCount }, (_, i) => {
                    const dbfs = telemetry.inputDbfs[i] ?? null;
                    const voltage = telemetry.inputVoltages[i] ?? 0;
                    const state = telemetry.inputStates[i] ?? 0;
                    return (
                      <Table.Tr key={i}>
                        <Table.Td ff="monospace" fw={600}>
                          {i + 1}
                        </Table.Td>
                        <Table.Td ff="monospace">{dbfs === null ? "—" : `${dbfs.toFixed(1)}dB`}</Table.Td>
                        <Table.Td ff="monospace">{voltage.toFixed(3)}</Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={state === 0 ? "gray" : "orange"} variant="outline">
                            {state}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </div>

            <Group gap="lg" wrap="wrap">
              {telemetry.temperatures.map((t, i) => (
                <InfoField key={i} label={i < 4 ? `ch ${i + 1} temp` : "psu temp"} value={`${(t ?? 0).toFixed(1)}°C`} />
              ))}
              <InfoField
                label="fan"
                value={telemetry.fanVoltage === null ? "— (not in this packet size)" : `${telemetry.fanVoltage.toFixed(1)}V`}
              />
            </Group>
          </>
        )}

        <Divider />

        <Text fw={500} size="sm" c="dimmed">
          Channel Config
        </Text>

        {!channelConfig ? (
          <Text c="dimmed" size="sm">
            {firmwareSupported ? "Waiting for channel config…" : "Channel config isn't supported on this device's firmware yet."}
          </Text>
        ) : (
          <ChannelConfigSection snapshot={channelConfig} />
        )}
      </Stack>
    </ScrollArea>
  );
}
