import { Badge, Box, Center, Group, Paper, Stack, Tabs, Text, ThemeIcon } from "@mantine/core";
import { Server } from "lucide-react";
import type { AmpAssignment, AmpModelCatalogEntry } from "../lib/bindings";

interface AmpConfigureViewProps {
  assignment: AmpAssignment;
  ampModel?: AmpModelCatalogEntry;
}

// Visual mock only — no device I/O exists yet, so every value here is a
// placeholder mirroring what the field will show once live telemetry is
// wired up, not real data. See AmpCore — Per-Device Configure Tab plan.

function LedRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Group gap={6} wrap="nowrap">
        <Text size="xs">{value}</Text>
        <Box w={8} h={8} style={{ borderRadius: "50%", backgroundColor: "var(--mantine-color-gray-5)" }} />
      </Group>
    </Group>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs">{value}</Text>
    </Group>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper withBorder p="sm" style={{ flex: 1, minWidth: 220 }}>
      <Text size="xs" fw={600} c="dimmed" mb="xs" tt="uppercase">
        {title}
      </Text>
      <Stack gap={4}>{children}</Stack>
    </Paper>
  );
}

function ChannelMeter({ index }: { index: number }) {
  return (
    <Stack align="center" gap={4}>
      <Box
        w={28}
        h={140}
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-xs)",
          position: "relative",
        }}
      >
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "48%",
            height: 1,
            backgroundColor: "var(--mantine-color-gray-5)",
          }}
        />
      </Box>
      <Text size="xs" c="dimmed">
        Ch {index + 1}
      </Text>
      <Text size="xs" c="dimmed">
        0 dB
      </Text>
    </Stack>
  );
}

function OverviewPanel({ assignment, ampModel }: AmpConfigureViewProps) {
  const displayName = assignment.label ?? (ampModel ? `${ampModel.brand} ${ampModel.model}` : "Unnamed");

  return (
    <Stack p="md" gap="md">
      <Group align="flex-start" gap="md" wrap="wrap">
        <Panel title="Information">
          <ValueRow label="Model" value={ampModel?.model ?? "—"} />
          <ValueRow label="Serial" value="—" />
          <ValueRow label="Device Name" value={displayName} />
          <ValueRow label="Link Id" value="—" />
          <ValueRow label="Protocol Id" value="—" />
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed">
              Link state
            </Text>
            <Text size="xs" c="dimmed" fs="italic">
              {assignment.mac ? assignment.mac : "Not Linked"}
            </Text>
          </Group>
        </Panel>

        <Panel title="Status">
          <LedRow label="Ready" value="No" />
          <LedRow label="Power" value="Off" />
          <LedRow label="Mains" value="No" />
          <LedRow label="Output Signal Ch1" value="No" />
          <LedRow label="Output Signal Ch2" value="No" />
          <LedRow label="Mute Ch1" value="False" />
          <LedRow label="Mute Ch2" value="False" />
          <LedRow label="Temperature" value="0 °C" />
        </Panel>

        <Panel title="Readings">
          <ValueRow label="Power Rail Ch1 (+)" value="0.00 V" />
          <ValueRow label="Power Rail Ch1 (-)" value="0.00 V" />
          <ValueRow label="Power Rail Ch2 (+)" value="0.00 V" />
          <ValueRow label="Power Rail Ch2 (-)" value="0.00 V" />
          <ValueRow label="Aux Bus Ch1-2 (+)" value="0.00 V" />
          <ValueRow label="Aux Bus Ch1-2 (-)" value="0.00 V" />
          <ValueRow label="Hub Voltage" value="0.00 V" />
          <ValueRow label="Aux 5V" value="0.00 V" />
        </Panel>

        <Stack gap="md" style={{ flex: 1, minWidth: 220 }}>
          <Panel title="Mains Measures">
            <ValueRow label="Voltage" value="0 V" />
            <ValueRow label="Current" value="0 A" />
          </Panel>
          <Panel title="Status">
            <ValueRow label="Clock" value="Not active" />
            <ValueRow label="VAux" value="Not Ok" />
            <ValueRow label="IGBT" value="Not active" />
            <ValueRow label="Boost" value="Active" />
            <ValueRow label="Protection Ch1" value="None" />
            <ValueRow label="Protection Ch2" value="None" />
          </Panel>
        </Stack>
      </Group>

      <Group align="flex-start" gap="xl" wrap="wrap">
        <Group gap="lg">
          {assignment.channels.map((channel) => (
            <ChannelMeter key={channel.channelIndex} index={channel.channelIndex} />
          ))}
        </Group>

        <Stack gap="xs">
          <ValueRow label="Avg. Load Channel 1" value="—" />
          <ValueRow label="Avg. Load Channel 2" value="—" />
          <Badge color="gray" variant="light" w="fit-content">
            SAFE
          </Badge>
          <ValueRow label="Firmware Version" value="0.0.0.0" />
        </Stack>
      </Group>
    </Stack>
  );
}

export function AmpConfigureView({ assignment, ampModel }: AmpConfigureViewProps) {
  return (
    <Tabs defaultValue="overview" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group gap="md" p="sm" wrap="nowrap">
        <ThemeIcon variant="light" color="gray" size={40}>
          <Server size={22} />
        </ThemeIcon>
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="scheme">Scheme</Tabs.Tab>
          <Tabs.Tab value="presetManager">Preset Manager</Tabs.Tab>
          <Tabs.Tab value="historyMonitor">History Monitor</Tabs.Tab>
          <Tabs.Tab value="liveImpedance">LiveImpedance</Tabs.Tab>
          <Tabs.Tab value="presets">Presets</Tabs.Tab>
        </Tabs.List>
      </Group>

      <Tabs.Panel value="overview" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <OverviewPanel assignment={assignment} ampModel={ampModel} />
      </Tabs.Panel>
      <Tabs.Panel value="general" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
      <Tabs.Panel value="scheme" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
      <Tabs.Panel value="presetManager" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
      <Tabs.Panel value="historyMonitor" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
      <Tabs.Panel value="liveImpedance" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
      <Tabs.Panel value="presets" style={{ flex: 1, minHeight: 0 }}>
        <Center h="100%">
          <Text c="dimmed">Coming soon</Text>
        </Center>
      </Tabs.Panel>
    </Tabs>
  );
}
