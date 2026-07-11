import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Center,
  Group,
  Loader,
  Menu,
  NumberInput,
  Paper,
  Popover,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ChevronRight,
  CircuitBoard,
  FlipVertical2,
  Route,
  Speaker,
  ShieldAlert,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { EqEditor } from "./EqEditor";
import { LimiterEditor } from "./LimiterEditor";
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type AmpModelCatalogEntry,
  type ChannelSource,
  type Project,
  type SourceChannelCount,
  type SourceKind,
} from "../lib/bindings";

interface AmpConfigureViewProps {
  /** Omitted when configuring a live-discovered device with no project
   * assignment yet (Live Control mode) — see App.tsx's two entry points. */
  assignment?: AmpAssignment;
  ampModel?: AmpModelCatalogEntry;
  /** Needed (alongside `onProjectUpdate`) since every configurable tab's
   * mutation commands take `project.id` as an argument. Omitted in Live
   * Control mode. */
  project?: Project;
  onProjectUpdate?: (project: Project) => void;
}

type SkeletonVariant = "scheme" | "list" | "grid";

const DEFAULT_SCHEME_CHANNEL_COUNT = 4;

const TABS = [
  { value: "scheme", label: "Scheme", icon: CircuitBoard, skeleton: "scheme" },
  { value: "routing", label: "Routing", icon: Route, skeleton: "grid" },
  { value: "input", label: "Input", icon: ArrowDownToLine, skeleton: "list" },
  { value: "output", label: "Output", icon: ArrowUpFromLine, skeleton: "list" },
  {
    value: "speakerConfiguration",
    label: "Speaker Configuration",
    icon: Speaker,
    skeleton: "grid",
  },
  {
    value: "presetConfiguration",
    label: "Preset Configuration",
    icon: SlidersHorizontal,
    skeleton: "list",
  },
] as const satisfies {
  value: string;
  label: string;
  icon: unknown;
  skeleton: SkeletonVariant;
}[];

/** Tabs wired to real capability + persisted values this phase — every other
 * tab keeps rendering `TabSkeleton` as before. */
const CONFIGURABLE_TABS = new Set(["scheme", "routing", "input", "output"]);

const SOURCE_LABELS: Record<SourceKind, string> = {
  analog: "Analog",
  dante: "Dante",
  aes3: "AES3",
  backup: "Backup",
};

/** "Analog 2", not just "Analog" — a model typically exposes several
 * physical inputs per source kind, so the kind alone doesn't identify one. */
function formatSourceLabel(source: ChannelSource | null | undefined): string {
  if (!source) return "No source";
  return `${SOURCE_LABELS[source.kind]} ${source.index + 1}`;
}

/** Source picker for a single channel — a flat list for single-channel
 * kinds (e.g. AES3), a hover sub-menu for multi-channel kinds (e.g. 4
 * physical Analog inputs on a 4-channel amp) so picking "Analog" also picks
 * *which* analog input feeds this channel. */
/** Source picker for a single digital input slot (`channelIndex`). Only
 * patchable kinds (Analog) get a free sub-menu of every physical input —
 * a non-patchable kind (Dante) is hard-wired 1:1 to this slot, so it's a
 * single fixed option ("Dante-N"), not a choice. */
