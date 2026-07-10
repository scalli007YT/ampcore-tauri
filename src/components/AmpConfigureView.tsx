import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Popover,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
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
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type AmpModelCatalogEntry,
  type Project,
  type SourceKind,
} from "../lib/bindings";

interface AmpConfigureViewProps {
  /** Omitted when configuring a live-discovered device with no project
   * assignment yet (Live Control mode) — see App.tsx's two entry points. */
  assignment?: AmpAssignment;
  ampModel?: AmpModelCatalogEntry;
  /** Needed (alongside `onProjectUpdate`) to write Source Selection/Matrix
   * edits back to the project — the Matrix tab's presets replace the whole
   * assignment in one `projectsUpdate` call, so the full `Project` is needed,
   * not just its id. Omitted in Live Control mode. */
  project?: Project;
  onProjectUpdate?: (project: Project) => void;
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

/** Tabs wired to real capability + persisted values this phase — every other
 * tab keeps rendering `TabSkeleton` as before. */
const CONFIGURABLE_TABS = new Set(["sourceSelection", "matrix"]);

const SOURCE_LABELS: Record<SourceKind, string> = {
  analog: "Analog",
  dante: "Dante",
  aes3: "AES3",
  backup: "Backup",
};

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

interface ConfigurableTabProps {
  assignment: AmpAssignment;
  project: Project;
  capability: AmpCapability;
  onProjectUpdate: (project: Project) => void;
}

function SourceSelectionTab({ assignment, project, capability, onProjectUpdate }: ConfigurableTabProps) {
  const sourceOptions = capability.topology.availableSources.map((source) => ({
    value: source,
    label: SOURCE_LABELS[source],
  }));

  async function handleChange(channelIndex: number, source: string | null) {
    const result = await commands.projectsSetChannelSource(
      project.id,
      assignment.id,
      channelIndex,
      (source as SourceKind | null) ?? null,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  return (
    <Center h="100%" p="xl">
      <Stack gap="md" w={320}>
        <Text fw={600} ta="center">
          Source Selection
        </Text>
        <Stack gap="xs">
          {assignment.channels.map((channel) => (
            <Group key={channel.channelIndex} justify="space-between" wrap="nowrap">
              <Text size="sm">Channel {channel.channelIndex + 1}</Text>
              <Select
                w={180}
                placeholder="No source"
                data={sourceOptions}
                value={channel.source ?? null}
                onChange={(value) => handleChange(channel.channelIndex, value)}
                clearable
              />
            </Group>
          ))}
        </Stack>
      </Stack>
    </Center>
  );
}

/** Decorative scale + gradient track — a visual stand-in for the old app's
 * live per-output level meter. No live device exists in this offline phase,
 * so this never reflects a real signal; it exists purely to match the
 * reference layout. */
const METER_SCALE_DB = [-60, -54, -48, -42, -36, -30, -24, -18, -12, -6, 0, 6, 12, 18];
const METER_GRADIENT =
  "linear-gradient(to right, #0f6e5c 0%, #2f9e6a 35%, #d4c94a 65%, #e0793a 82%, #d64545 100%)";

function MockLevelMeter() {
  return (
    <Stack gap={2} miw={160} maw={200} w="100%">
      <Group gap={0} justify="space-between">
        {METER_SCALE_DB.map((value) => (
          <Text key={value} fz={8} c="dimmed">
            {value}
          </Text>
        ))}
      </Group>
      <div className="h-2 w-full rounded-sm opacity-60" style={{ background: METER_GRADIENT }} />
    </Stack>
  );
}

function MatrixCrosspointCell({
  active,
  gainDb,
  min,
  max,
  onGainChange,
  onActiveChange,
}: {
  active: boolean;
  gainDb: number;
  min: number | null;
  max: number | null;
  onGainChange: (gainDb: number) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom" withArrow shadow="md" width={200}>
      <Popover.Target>
        <UnstyledButton
          onClick={() => setOpened((o) => !o)}
          h={52}
          bdrs="sm"
          bd={`1px solid var(--mantine-color-${active ? "text" : "default-border"})`}
          className="text-center transition-colors"
        >
          <Stack gap={0} align="center" justify="center" h="100%">
            <Text size="sm" fw={700} c={active ? undefined : "dimmed"}>
              {active ? `${gainDb} dB` : "Mute"}
            </Text>
            <Text size="xs" c="dimmed">
              {active ? "Active" : "Bypassed"}
            </Text>
          </Stack>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
            Matrix Gain
          </Text>
          <NumberInput
            value={gainDb}
            min={min ?? undefined}
            max={max ?? undefined}
            step={0.5}
            onChange={(value) => typeof value === "number" && onGainChange(value)}
          />
          <Button fullWidth variant={active ? "filled" : "default"} onClick={() => onActiveChange(!active)}>
            {active ? "Disable" : "Enable"}
          </Button>
          {min != null && max != null && (
            <Text size="xs" c="dimmed" ta="center">
              Range: {min.toFixed(1)} to {max > 0 ? "+" : ""}
              {max.toFixed(1)} dB
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function MatrixTab({ assignment, project, capability, onProjectUpdate }: ConfigurableTabProps) {
  const { min, max } = capability.paramRanges.matrixGainDb;
  const sourceCount = capability.topology.matrixInputCount;

  async function handleGainChange(channelIndex: number, sourceIndex: number, gainDb: number) {
    const result = await commands.projectsSetMatrixCrosspoint(
      project.id,
      assignment.id,
      channelIndex,
      sourceIndex,
      gainDb,
      null,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleActiveChange(channelIndex: number, sourceIndex: number, active: boolean) {
    const result = await commands.projectsSetMatrixCrosspoint(
      project.id,
      assignment.id,
      channelIndex,
      sourceIndex,
      null,
      active,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  return (
    <Center h="100%" p="xl">
      <Stack gap="md" align="center">
        <Text fw={600}>Matrix</Text>
        <ScrollArea>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `32px repeat(${sourceCount}, 88px) 200px`,
              alignItems: "center",
              columnGap: 12,
              rowGap: 8,
            }}
          >
            <div />
            {Array.from({ length: sourceCount }).map((_, i) => (
              <Text key={i} size="xs" c="dimmed" ta="center">
                {i + 1}
              </Text>
            ))}
            <div />

            {assignment.channels.map((channel) => (
              <Fragment key={channel.channelIndex}>
                <Text fw={600} size="sm">
                  {String.fromCharCode(65 + channel.channelIndex)}
                </Text>
                {/* Indexed by column (sourceCount), not by the raw stored
                 * array — keeps the grid's column count authoritative even
                 * if a project's stored crosspoints haven't been
                 * reconciled to the current topology yet. */}
                {Array.from({ length: sourceCount }).map((_, sourceIndex) => {
                  const crosspoint = channel.matrixCrosspoints?.find((c) => c.sourceIndex === sourceIndex) ?? {
                    sourceIndex,
                    gainDb: 0,
                    active: false,
                  };
                  return (
                    <MatrixCrosspointCell
                      key={sourceIndex}
                      active={crosspoint.active}
                      gainDb={crosspoint.gainDb ?? 0}
                      min={min}
                      max={max}
                      onGainChange={(value) => handleGainChange(channel.channelIndex, sourceIndex, value)}
                      onActiveChange={(value) => handleActiveChange(channel.channelIndex, sourceIndex, value)}
                    />
                  );
                })}
                <MockLevelMeter />
              </Fragment>
            ))}
          </div>
        </ScrollArea>
      </Stack>
    </Center>
  );
}

export function AmpConfigureView({ assignment, ampModel, project, onProjectUpdate }: AmpConfigureViewProps) {
  const channelCount = assignment?.channels.length ?? DEFAULT_SCHEME_CHANNEL_COUNT;
  const [capability, setCapability] = useState<AmpCapability | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(false);

  useEffect(() => {
    if (!ampModel) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    setCapabilityLoading(true);
    commands.ampCapabilityResolve(ampModel.id, assignment?.firmwareVersion ?? null).then((result) => {
      if (cancelled) return;
      setCapabilityLoading(false);
      if (result.status === "ok") {
        setCapability(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ampModel, assignment?.firmwareVersion]);

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

      {TABS.map(({ value, label, skeleton }) => {
        let content: ReactNode;

        if (!CONFIGURABLE_TABS.has(value) || !assignment || !project || !onProjectUpdate) {
          content = <TabSkeleton label={label} variant={skeleton} channelCount={channelCount} />;
        } else if (!ampModel) {
          content = (
            <Center h="100%">
              <Text c="dimmed" size="sm">
                Assign an amp model to configure this device.
              </Text>
            </Center>
          );
        } else if (capabilityLoading || !capability) {
          content = (
            <Center h="100%">
              <Loader size="sm" />
            </Center>
          );
        } else if (value === "sourceSelection") {
          content = (
            <SourceSelectionTab
              assignment={assignment}
              project={project}
              capability={capability}
              onProjectUpdate={onProjectUpdate}
            />
          );
        } else {
          content = (
            <MatrixTab
              assignment={assignment}
              project={project}
              capability={capability}
              onProjectUpdate={onProjectUpdate}
            />
          );
        }

        return (
          <Tabs.Panel key={value} value={value} className="min-h-0">
            {content}
          </Tabs.Panel>
        );
      })}
    </Tabs>
  );
}
