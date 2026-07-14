import { useState } from "react";
import { Badge, Card, Center, Divider, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { DeviceTelemetryPanel } from "./DeviceTelemetryPanel";
import { useLiveChannelConfig } from "../hooks/useLiveChannelConfig";
import { useLiveDevices } from "../hooks/useLiveDevices";
import { useLiveTelemetry } from "../hooks/useLiveTelemetry";

export function LiveControlView() {
  const { devices, ready } = useLiveDevices();
  const telemetryById = useLiveTelemetry();
  const channelConfigById = useLiveChannelConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!ready) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  const selectedDevice = devices.find((d) => d.id === selectedId) ?? null;

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
          <DeviceTelemetryPanel
            device={selectedDevice}
            telemetry={telemetryById[selectedDevice.id]}
            channelConfig={channelConfigById[selectedDevice.id]}
          />
        ) : (
          <Center h="100%">
            <Text c="dimmed">Select an amp from the list</Text>
          </Center>
        )}
      </div>
    </Group>
  );
}