function SourcePicker({
  source,
  sourceCounts,
  channelIndex,
  onSelect,
}: {
  source: ChannelSource | null | undefined;
  sourceCounts: SourceChannelCount[];
  channelIndex: number;
  onSelect: (kind: SourceKind | null, index: number | null) => void;
}) {
  return (
    <Menu shadow="md" width={180} position="bottom-start" withinPortal>
      <Menu.Target>
        <UnstyledButton
          h={52}
          w="100%"
          bdrs="sm"
          bd="1px solid var(--mantine-color-default-border)"
          className="text-center transition-colors duration-150"
        >
          <Text size="sm" c={source ? undefined : "dimmed"}>
            {formatSourceLabel(source)}
          </Text>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onSelect(null, null)}>No source</Menu.Item>
        <Menu.Divider />
        {sourceCounts.map((sc) => {
          if (sc.patchable && sc.channelCount > 1) {
            return (
              <Menu key={sc.kind} trigger="hover" position="right-start" offset={4} shadow="md" withinPortal>
                <Menu.Target>
                  <Menu.Item rightSection={<ChevronRight size={14} />}>{SOURCE_LABELS[sc.kind]}</Menu.Item>
                </Menu.Target>
                <Menu.Dropdown>
                  {Array.from({ length: sc.channelCount }).map((_, i) => (
                    <Menu.Item key={i} onClick={() => onSelect(sc.kind, i)}>
                      {SOURCE_LABELS[sc.kind]} {i + 1}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            );
          }
          // Not patchable (or only ever has one physical channel): a single
          // fixed option, pinned to this slot's own index for non-patchable
          // kinds (e.g. Dante channel N always feeds digital input N).
          const fixedIndex = sc.patchable ? 0 : channelIndex;
          return (
            <Menu.Item key={sc.kind} onClick={() => onSelect(sc.kind, fixedIndex)}>
              {SOURCE_LABELS[sc.kind]} {fixedIndex + 1}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}

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

/** Decorative dBFS bar — a visual stand-in for the old app's live input
 * meter. No live device exists in this offline phase, so it's always shown
 * empty (never fabricates a signal level), matching `MockLevelMeter`'s
 * "decorative only" rule. */
function MockInputMeter() {
  return (
    <Stack gap={2} miw={160} maw={260} className="min-w-0 flex-1">
      <div
        className="h-6 w-full rounded-[var(--mantine-radius-sm)]"
        style={{ backgroundColor: "var(--mantine-color-dark-6)" }}
      />
      <Group gap={0} justify="space-between">
        {[-60, -48, -36, -24, -12, 0].map((value) => (
          <Text key={value} fz={8} c="dimmed">
            {value}
          </Text>
        ))}
      </Group>
    </Stack>
  );
}

/** A small bordered tile matching the Routing tab's crosspoint-cell
 * language — a value/label pair, optionally clickable. */
function InputStatTile({
  value,
  label,
  onClick,
  active,
  activeColor,
  icon,
}: {
  value: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  activeColor?: string;
  icon?: ReactNode;
}) {
  const color = active ? (activeColor ?? "var(--mantine-color-text)") : "var(--mantine-color-dimmed)";
  return (
    <UnstyledButton
      onClick={onClick}
      h={52}
      w={72}
      bdrs="sm"
      bd={`1px solid ${active ? (activeColor ?? "var(--mantine-color-text)") : "var(--mantine-color-default-border)"}`}
      className="shrink-0 text-center transition-colors duration-150"
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <Stack gap={2} align="center" justify="center" h="100%">
        {icon ?? (
          <Text size="sm" fw={700} style={{ color }}>
            {value}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Stack>
    </UnstyledButton>
  );
}

/** Click-to-rename label shared by `InputChannelRow`/`OutputChannelRow` —
 * shows the user-assigned `name` when set, otherwise the default numbered/
 * lettered label. Opens a small `Popover` with a `TextInput` capped at
 * `maxLength` (`AmpParamRanges.channelNameMaxLength`); saving an empty value
 * clears back to the default (`name: null`). */
function RenameableLabel({
  defaultLabel,
  name,
  maxLength,
  onRename,
}: {
  defaultLabel: string;
  name: string | null | undefined;
  maxLength: number;
  onRename: (name: string | null) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState(name ?? "");

  function commit() {
    const trimmed = draft.trim();
    onRename(trimmed.length > 0 ? trimmed : null);
    setOpened(false);
  }

  return (
    <Popover
      opened={opened}
      onChange={(o) => {
        setOpened(o);
        if (o) setDraft(name ?? "");
      }}
      position="bottom-start"
      withArrow
      shadow="md"
      width={220}
    >
      <Popover.Target>
        <UnstyledButton onClick={() => setOpened((o) => !o)}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>
            {name && name.length > 0 ? name : defaultLabel}
          </Text>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
            Rename
          </Text>
          <TextInput
            size="sm"
            value={draft}
            maxLength={maxLength}
            placeholder={defaultLabel}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          <Group gap="xs" justify="flex-end">
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                onRename(null);
                setDraft("");
                setOpened(false);
              }}
            >
              Reset
            </Button>
            <Button size="xs" onClick={commit}>
              Save
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function InputChannelRow({
  channel,
  delayMin,
  delayMax,
  nameMaxLength,
  onDelayChange,
  onMuteToggle,
  onOpenEq,
  onRename,
}: {
  channel: AmpAssignment["channels"][number];
  delayMin: number | null;
  delayMax: number | null;
  nameMaxLength: number;
  onDelayChange: (value: number) => void;
  onMuteToggle: () => void;
  onOpenEq: () => void;
  onRename: (name: string | null) => void;
}) {
  const [delayOpened, setDelayOpened] = useState(false);
  const muted = channel.inputMuted ?? false;
  const delayInMs = channel.delayInMs ?? 0;

  return (
    <div>
      <RenameableLabel
        defaultLabel={`In${channel.channelIndex + 1}`}
        name={channel.inputName}
        maxLength={nameMaxLength}
        onRename={onRename}
      />
      <Group gap="xs" wrap="nowrap" align="center">
        <MockInputMeter />
        <InputStatTile value="---" label="dBFS" />
        <InputStatTile
          value=""
          label="Mute"
          onClick={onMuteToggle}
          active={muted}
          activeColor="var(--mantine-color-red-6)"
          icon={
            muted ? (
              <VolumeX size={16} color="var(--mantine-color-red-6)" />
            ) : (
              <Volume2 size={16} color="var(--mantine-color-dimmed)" />
            )
          }
        />
        <Popover opened={delayOpened} onChange={setDelayOpened} position="bottom" withArrow shadow="md" width={200}>
          <Popover.Target>
            <div>
              <InputStatTile
                value={delayInMs.toFixed(1)}
                label="ms in"
                onClick={() => setDelayOpened((o) => !o)}
                active
              />
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                Input Delay
              </Text>
              <NumberInput
                value={delayInMs}
                min={delayMin ?? undefined}
                max={delayMax ?? undefined}
                step={0.5}
                suffix=" ms"
                onChange={(value) => typeof value === "number" && onDelayChange(value)}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>
        <InputStatTile value="" label="EQ In" onClick={onOpenEq} icon={<Activity size={16} />} />
      </Group>
    </div>
  );
}

/** Per-channel vertical rail — the "third level" tab selector nested inside
 * the Input/Output tabs, alongside the top-level app tabs (now in the title
 * bar) and `AmpConfigureView`'s own tab list. Only shown in a sub-tab whose
 * content is scoped to one channel at a time (e.g. EQ, FIR); the plain
 * Input/Output sub-tab already shows every channel at once, so a channel
 * selector there would be redundant. `labelFor` lets callers keep each
 * axis's own convention — inputs are numbered, outputs are lettered. */
function ChannelRail({
  channels,
  activeChannelIndex,
  onSelectChannel,
  labelFor,
}: {
  channels: AmpAssignment["channels"];
  activeChannelIndex: number;
  onSelectChannel: (channelIndex: number) => void;
  labelFor: (channel: AmpAssignment["channels"][number]) => string;
}) {
  return (
    <Stack
      gap={4}
      p={4}
      w={44}
      justify="center"
      className="shrink-0 overflow-y-auto border-r border-[var(--mantine-color-default-border)]"
    >
      {channels.map((channel) => {
        const isActive = channel.channelIndex === activeChannelIndex;
        return (
          <UnstyledButton
            key={channel.channelIndex}
            onClick={() => onSelectChannel(channel.channelIndex)}
            p={4}
            className={`rounded-[var(--mantine-radius-sm)] border ${
              isActive
                ? "border-[var(--mantine-color-amber-filled)] bg-[var(--mantine-color-amber-light)]"
                : "border-transparent"
            }`}
          >
            <Text fz={11} fw={600} ta="center">
              {labelFor(channel)}
            </Text>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}

function InputTab({ assignment, project, capability, onProjectUpdate }: ConfigurableTabProps) {
  const { min, max } = capability.paramRanges.delayInMs;
  const [eqChannelIndex, setEqChannelIndex] = useState(0);
  const [view, setView] = useState<string | null>("input");
  const eqChannel = assignment.channels.find((c) => c.channelIndex === eqChannelIndex) ?? assignment.channels[0];

  async function handleDelayChange(channelIndex: number, delayInMs: number) {
    const result = await commands.projectsSetChannelDelayIn(project.id, assignment.id, channelIndex, delayInMs);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleMuteToggle(channelIndex: number, muted: boolean) {
    const result = await commands.projectsSetChannelInputMute(project.id, assignment.id, channelIndex, muted);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleRename(channelIndex: number, name: string | null) {
    const result = await commands.projectsSetChannelName(project.id, assignment.id, channelIndex, "input", name);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  function openEq(channelIndex: number) {
    setEqChannelIndex(channelIndex);
    setView("eq");
  }

  return (
    <div className="flex h-full">
      {view === "eq" && (
        <ChannelRail
          channels={assignment.channels}
          activeChannelIndex={eqChannel.channelIndex}
          onSelectChannel={setEqChannelIndex}
          labelFor={(c) => String(c.channelIndex + 1)}
        />
      )}
      <Stack gap={0} className="min-w-0 flex-1">
        <Tabs value={view} onChange={setView} variant="pills" radius="sm">
          <Tabs.List className="justify-center" py={6}>
            <Tabs.Tab value="input">Input</Tabs.Tab>
            <Tabs.Tab value="eq">EQ</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <div className="min-h-0 flex-1">
          {view === "eq" ? (
            <div className="h-full overflow-y-auto">
              <EqEditor
                key={eqChannel.channelIndex}
                assignment={assignment}
                project={project}
                channelIndex={eqChannel.channelIndex}
                direction="input"
                capability={capability}
                onProjectUpdate={onProjectUpdate}
              />
            </div>
          ) : (
            <Center h="100%" p="xl" className="overflow-y-auto">
              <Stack gap="md">
                {assignment.channels.map((channel) => (
                  <InputChannelRow
                    key={channel.channelIndex}
                    channel={channel}
                    delayMin={min}
                    delayMax={max}
                    nameMaxLength={capability.paramRanges.channelNameMaxLength}
                    onDelayChange={(value) => handleDelayChange(channel.channelIndex, value)}
                    onMuteToggle={() => handleMuteToggle(channel.channelIndex, !(channel.inputMuted ?? false))}
                    onOpenEq={() => openEq(channel.channelIndex)}
                    onRename={(name) => handleRename(channel.channelIndex, name)}
                  />
                ))}
              </Stack>
            </Center>
          )}
        </div>
      </Stack>
    </div>
  );
}

function OutputChannelRow({
  channel,
  trimMin,
  trimMax,
  volumeMin,
  volumeMax,
  delayMin,
  delayMax,
  noiseGateThresholdMin,
  noiseGateThresholdMax,
  noiseGateThresholdAdjustable,
  nameMaxLength,
  splitTrimVolume,
  onChange,
  onOpenFir,
  onOpenEq,
  onOpenLimiter,
  onNoiseGateChange,
  onPhaseInvertToggle,
  onRename,
}: {
  channel: AmpAssignment["channels"][number];
  trimMin: number | null;
  trimMax: number | null;
  volumeMin: number | null;
  volumeMax: number | null;
  delayMin: number | null;
  delayMax: number | null;
  noiseGateThresholdMin: number | null;
  noiseGateThresholdMax: number | null;
  noiseGateThresholdAdjustable: boolean;
  nameMaxLength: number;
  splitTrimVolume: boolean;
  onChange: (field: "trim" | "volume" | "delay", value: number) => void;
  onOpenFir: () => void;
  onOpenEq: () => void;
  onOpenLimiter: () => void;
  onNoiseGateChange: (enabled: boolean, thresholdDbu: number) => void;
  onPhaseInvertToggle: () => void;
  onRename: (name: string | null) => void;
}) {
  const [openPopover, setOpenPopover] = useState<"trim" | "volume" | "delay" | "gate" | null>(null);
  const trimDb = channel.outputTrimDb ?? 0;
  const volumeDb = channel.outputVolumeDb ?? 0;
  const delayMs = channel.delayOutMs ?? 0;
  const noiseGateEnabled = channel.noiseGateEnabled ?? false;
  const noiseGateThresholdDbu = channel.noiseGateThresholdDbu ?? 0;
  const phaseInverted = channel.outputPhaseInverted ?? false;

  return (
    <div>
      <RenameableLabel
        defaultLabel={`Out${String.fromCharCode(65 + channel.channelIndex)}`}
        name={channel.outputName}
        maxLength={nameMaxLength}
        onRename={onRename}
      />
      <Group gap="xs" wrap="nowrap" align="center">
        <MockInputMeter />
        <InputStatTile value="" label="FIR" onClick={onOpenFir} icon={<Waves size={16} />} />
        <InputStatTile value="" label="EQ Out" onClick={onOpenEq} icon={<Activity size={16} />} />
        <InputStatTile value="" label="Limiter" onClick={onOpenLimiter} icon={<SlidersHorizontal size={16} />} />
        <InputStatTile
          value=""
          label="Phase"
          onClick={onPhaseInvertToggle}
          active={phaseInverted}
          activeColor="var(--mantine-color-red-6)"
          icon={
            <FlipVertical2
              size={16}
              color={phaseInverted ? "var(--mantine-color-red-6)" : "var(--mantine-color-dimmed)"}
            />
          }
        />
        <Popover
          opened={openPopover === "gate"}
          onChange={(o) => setOpenPopover(o ? "gate" : null)}
          position="bottom"
          withArrow
          shadow="md"
          width={200}
        >
          <Popover.Target>
            <div>
              <InputStatTile
                value=""
                label="Gate"
                onClick={() => setOpenPopover((o) => (o === "gate" ? null : "gate"))}
                active={noiseGateEnabled}
                activeColor="var(--mantine-color-amber-6)"
                icon={
                  <ShieldAlert
                    size={16}
                    color={noiseGateEnabled ? "var(--mantine-color-amber-6)" : "var(--mantine-color-dimmed)"}
                  />
                }
              />
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                Noise Gate
              </Text>
              <Switch
                size="sm"
                label="Enabled"
                checked={noiseGateEnabled}
                onChange={(e) => onNoiseGateChange(e.currentTarget.checked, noiseGateThresholdDbu)}
              />
              {noiseGateThresholdAdjustable && (
                <NumberInput
                  size="sm"
                  value={noiseGateThresholdDbu}
                  min={noiseGateThresholdMin ?? undefined}
                  max={noiseGateThresholdMax ?? undefined}
                  step={0.5}
                  suffix=" dBu"
                  onChange={(value) => typeof value === "number" && onNoiseGateChange(noiseGateEnabled, value)}
                />
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>
        {splitTrimVolume && (
          <Popover
            opened={openPopover === "trim"}
            onChange={(o) => setOpenPopover(o ? "trim" : null)}
            position="bottom"
            withArrow
            shadow="md"
            width={200}
          >
            <Popover.Target>
              <div>
                <InputStatTile
                  value={trimDb.toFixed(1)}
                  label="Trim dB"
                  onClick={() => setOpenPopover((o) => (o === "trim" ? null : "trim"))}
                  active
                />
              </div>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="sm">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                  Output Trim
                </Text>
                <NumberInput
                  value={trimDb}
                  min={trimMin ?? undefined}
                  max={trimMax ?? undefined}
                  step={0.5}
                  suffix=" dB"
                  onChange={(value) => typeof value === "number" && onChange("trim", value)}
                />
              </Stack>
            </Popover.Dropdown>
          </Popover>
        )}
        <Popover
          opened={openPopover === "volume"}
          onChange={(o) => setOpenPopover(o ? "volume" : null)}
          position="bottom"
          withArrow
          shadow="md"
          width={200}
        >
          <Popover.Target>
            <div>
              <InputStatTile
                value={volumeDb.toFixed(1)}
                label={splitTrimVolume ? "Vol dB" : "Level dB"}
                onClick={() => setOpenPopover((o) => (o === "volume" ? null : "volume"))}
                active
              />
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                {splitTrimVolume ? "Output Volume" : "Output Level"}
              </Text>
              <NumberInput
                value={volumeDb}
                min={volumeMin ?? undefined}
                max={volumeMax ?? undefined}
                step={0.5}
                suffix=" dB"
                onChange={(value) => typeof value === "number" && onChange("volume", value)}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>
        <Popover
          opened={openPopover === "delay"}
          onChange={(o) => setOpenPopover(o ? "delay" : null)}
          position="bottom"
          withArrow
          shadow="md"
          width={200}
        >
          <Popover.Target>
            <div>
              <InputStatTile
                value={delayMs.toFixed(1)}
                label="ms out"
                onClick={() => setOpenPopover((o) => (o === "delay" ? null : "delay"))}
                active
              />
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                Output Delay
              </Text>
              <NumberInput
                value={delayMs}
                min={delayMin ?? undefined}
                max={delayMax ?? undefined}
                step={0.5}
                suffix=" ms"
                onChange={(value) => typeof value === "number" && onChange("delay", value)}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </Group>
    </div>
  );
}

function OutputTab({ assignment, project, capability, onProjectUpdate }: ConfigurableTabProps) {
  const trimRange = capability.paramRanges.outputTrimDb;
  const volumeRange = capability.paramRanges.outputVolumeDb;
  const delayRange = capability.paramRanges.delayOutMs;
  const noiseGateThresholdRange = capability.paramRanges.noiseGateThresholdDbu;
  const nameMaxLength = capability.paramRanges.channelNameMaxLength;
  const splitTrimVolume = capability.firmware.splitTrimVolume;
  const noiseGateThresholdAdjustable = capability.firmware.noiseGateThreshold;
  const [subChannelIndex, setSubChannelIndex] = useState(0);
  const [view, setView] = useState<string | null>("output");
  const subChannel =
    assignment.channels.find((c) => c.channelIndex === subChannelIndex) ?? assignment.channels[0];

  async function handleChange(channelIndex: number, field: "trim" | "volume" | "delay", value: number) {
    const result = await commands.projectsSetChannelOutput(
      project.id,
      assignment.id,
      channelIndex,
      field === "trim" ? value : null,
      field === "volume" ? value : null,
      field === "delay" ? value : null,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleNoiseGateChange(channelIndex: number, enabled: boolean, thresholdDbu: number) {
    const result = await commands.projectsSetChannelNoiseGate(
      project.id,
      assignment.id,
      channelIndex,
      enabled,
      thresholdDbu,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handlePhaseInvertToggle(channelIndex: number, inverted: boolean) {
    const result = await commands.projectsSetChannelPhaseInvert(project.id, assignment.id, channelIndex, inverted);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleRename(channelIndex: number, name: string | null) {
    const result = await commands.projectsSetChannelName(project.id, assignment.id, channelIndex, "output", name);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  function openSubTab(channelIndex: number, target: "fir" | "eq" | "limiter") {
    setSubChannelIndex(channelIndex);
    setView(target);
  }

  const letterLabel = (c: AmpAssignment["channels"][number]) => String.fromCharCode(65 + c.channelIndex);

  return (
    <div className="flex h-full">
      {(view === "fir" || view === "eq" || view === "limiter") && (
        <ChannelRail
          channels={assignment.channels}
          activeChannelIndex={subChannel.channelIndex}
          onSelectChannel={setSubChannelIndex}
          labelFor={letterLabel}
        />
      )}
      <Stack gap={0} className="min-w-0 flex-1">
        <Tabs value={view} onChange={setView} variant="pills" radius="sm">
          <Tabs.List className="justify-center" py={6}>
            <Tabs.Tab value="output">Output</Tabs.Tab>
            <Tabs.Tab value="fir">FIR</Tabs.Tab>
            <Tabs.Tab value="eq">EQ</Tabs.Tab>
            <Tabs.Tab value="limiter">Limiter</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <div className="min-h-0 flex-1">
          {view === "fir" ? (
            <Center h="100%">
              <Text c="dimmed" size="sm">
                FIR editor for Out{letterLabel(subChannel)} — coming in a later phase.
              </Text>
            </Center>
          ) : view === "eq" ? (
            <div className="h-full overflow-y-auto">
              <EqEditor
                key={subChannel.channelIndex}
                assignment={assignment}
                project={project}
                channelIndex={subChannel.channelIndex}
                direction="output"
                capability={capability}
                onProjectUpdate={onProjectUpdate}
              />
            </div>
          ) : view === "limiter" ? (
            <Center h="100%" p="xl" className="overflow-y-auto">
              <LimiterEditor
                key={subChannel.channelIndex}
                assignment={assignment}
                project={project}
                channelIndex={subChannel.channelIndex}
                capability={capability}
                onProjectUpdate={onProjectUpdate}
              />
            </Center>
          ) : (
            <Center h="100%" p="xl" className="overflow-y-auto">
              <Stack gap="md">
                {assignment.channels.map((channel) => (
                  <OutputChannelRow
                    key={channel.channelIndex}
                    channel={channel}
                    trimMin={trimRange.min}
                    trimMax={trimRange.max}
                    volumeMin={volumeRange.min}
                    volumeMax={volumeRange.max}
                    delayMin={delayRange.min}
                    delayMax={delayRange.max}
                    noiseGateThresholdMin={noiseGateThresholdRange.min}
                    noiseGateThresholdMax={noiseGateThresholdRange.max}
                    noiseGateThresholdAdjustable={noiseGateThresholdAdjustable}
                    nameMaxLength={nameMaxLength}
                    splitTrimVolume={splitTrimVolume}
                    onChange={(field, value) => handleChange(channel.channelIndex, field, value)}
                    onOpenFir={() => openSubTab(channel.channelIndex, "fir")}
                    onOpenEq={() => openSubTab(channel.channelIndex, "eq")}
                    onOpenLimiter={() => openSubTab(channel.channelIndex, "limiter")}
                    onNoiseGateChange={(enabled, thresholdDbu) =>
                      handleNoiseGateChange(channel.channelIndex, enabled, thresholdDbu)
                    }
                    onPhaseInvertToggle={() =>
                      handlePhaseInvertToggle(channel.channelIndex, !(channel.outputPhaseInverted ?? false))
                    }
                    onRename={(name) => handleRename(channel.channelIndex, name)}
                  />
                ))}
              </Stack>
            </Center>
          )}
        </div>
      </Stack>
    </div>
  );
}

/** Decorative scale + gradient track — a visual stand-in for the old app's
 * live per-output level meter. No live device exists in this offline phase,
 * so this never reflects a real signal; it exists purely to match the
 * reference layout. */
const METER_SCALE_DB = [
  -60, -54, -48, -42, -36, -30, -24, -18, -12, -6, 0, 6, 12, 18,
];
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
      <div
        className="h-2 w-full rounded-sm opacity-60"
        style={{ background: METER_GRADIENT }}
      />
    </Stack>
  );
}

/** One channel's signal-flow summary row on the Scheme tab — same
 * proportions as `SchemeRowSkeleton` (50px / 90px / flex-1 / 160px), filled
 * with real values pulled from Source Selection and the Input/Output tabs.
 * Purely a read-only overview: nothing here is directly editable. */
function SchemeRow({
  channel,
}: {
  channel: AmpAssignment["channels"][number];
}) {
  const sourceLabel = formatSourceLabel(channel.source);
  const ioSummary = `Delay ${channel.delayInMs ?? 0}ms · Trim ${channel.outputTrimDb ?? 0}dB · Vol ${channel.outputVolumeDb ?? 0}dB`;

  return (
    <Group gap="xs" wrap="nowrap" align="stretch">
      <Paper withBorder radius="sm" h={60} w={50}>
        <Center h="100%">
          <Text size="sm" fw={700}>
            {channel.channelIndex + 1}
          </Text>
        </Center>
      </Paper>
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Paper withBorder radius="sm" h={60} w={90}>
        <Center h="100%" p={4}>
          <Text size="sm" ta="center">
            {sourceLabel}
          </Text>
        </Center>
      </Paper>
      <Center>
        <ArrowRight size={14} />
      </Center>
      {/* TODO: speaker assignment once Speaker Configuration ships */}
      <Paper withBorder radius="sm" h={60} className="flex-1">
        <Center h="100%" p={4}>
          <Text size="xs" c="dimmed" ta="center">
            {ioSummary}
          </Text>
        </Center>
      </Paper>
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Center w={160}>
        <MockLevelMeter />
      </Center>
    </Group>
  );
}

function SchemeTab({ assignment }: ConfigurableTabProps) {
  return (
    <Stack h="100%" p="xl" gap="md">
      <Text fw={600}>Scheme</Text>
      <Stack gap="lg" className="flex-1" justify="center">
        {assignment.channels.map((channel) => (
          <SchemeRow key={channel.channelIndex} channel={channel} />
        ))}
      </Stack>
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
  onHoverChange,
}: {
  active: boolean;
  gainDb: number;
  min: number | null;
  max: number | null;
  onGainChange: (gainDb: number) => void;
  onActiveChange: (active: boolean) => void;
  onHoverChange: (hovering: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom"
      withArrow
      shadow="md"
      width={200}
    >
      <Popover.Target>
        <UnstyledButton
          onClick={() => setOpened((o) => !o)}
          onMouseEnter={() => {
            setHovered(true);
            onHoverChange(true);
          }}
          onMouseLeave={() => {
            setHovered(false);
            onHoverChange(false);
          }}
          h={52}
          bdrs="sm"
          bd={`1px solid var(--mantine-color-${active ? "text" : "default-border"})`}
          bg={hovered ? "var(--mantine-color-default-hover)" : undefined}
          className="text-center transition-colors duration-150"
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
            onChange={(value) =>
              typeof value === "number" && onGainChange(value)
            }
          />
          <Button
            fullWidth
            variant={active ? "filled" : "default"}
            onClick={() => onActiveChange(!active)}
          >
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

/** Combines Source Selection and Matrix into one page: each channel row
 * picks its physical source and sets its matrix crosspoints side by side,
 * since both are "what feeds this channel" decisions a user makes together
 * when wiring up a routing scheme. */
function RoutingTab({
  assignment,
  project,
  capability,
  onProjectUpdate,
}: ConfigurableTabProps) {
  const { min, max } = capability.paramRanges.matrixGainDb;
  const sourceCount = capability.topology.matrixInputCount;
  const sourceCounts = capability.topology.sourceCounts;
  const [hoveredCell, setHoveredCell] = useState<{
    channelIndex: number;
    sourceIndex: number;
  } | null>(null);

  async function handleSourceChange(
    channelIndex: number,
    kind: SourceKind | null,
    index: number | null,
  ) {
    const result = await commands.projectsSetChannelSource(
      project.id,
      assignment.id,
      channelIndex,
      kind,
      index,
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleGainChange(
    channelIndex: number,
    sourceIndex: number,
    gainDb: number,
  ) {
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

  async function handleActiveChange(
    channelIndex: number,
    sourceIndex: number,
    active: boolean,
  ) {
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
        <Text fw={600}>Routing</Text>
        <ScrollArea>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `20px 150px 28px repeat(${sourceCount}, 88px) 230px`,
              alignItems: "center",
              columnGap: 12,
              rowGap: 8,
            }}
          >
            <div />
            <div />
            <div />
            <Text
              size="xs"
              c="dimmed"
              ta="center"
              fw={600}
              style={{ gridColumn: `span ${sourceCount}` }}
            >
              Input
            </Text>
            <div />

            <div />
            <Text size="xs" c="dimmed" ta="center">
              Source
            </Text>
            <div />
            {Array.from({ length: sourceCount }).map((_, i) => {
              const highlighted = hoveredCell?.sourceIndex === i;
              return (
                <Stack key={i} gap={6} align="center">
                  <Text
                    size="sm"
                    ta="center"
                    style={{
                      color: highlighted
                        ? "var(--mantine-color-text)"
                        : "var(--mantine-color-dimmed)",
                      transition: "color 150ms ease",
                    }}
                  >
                    {i + 1}
                  </Text>
                  <div
                    style={{
                      width: 20,
                      height: 2,
                      borderRadius: 1,
                      backgroundColor: "var(--mantine-color-text)",
                      opacity: highlighted ? 1 : 0,
                      transition: "opacity 150ms ease",
                    }}
                  />
                </Stack>
              );
            })}
            <Text size="xs" c="dimmed" ta="center">
              Output
            </Text>

            {assignment.channels.map((channel) => {
              const highlighted =
                hoveredCell?.channelIndex === channel.channelIndex;
              return (
                <Fragment key={channel.channelIndex}>
                  <Text size="sm" c="dimmed">
                    {channel.channelIndex + 1}
                  </Text>
                  <SourcePicker
                    source={channel.source}
                    sourceCounts={sourceCounts}
                    channelIndex={channel.channelIndex}
                    onSelect={(kind, index) =>
                      handleSourceChange(channel.channelIndex, kind, index)
                    }
                  />
                  <div />
                  {/* Indexed by column (sourceCount), not by the raw stored
                   * array — keeps the grid's column count authoritative even
                   * if a project's stored crosspoints haven't been
                   * reconciled to the current topology yet. */}
                  {Array.from({ length: sourceCount }).map((_, sourceIndex) => {
                    const crosspoint = channel.matrixCrosspoints?.find(
                      (c) => c.sourceIndex === sourceIndex,
                    ) ?? {
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
                        onGainChange={(value) =>
                          handleGainChange(
                            channel.channelIndex,
                            sourceIndex,
                            value,
                          )
                        }
                        onActiveChange={(value) =>
                          handleActiveChange(
                            channel.channelIndex,
                            sourceIndex,
                            value,
                          )
                        }
                        onHoverChange={(hovering) =>
                          setHoveredCell(
                            hovering
                              ? {
                                  channelIndex: channel.channelIndex,
                                  sourceIndex,
                                }
                              : null,
                          )
                        }
                      />
                    );
                  })}
                  <Group gap={8} wrap="nowrap" align="center">
                    <Group gap={8} wrap="nowrap" align="center">
                      <div
                        style={{
                          width: 2,
                          height: 20,
                          borderRadius: 1,
                          backgroundColor: "var(--mantine-color-text)",
                          opacity: highlighted ? 1 : 0,
                          transition: "opacity 150ms ease",
                        }}
                      />
                      <Text
                        size="sm"
                        fw={600}
                        style={{
                          color: highlighted
                            ? "var(--mantine-color-text)"
                            : "var(--mantine-color-dimmed)",
                          transition: "color 150ms ease",
                        }}
                      >
                        {String.fromCharCode(65 + channel.channelIndex)}
                      </Text>
                    </Group>
                    <MockLevelMeter />
                  </Group>
                </Fragment>
              );
            })}
          </div>
        </ScrollArea>
      </Stack>
    </Center>
  );
}

const TAB_COMPONENTS: Record<
  string,
  (props: ConfigurableTabProps) => ReactNode
> = {
  scheme: SchemeTab,
  routing: RoutingTab,
  input: InputTab,
  output: OutputTab,
};

export function AmpConfigureView({
  assignment,
  ampModel,
  project,
  onProjectUpdate,
}: AmpConfigureViewProps) {
  const channelCount =
    assignment?.channels.length ?? DEFAULT_SCHEME_CHANNEL_COUNT;
  const [capability, setCapability] = useState<AmpCapability | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(false);

  useEffect(() => {
    if (!ampModel) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    setCapabilityLoading(true);
    commands
      .ampCapabilityResolve(ampModel.id, assignment?.firmwareVersion ?? null)
      .then((result) => {
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
          <Tooltip
            key={value}
            label={label}
            position="right"
            withArrow
            openDelay={300}
          >
            <Tabs.Tab value={value} aria-label={label}>
              <Icon size={18} />
            </Tabs.Tab>
          </Tooltip>
        ))}
      </Tabs.List>

      {TABS.map(({ value, label, skeleton }) => {
        let content: ReactNode;

        if (
          !CONFIGURABLE_TABS.has(value) ||
          !assignment ||
          !project ||
          !onProjectUpdate
        ) {
          content = (
            <TabSkeleton
              label={label}
              variant={skeleton}
              channelCount={channelCount}
            />
          );
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
        } else {
          const TabComponent = TAB_COMPONENTS[value];
          content = (
            <TabComponent
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
