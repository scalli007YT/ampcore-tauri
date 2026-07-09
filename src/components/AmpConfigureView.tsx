import { Center, Group, SimpleGrid, Skeleton, Stack, Tabs, Text, Tooltip } from "@mantine/core";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CircuitBoard,
  Grid3x3,
  Share2,
  Speaker,
  SlidersHorizontal,
} from "lucide-react";
import type { AmpAssignment, AmpModelCatalogEntry } from "../lib/bindings";

interface AmpConfigureViewProps {
  /** Omitted when configuring a live-discovered device with no project
   * assignment yet (Live Control mode) — see App.tsx's two entry points. */
  assignment?: AmpAssignment;
  ampModel?: AmpModelCatalogEntry;
}

type SkeletonVariant = "scheme" | "list" | "grid";

const DEFAULT_SCHEME_CHANNEL_COUNT = 4;

const TABS = [
  { value: "scheme", label: "Scheme", icon: CircuitBoard, skeleton: "scheme" },
  { value: "sourceSelection", label: "Source Selection", icon: Share2, skeleton: "list" },
  { value: "matrix", label: "Matrix", icon: Grid3x3, skeleton: "grid" },
  { value: "input", label: "Input", icon: ArrowDownToLine, skeleton: "list" },
  { value: "output", label: "Output", icon: ArrowUpFromLine, skeleton: "list" },
  { value: "speakerConfiguration", label: "Speaker Configuration", icon: Speaker, skeleton: "grid" },
  { value: "presetConfiguration", label: "Preset Configuration", icon: SlidersHorizontal, skeleton: "list" },
] as const satisfies { value: string; label: string; icon: unknown; skeleton: SkeletonVariant }[];

function SchemeRowSkeleton() {
  return (
    <Group gap="xs" wrap="nowrap" align="stretch">
      <Skeleton height={60} width={50} radius="sm" />
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Skeleton height={60} width={90} radius="sm" />
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Skeleton height={60} className="flex-1" radius="sm" />
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Skeleton height={60} width={160} radius="sm" />
    </Group>
  );
}

function TabSkeleton({
  label,
  variant,
  channelCount,
}: {
  label: string;
  variant: SkeletonVariant;
  channelCount: number;
}) {
  return (
    <Stack h="100%" p="xl" gap="md">
      <Text fw={600}>{label}</Text>

      <Stack className="flex-1 opacity-50 pointer-events-none" gap="md">
        {variant === "scheme" && (
          <Stack gap="lg" className="flex-1" justify="center">
            {Array.from({ length: channelCount }).map((_, i) => (
              <SchemeRowSkeleton key={i} />
            ))}
          </Stack>
        )}

        {variant === "list" && (
          <Stack gap="xs" className="flex-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={34} radius="sm" />
            ))}
          </Stack>
        )}

        {variant === "grid" && (
          <SimpleGrid cols={4} spacing="md" className="flex-1 content-start">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={80} radius="md" />
            ))}
          </SimpleGrid>
        )}
      </Stack>

      <Center>
        <Text size="xs" c="dimmed">
          Coming soon
        </Text>
      </Center>
    </Stack>
  );
}

export function AmpConfigureView({ assignment, ampModel: _ampModel }: AmpConfigureViewProps) {
  const channelCount = assignment?.channels.length ?? DEFAULT_SCHEME_CHANNEL_COUNT;

  return (
    <Tabs defaultValue="scheme" orientation="vertical" className="h-full">
      <Tabs.List className="justify-center">
        {TABS.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value} label={label} position="right" withArrow openDelay={300}>
            <Tabs.Tab value={value} aria-label={label}>
              <Icon size={18} />
            </Tabs.Tab>
          </Tooltip>
        ))}
      </Tabs.List>

      {TABS.map(({ value, label, skeleton }) => (
        <Tabs.Panel key={value} value={value} className="min-h-0">
          <TabSkeleton label={label} variant={skeleton} channelCount={channelCount} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
