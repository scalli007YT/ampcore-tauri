import { Center, SimpleGrid, Skeleton, Stack, Tabs, Text, Tooltip } from "@mantine/core";
import {
  ArrowDownToLine,
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

type SkeletonVariant = "canvas" | "list" | "grid";

const TABS = [
  { value: "scheme", label: "Scheme", icon: CircuitBoard, skeleton: "canvas" },
  { value: "sourceSelection", label: "Source Selection", icon: Share2, skeleton: "list" },
  { value: "matrix", label: "Matrix", icon: Grid3x3, skeleton: "grid" },
  { value: "input", label: "Input", icon: ArrowDownToLine, skeleton: "list" },
  { value: "output", label: "Output", icon: ArrowUpFromLine, skeleton: "list" },
  { value: "speakerConfiguration", label: "Speaker Configuration", icon: Speaker, skeleton: "grid" },
  { value: "presetConfiguration", label: "Preset Configuration", icon: SlidersHorizontal, skeleton: "list" },
] as const satisfies { value: string; label: string; icon: unknown; skeleton: SkeletonVariant }[];

function TabSkeleton({ label, variant }: { label: string; variant: SkeletonVariant }) {
  return (
    <Stack h="100%" p="xl" gap="md">
      <Text fw={600}>{label}</Text>

      <Stack style={{ flex: 1, opacity: 0.5, pointerEvents: "none" }} gap="md">
        {variant === "canvas" && <Skeleton height="100%" radius="md" style={{ flex: 1 }} />}

        {variant === "list" && (
          <Stack gap="xs" style={{ flex: 1 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={34} radius="sm" />
            ))}
          </Stack>
        )}

        {variant === "grid" && (
          <SimpleGrid cols={4} spacing="md" style={{ flex: 1, alignContent: "start" }}>
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

export function AmpConfigureView({ assignment: _assignment, ampModel: _ampModel }: AmpConfigureViewProps) {
  return (
    <Tabs defaultValue="scheme" orientation="vertical" style={{ height: "100%" }}>
      <Tabs.List style={{ justifyContent: "center" }}>
        {TABS.map(({ value, label, icon: Icon }) => (
          <Tooltip key={value} label={label} position="right" withArrow openDelay={300}>
            <Tabs.Tab value={value} aria-label={label}>
              <Icon size={18} />
            </Tabs.Tab>
          </Tooltip>
        ))}
      </Tabs.List>

      {TABS.map(({ value, label, skeleton }) => (
        <Tabs.Panel key={value} value={value} style={{ minHeight: 0 }}>
          <TabSkeleton label={label} variant={skeleton} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
