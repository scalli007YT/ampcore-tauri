import { useEffect, useState } from "react";
import { Badge, Card, Center, Divider, Group, Loader, ScrollArea, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { AmpConfigureView } from "./AmpConfigureView";
import { DeviceTelemetryPanel } from "./DeviceTelemetryPanel";
import { useLiveChannelConfig } from "../hooks/useLiveChannelConfig";
import { useLiveDevices } from "../hooks/useLiveDevices";
import { useLiveDriver } from "../hooks/useLiveDriver";
import { useLivePolling } from "../hooks/useLivePolling";
import { useLiveTelemetry } from "../hooks/useLiveTelemetry";
import { commands, type AmpModelCatalogEntry, type DiscoveredDevice } from "../lib/bindings";
import { useIsCompact } from "../lib/breakpoints";

/** Resolves which catalog `AmpModelCatalogEntry` a live device should be
 * configured as — Direct Edit's counterpart to a Project's
 * `AmpAssignment.ampModelId`, but keyed by MAC in a small standalone store
 * (`device_model_links.json`, see `commands/device_links.rs`) rather than
 * tied to any Project. Auto-matches from the device's firmware string on
 * first sight of a device id; a manual pick always wins afterward and is
 * never silently re-matched (see `device_model_link_auto_match`'s own
 * doc comment). */
function useDeviceModelLink(device: DiscoveredDevice | null) {
  const [ampModels, setAmpModels] = useState<AmpModelCatalogEntry[]>([]);
  const [ampModel, setAmpModel] = useState<AmpModelCatalogEntry | null>(null);

  useEffect(() => {
    commands.ampModelsList().then((result) => {
      if (result.status === "ok") setAmpModels(result.data);
    });
  }, []);

  useEffect(() => {
    if (!device) {
      setAmpModel(null);
      return;
    }
    let cancelled = false;
    commands
      .deviceModelLinkAutoMatch(device.mac, device.firmwareVersion, device.digitalInputChannels, device.outputChannels)
      .then((result) => {
        if (cancelled) return;
        setAmpModel(result.status === "ok" ? result.data : null);
      });
    return () => {
      cancelled = true;
    };
    // Re-resolve only when the selected device identity changes, not on
    // every telemetry-driven re-render of the same device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  function setManualModel(id: string | null) {
    if (!device) return;
    const picked = id ? (ampModels.find((m) => m.id === id) ?? null) : null;
    commands.deviceModelLinkSet(device.mac, id).then((result) => {
      if (result.status === "ok") setAmpModel(picked);
    });
  }

  return { ampModels, ampModel, setManualModel };
}

export function LiveControlView() {
  const compact = useIsCompact();
  const { devices, ready } = useLiveDevices();
  const telemetryById = useLiveTelemetry();
  const channelConfigById = useLiveChannelConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState("configure");

  const selectedDevice = devices.find((d) => d.id === selectedId) ?? null;

  // Live Control is one consumer of the shared live connector, not its owner:
  // it starts the driver like any other live-aware view would, and subscribes
  // only the amp being looked at to the heavy polls. Unmounting drops its
  // subscription, so leaving Live Control falls back to discovery-only.
  useLiveDriver();
  useLivePolling(selectedId ? [selectedId] : []);
  const { ampModels, ampModel, setManualModel } = useDeviceModelLink(selectedDevice);

  if (!ready) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  const modelSelect = (
    <Select
      size="xs"
      placeholder="Assign amp model…"
      className="min-w-0"
      style={{ flex: compact ? "1 1 160px" : "0 0 240px" }}
      data={ampModels.filter((m) => !m.archived).map((m) => ({ value: m.id, label: `${m.brand} ${m.model}` }))}
      value={ampModel?.id ?? null}
      onChange={setManualModel}
      clearable
      searchable
    />
  );

  const viewSwitch = (
    <SegmentedControl
      size="xs"
      value={view}
      onChange={setView}
      data={[
        { label: "Configure", value: "configure" },
        { label: "Raw Telemetry", value: "telemetry" },
      ]}
    />
  );

  const deviceContent = selectedDevice ? (
    view === "telemetry" ? (
      <DeviceTelemetryPanel
        device={selectedDevice}
        telemetry={telemetryById[selectedDevice.id]}
        channelConfig={channelConfigById[selectedDevice.id]}
      />
    ) : (
      <AmpConfigureView
        source={{
          kind: "live",
          device: selectedDevice,
          channelConfig: channelConfigById[selectedDevice.id],
          telemetry: telemetryById[selectedDevice.id],
          ampModel: ampModel ?? undefined,
        }}
      />
    )
  ) : (
    <Center h="100%" p="md">
      <Text c="dimmed" ta="center">
        {devices.length === 0 ? "Scanning for amplifiers on the network…" : "Select an amp from the list"}
      </Text>
    </Center>
  );

  // Compact layout: the 260px discovery rail costs a third of a small
  // window, so it collapses into a Select in the toolbar. Same data, same
  // selection state — only the affordance changes.
  if (compact) {
    return (
      <Stack h="100%" gap={0} className="min-w-0">
        <Group px="sm" py="xs" gap="xs" wrap="wrap" align="center">
          <Select
            size="xs"
            className="min-w-0"
            style={{ flex: "1 1 160px" }}
            placeholder={devices.length === 0 ? "Scanning…" : "Discovered amps…"}
            data={devices.map((d) => ({
              value: d.id,
              label: `${d.name || d.mac}${d.online ? "" : " (offline)"}`,
            }))}
            value={selectedId}
            onChange={setSelectedId}
            searchable
          />
          {selectedDevice && viewSwitch}
          {selectedDevice && modelSelect}
        </Group>
        <Divider />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{deviceContent}</div>
      </Stack>
    );
  }

  return (
    <Group h="100%" gap={0} align="stretch" wrap="nowrap">
      <Stack w={260} h="100%" p="md" gap="md" className="shrink-0">
        <Text fw={500} size="sm" c="dimmed">
          Discovered Amps
        </Text>

        {devices.length === 0 ? (
          <Center className="flex-1">
            <Text c="dimmed" size="sm" ta="center">
              Scanning for amplifiers on the network…
            </Text>
          </Center>
        ) : (
          <ScrollArea className="flex-1">
            <Stack gap="xs">
              {devices.map((d) => {
                const isSelected = d.id === selectedId;
                return (
                  <Card
                    key={d.id}
                    withBorder
                    padding="sm"
                    onClick={() => setSelectedId(d.id)}
                    className={`cursor-pointer${isSelected ? " border-2 border-[var(--mantine-color-amber-filled)]" : ""}`}
                  >
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <div className="min-w-0">
                        <Text fw={500} size="sm" truncate>
                          {d.name || d.mac}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {d.ip}
                        </Text>
                      </div>
                      <Badge color={d.online ? "green" : "gray"} variant="light" size="xs">
                        {d.online ? "Online" : "Offline"}
                      </Badge>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </ScrollArea>
        )}
      </Stack>

      <Divider orientation="vertical" />

      <div className="h-full min-w-0 flex-1">
        {selectedDevice ? (
          <Stack h="100%" gap={0}>
            <Group justify="space-between" wrap="nowrap" gap="xs" px="md" py="xs">
              {viewSwitch}
              {modelSelect}
            </Group>
            <Divider />
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">{deviceContent}</div>
          </Stack>
        ) : (
          <Center h="100%">
            <Text c="dimmed">Select an amp from the list</Text>
          </Center>
        )}
      </div>
    </Group>
  );
}
