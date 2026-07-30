import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  NumberInput,
  Paper,
  Popover,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
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
  Link2,
  Route,
  Speaker,
  ShieldAlert,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import { EqEditor } from "./EqEditor";
import { LimiterEditor } from "./LimiterEditor";
import { LoadSpeakerConfigDialog } from "./LoadSpeakerConfigDialog";
import { SpeakerFormModal } from "./SpeakerFormModal";
import { DEFAULT_LEVEL_GRADIENT, VuMeter, type VuMeterMark } from "./VuMeter";
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type AmpModelCatalogEntry,
  type ChannelConfigSnapshot,
  type ChannelSource,
  type DiscoveredDevice,
  type PowerMode,
  type Project,
  type SourceChannelCount,
  type SourceKind,
  type SpeakerLibraryEntry_Serialize as SpeakerLibraryEntry,
} from "../lib/bindings";
import {
  createProjectConfigureActions,
  PROJECT_CONFIGURE_CAPABILITIES,
  type ConfigureActions,
  type ConfigureCapabilities,
} from "../lib/configureActions";
import {
  buildLiveAssignmentViewModel,
  createLiveConfigureActions,
  LIVE_CONFIGURE_CAPABILITIES,
} from "../lib/liveConfigureAdapter";

/** Which project (persisted) or live device (Direct Edit, no project) this
 * Configure screen instance targets — the single seam that lets the same
 * capability-driven tab UI serve both modes (see `configureActions.ts`/
 * `liveConfigureAdapter.ts`). */
export type ConfigureSource =
  | {
      kind: "project";
      project: Project;
      assignment: AmpAssignment;
      ampModel?: AmpModelCatalogEntry;
      onProjectUpdate: (project: Project) => void;
    }
  | {
      kind: "live";
      device: DiscoveredDevice;
      channelConfig?: ChannelConfigSnapshot;
      ampModel?: AmpModelCatalogEntry;
    };

interface AmpConfigureViewProps {
  /** Omitted while a Project/live device hasn't been picked yet. */
  source?: ConfigureSource;
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
    skeleton: "list",
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
const CONFIGURABLE_TABS = new Set(["scheme", "routing", "input", "output", "speakerConfiguration"]);

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
  capability: AmpCapability;
  /** Every Speaker Library entry (including archived ones — see
   * `formatSpeakerAssignment`), fetched once by `AmpConfigureView` and
   * shared across every tab rather than each tab re-fetching its own copy
   * (mirrors how `capability` is fetched once and shared). */
  speakers: SpeakerLibraryEntry[];
  /** Refreshes the shared `speakers` list — used by the Speaker
   * Configuration tab's Library panel (Add/Edit/Archive/Refresh), which
   * absorbs full Speaker Library CRUD now that the standalone top-level
   * Speaker Library tab is gone. */
  onSpeakersUpdate: (speakers: SpeakerLibraryEntry[]) => void;
  /** Every mutation a tab can make, targeting either a Project or a live
   * device — see `configureActions.ts`. Fields with no write support for
   * the current source (Project-only concepts, or live writes not built
   * yet) are simply absent; a handler guards with `if (!actions.setX)
   * return;` rather than assuming every field is always writable. */
  actions: ConfigureActions;
  capabilities: ConfigureCapabilities;
  /** Only defined for a `"project"` source. The Speaker Configuration tab
   * (Project-only — not rendered for a `"live"` source, see the tab-list
   * filter in `AmpConfigureView`) uses these directly rather than through
   * `actions`, since its Join/Bridge/cascade-refresh logic doesn't map onto
   * the generic per-field action shape. */
  project?: Project;
  onProjectUpdate?: (project: Project) => void;
}

/** "Brand Model — WayLabel" for a channel's speaker assignment — shared by
 * the Speaker Configuration tab's own tile and the Scheme tab's read-only
 * summary so the resolution logic (including the single-way-speaker
 * suffix-omission rule) isn't duplicated. Resolves against the *full*
 * speaker list (archived included) so an assignment made before a speaker
 * was archived still displays correctly instead of going blank. */
export function formatSpeakerAssignment(
  speakers: SpeakerLibraryEntry[],
  speakerLibraryId: string | null | undefined,
  wayIndex: number | null | undefined,
): string {
  if (!speakerLibraryId) return "No speaker";
  const speaker = speakers.find((s) => s.id === speakerLibraryId);
  if (!speaker) return "No speaker";
  const name = `${speaker.brand} ${speaker.model}`;
  if (speaker.ways.length <= 1) return name;
  const way = speaker.ways[wayIndex ?? 0];
  return way ? `${name} — ${way.label}` : name;
}

/** One row of the Speaker Configuration tab's Physical Outputs panel — a
 * single channel, or an explicitly-Joined multi-channel group (see
 * `AmpChannel.joinGroupId`). */
interface SpeakerOutputGroup {
  leaderChannelIndex: number;
  channelIndexes: number[];
  /** Resolved only when every member channel shares the same non-null
   * `speakerLibraryId` with sequential `wayIndex`es (0, 1, 2…) — the common
   * case (a drag-drop, or a fully-uniform Load). `null` for an unassigned
   * channel/group. */
  speaker: SpeakerLibraryEntry | null;
  /** True when the group has >1 channel but its members do NOT share one
   * uniform sequential assignment (e.g. an explicit Join whose channels
   * hold different or partial speaker data) — rendered per-channel via
   * `formatSpeakerAssignment` on every row instead of one group-wide
   * label/way-list. */
  mixed: boolean;
}

/** Derives `SpeakerOutputGroup`s from `assignment.channels` — grouping
 * itself is purely `joinGroupId`-adjacency (an explicit, persisted concept
 * set via `projectsSetOutputJoin`, independent of what's assigned to member
 * channels); whether a group happens to hold one uniform, sequential
 * speaker assignment (vs. a "mixed" one) is a separate, render-only
 * resolution layered on top. */
function computeSpeakerGroups(
  channels: AmpAssignment["channels"],
  speakers: SpeakerLibraryEntry[],
): SpeakerOutputGroup[] {
  const raw: { leaderChannelIndex: number; channelIndexes: number[] }[] = [];
  for (const channel of channels) {
    const previous = raw[raw.length - 1];
    const previousTailIndex = previous?.channelIndexes[previous.channelIndexes.length - 1];
    const previousTail = channels.find((c) => c.channelIndex === previousTailIndex);
    const continuesPrevious =
      previous !== undefined && previousTail?.joinGroupId != null && channel.joinGroupId === previousTail.joinGroupId;
    if (continuesPrevious) {
      previous.channelIndexes.push(channel.channelIndex);
    } else {
      raw.push({ leaderChannelIndex: channel.channelIndex, channelIndexes: [channel.channelIndex] });
    }
  }
  return raw.map((group) => resolveGroupSpeaker(group, channels, speakers));
}

function resolveGroupSpeaker(
  group: { leaderChannelIndex: number; channelIndexes: number[] },
  channels: AmpAssignment["channels"],
  speakers: SpeakerLibraryEntry[],
): SpeakerOutputGroup {
  const members = group.channelIndexes.map((idx) => channels.find((c) => c.channelIndex === idx)!);
  const first = members[0];
  const speaker = speakers.find((s) => s.id === first.speakerLibraryId) ?? null;
  const uniform =
    speaker !== null && members.every((c, i) => c.speakerLibraryId === speaker.id && (c.wayIndex ?? 0) === i);
  return { ...group, speaker: uniform ? speaker : null, mixed: group.channelIndexes.length > 1 && !uniform };
}

/** dBFS scale for the Input/Output row meters — no live device exists in
 * this offline phase, so every caller passes `value={-60}` (fully unlit),
 * matching the old `MockInputMeter`'s "decorative only" rule. */
const DBFS_MARKS: VuMeterMark[] = [-60, -48, -36, -24, -12, 0].map((value) => ({ value, label: String(value) }));

/** `wide` drops the usual `maxWidth` cap — the Output tab's row layout wants
 * the meter to fill most of the row's width (matching the reference
 * hardware view), unlike the Input tab's compact fixed-width meter. */
function InputDbfsMeter({ disabled, wide }: { disabled?: boolean; wide?: boolean }) {
  return (
    <div className="min-w-0 flex-1" style={{ minWidth: 160, maxWidth: wide ? undefined : 260 }}>
      <VuMeter
        orientation="horizontal"
        min={-60}
        max={0}
        value={-60}
        thickness={24}
        marks={DBFS_MARKS}
        disabled={disabled}
      />
    </div>
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
        <InputDbfsMeter disabled={muted} />
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

function InputTab({ assignment, capability, actions }: ConfigurableTabProps) {
  const { min, max } = capability.paramRanges.delayInMs;
  const [eqChannelIndex, setEqChannelIndex] = useState(0);
  const [view, setView] = useState<string | null>("input");
  const eqChannel = assignment.channels.find((c) => c.channelIndex === eqChannelIndex) ?? assignment.channels[0];

  async function handleDelayChange(channelIndex: number, delayInMs: number) {
    await actions.setChannelDelayIn(channelIndex, delayInMs);
  }

  async function handleMuteToggle(channelIndex: number, muted: boolean) {
    await actions.setChannelInputMute(channelIndex, muted);
  }

  async function handleRename(channelIndex: number, name: string | null) {
    if (!actions.setChannelName) return;
    await actions.setChannelName(channelIndex, "input", name);
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
                channelIndex={eqChannel.channelIndex}
                direction="input"
                capability={capability}
                actions={actions}
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

const POWER_MODE_LABELS: Record<PowerMode, string> = {
  lowOhm: "Low-Ω",
  v70: "70V",
  v100: "100V",
};

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
  powerModes,
  onChange,
  onOpenFir,
  onOpenEq,
  onOpenLimiter,
  onNoiseGateChange,
  onPhaseInvertToggle,
  onPowerModeChange,
  onMuteToggle,
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
  /** Which power/impedance modes the assigned model actually offers — read
   * from `capability.topology.powerModes`, not hardcoded, so a future model
   * that restricts modes is respected automatically. */
  powerModes: PowerMode[];
  onChange: (field: "trim" | "volume" | "delay", value: number) => void;
  onOpenFir: () => void;
  onOpenEq: () => void;
  onOpenLimiter: () => void;
  onNoiseGateChange: (enabled: boolean, thresholdDbu: number) => void;
  onPhaseInvertToggle: () => void;
  onPowerModeChange: (mode: PowerMode) => void;
  onMuteToggle: () => void;
  onRename: (name: string | null) => void;
}) {
  const [openPopover, setOpenPopover] = useState<"trim" | "volume" | "delay" | "gate" | "mode" | null>(null);
  const trimDb = channel.outputTrimDb ?? 0;
  const volumeDb = channel.outputVolumeDb ?? 0;
  const delayMs = channel.delayOutMs ?? 0;
  const noiseGateEnabled = channel.noiseGateEnabled ?? false;
  const noiseGateThresholdDbu = channel.noiseGateThresholdDbu ?? 0;
  const phaseInverted = channel.outputPhaseInverted ?? false;
  const muted = channel.outputMuted ?? false;
  const powerMode = channel.powerMode ?? "lowOhm";

  return (
    <div>
      <RenameableLabel
        defaultLabel={`Out${String.fromCharCode(65 + channel.channelIndex)}`}
        name={channel.outputName}
        maxLength={nameMaxLength}
        onRename={onRename}
      />
      <Group gap="xs" wrap="nowrap" align="center" className="overflow-x-auto">
        <InputDbfsMeter disabled={muted} wide />
        <InputStatTile value="" label="LIM" onClick={onOpenLimiter} icon={<SlidersHorizontal size={16} />} />
        <InputStatTile value="0" label="V" />
        <InputStatTile value="0" label="A" />
        <InputStatTile value="0" label="°C" />
        <InputStatTile value="" label="FIR" onClick={onOpenFir} icon={<Waves size={16} />} />
        <InputStatTile value="" label="EQ Out" onClick={onOpenEq} icon={<Activity size={16} />} />
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
        <InputStatTile
          value=""
          label="Pol"
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
          opened={openPopover === "mode"}
          onChange={(o) => setOpenPopover(o ? "mode" : null)}
          position="bottom"
          withArrow
          shadow="md"
          width={180}
        >
          <Popover.Target>
            <div>
              <InputStatTile
                value={POWER_MODE_LABELS[powerMode]}
                label="Mode"
                onClick={() => setOpenPopover((o) => (o === "mode" ? null : "mode"))}
                active
              />
            </div>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" ta="center">
                Power Mode
              </Text>
              <Select
                size="sm"
                data={powerModes.map((mode) => ({ value: mode, label: POWER_MODE_LABELS[mode] }))}
                value={powerMode}
                allowDeselect={false}
                onChange={(value) => value && onPowerModeChange(value as PowerMode)}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>
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
      </Group>
    </div>
  );
}

/** Per-pair bridge toggle, shown between an output channel pair's leader and
 * follower rows. Same halved-green-tint active-state convention as
 * `ActiveStateButton` (EqEditor.tsx) / `OnOffButton` (LimiterEditor.tsx),
 * rather than inventing a third "on" visual language. */
function BridgeToggle({ label, bridged, onClick }: { label: string; bridged: boolean; onClick: () => void }) {
  return (
    <UnstyledButton
      onClick={onClick}
      w="100%"
      py={6}
      bdrs="sm"
      bd={`1px solid ${bridged ? "color-mix(in srgb, var(--mantine-color-green-light) 50%, transparent)" : "var(--mantine-color-default-border)"}`}
      style={{
        backgroundColor: bridged ? "color-mix(in srgb, var(--mantine-color-green-light) 50%, transparent)" : undefined,
      }}
    >
      <Text size="xs" fw={700} ta="center" c={bridged ? "green" : "dimmed"}>
        {label} — {bridged ? "Bridged" : "Bridge"}
      </Text>
    </UnstyledButton>
  );
}

/** Colored sidebar spanning a bridged output pair's two rows — matches the
 * reference hardware view's rotated `{A}/{B}` `ON`/`OFF` bar. This app has
 * no live status distinct from planned config the way real hardware does,
 * so the sidebar doubles as the toggle control itself (click to flip
 * `output_bridged`) as well as the status display, unlike the reference
 * where the equivalent control lives elsewhere. */
function BridgePairSidebar({
  leaderLetter,
  followerLetter,
  bridged,
  onClick,
}: {
  leaderLetter: string;
  followerLetter: string;
  bridged: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      w={28}
      bdrs="sm"
      bd={`1px solid ${bridged ? "var(--mantine-color-green-6)" : "var(--mantine-color-default-border)"}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bridged ? "color-mix(in srgb, var(--mantine-color-green-light) 50%, transparent)" : undefined,
      }}
    >
      <Text
        size="xs"
        fw={700}
        c={bridged ? "green" : "dimmed"}
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}
      >
        {leaderLetter}/{followerLetter} {bridged ? "ON" : "OFF"}
      </Text>
    </UnstyledButton>
  );
}

function OutputTab({ assignment, capability, actions, capabilities }: ConfigurableTabProps) {
  const trimRange = capability.paramRanges.outputTrimDb;
  const volumeRange = capability.paramRanges.outputVolumeDb;
  const delayRange = capability.paramRanges.delayOutMs;
  const noiseGateThresholdRange = capability.paramRanges.noiseGateThresholdDbu;
  const nameMaxLength = capability.paramRanges.channelNameMaxLength;
  const splitTrimVolume = capability.firmware.splitTrimVolume;
  const noiseGateThresholdAdjustable = capability.firmware.noiseGateThreshold;
  const powerModes = capability.topology.powerModes;
  const [subChannelIndex, setSubChannelIndex] = useState(0);
  const [view, setView] = useState<string | null>("output");
  const subChannel =
    assignment.channels.find((c) => c.channelIndex === subChannelIndex) ?? assignment.channels[0];

  async function handleChange(channelIndex: number, field: "trim" | "volume" | "delay", value: number) {
    await actions.setChannelOutput(
      channelIndex,
      field === "trim" ? value : null,
      field === "volume" ? value : null,
      field === "delay" ? value : null,
    );
  }

  async function handleNoiseGateChange(channelIndex: number, enabled: boolean, thresholdDbu: number) {
    if (!actions.setChannelNoiseGate) return;
    await actions.setChannelNoiseGate(channelIndex, enabled, thresholdDbu);
  }

  async function handlePhaseInvertToggle(channelIndex: number, inverted: boolean) {
    await actions.setChannelPhaseInvert(channelIndex, inverted);
  }

  async function handleRename(channelIndex: number, name: string | null) {
    if (!actions.setChannelName) return;
    await actions.setChannelName(channelIndex, "output", name);
  }

  async function handleMuteToggle(channelIndex: number, muted: boolean) {
    await actions.setChannelOutputMute(channelIndex, muted);
  }

  async function handlePowerModeChange(channelIndex: number, mode: PowerMode) {
    await actions.setChannelPowerMode(channelIndex, mode);
  }

  async function handleBridgeToggle(pairLeaderChannelIndex: number, bridged: boolean) {
    if (!actions.setOutputBridge) return;
    await actions.setOutputBridge(pairLeaderChannelIndex, bridged);
  }

  function openSubTab(channelIndex: number, target: "fir" | "eq" | "limiter") {
    setSubChannelIndex(channelIndex);
    setView(target);
  }

  const letterLabel = (c: AmpAssignment["channels"][number]) => String.fromCharCode(65 + c.channelIndex);

  // Fixed adjacent pairing (0,1), (2,3), … — mirrors the old app's bridging
  // convention. A trailing unpaired channel (odd total count) has no
  // partner and no bridge option, per `AmpChannel.output_bridged`'s doc
  // comment.
  const channelPairs: Array<[AmpAssignment["channels"][number], AmpAssignment["channels"][number] | undefined]> = [];
  for (let i = 0; i < assignment.channels.length; i += 2) {
    channelPairs.push([assignment.channels[i], assignment.channels[i + 1]]);
  }

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
                channelIndex={subChannel.channelIndex}
                direction="output"
                capability={capability}
                actions={actions}
              />
            </div>
          ) : view === "limiter" ? (
            <Center h="100%" p="xl" className="overflow-y-auto">
              <LimiterEditor
                key={subChannel.channelIndex}
                assignment={assignment}
                channelIndex={subChannel.channelIndex}
                capability={capability}
                actions={actions}
                capabilities={capabilities}
              />
            </Center>
          ) : (
            <Center h="100%" p="xl" className="overflow-y-auto">
              <Stack gap="md">
                {channelPairs.map(([leader, follower]) => {
                  const bridged = Boolean(follower && (leader.outputBridged ?? false));
                  const row = (channel: AmpAssignment["channels"][number]) => (
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
                      powerModes={powerModes}
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
                      onPowerModeChange={(mode) => handlePowerModeChange(channel.channelIndex, mode)}
                      onMuteToggle={() => handleMuteToggle(channel.channelIndex, !(channel.outputMuted ?? false))}
                      onRename={(name) => handleRename(channel.channelIndex, name)}
                    />
                  );
                  if (!follower) {
                    return <Fragment key={leader.channelIndex}>{row(leader)}</Fragment>;
                  }
                  return (
                    <Group key={leader.channelIndex} align="stretch" wrap="nowrap" gap="xs">
                      <BridgePairSidebar
                        leaderLetter={letterLabel(leader)}
                        followerLetter={letterLabel(follower)}
                        bridged={bridged}
                        onClick={() => handleBridgeToggle(leader.channelIndex, !bridged)}
                      />
                      <Stack gap="md" className="flex-1 min-w-0">
                        {row(leader)}
                        <div
                          style={{
                            opacity: bridged ? 0.4 : 1,
                            pointerEvents: bridged ? "none" : "auto",
                            filter: bridged ? "grayscale(1)" : "none",
                          }}
                        >
                          {row(follower)}
                        </div>
                      </Stack>
                    </Group>
                  );
                })}
              </Stack>
            </Center>
          )}
        </div>
      </Stack>
    </div>
  );
}

/** Level scale for the Scheme/Routing per-channel meters — no live device
 * exists in this offline phase, so every caller passes `value={-60}`
 * (fully unlit), matching the old `MockLevelMeter`'s "decorative only"
 * rule. */
const LEVEL_MARKS: VuMeterMark[] = [-60, -54, -48, -42, -36, -30, -24, -18, -12, -6, 0, 6, 12, 18].map((value) => ({
  value,
  label: String(value),
}));

function LevelMeter() {
  return (
    <div style={{ minWidth: 160, maxWidth: 200, width: "100%" }}>
      <VuMeter
        orientation="horizontal"
        min={-60}
        max={18}
        value={-60}
        gradient={DEFAULT_LEVEL_GRADIENT}
        backdropOpacity={0.6}
        thickness={8}
        marks={LEVEL_MARKS}
      />
    </div>
  );
}

/** One channel's signal-flow summary row on the Scheme tab — same
 * proportions as `SchemeRowSkeleton` (50px / 90px / flex-1 / 160px), filled
 * with real values pulled from Source Selection and the Input/Output tabs.
 * Purely a read-only overview: nothing here is directly editable. */
function SchemeRow({
  channel,
  speakers,
}: {
  channel: AmpAssignment["channels"][number];
  speakers: SpeakerLibraryEntry[];
}) {
  const sourceLabel = formatSourceLabel(channel.source);
  const speakerLabel = formatSpeakerAssignment(speakers, channel.speakerLibraryId, channel.wayIndex);
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
      <Paper withBorder radius="sm" h={60} className="flex-1">
        <Stack h="100%" gap={2} justify="center" p={4}>
          <Text size="sm" fw={600} ta="center" lineClamp={1}>
            {speakerLabel}
          </Text>
          <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
            {ioSummary}
          </Text>
        </Stack>
      </Paper>
      <Center>
        <ArrowRight size={14} />
      </Center>
      <Center w={160}>
        <LevelMeter />
      </Center>
    </Group>
  );
}

function SchemeTab({ assignment, speakers }: ConfigurableTabProps) {
  return (
    <Stack h="100%" p="xl" gap="md">
      <Text fw={600}>Scheme</Text>
      <Stack gap="lg" className="flex-1" justify="center">
        {assignment.channels.map((channel) => (
          <SchemeRow key={channel.channelIndex} channel={channel} speakers={speakers} />
        ))}
      </Stack>
    </Stack>
  );
}

export const SPEAKER_OUTPUT_LETTER = (channelIndex: number) => String.fromCharCode(65 + channelIndex);

/** One channel's row in the Physical Outputs panel. Every channel gets its
 * own row (not one collapsed row per group) — a group's resolved speaker
 * name renders only on its leader row (blank on continuation rows, a
 * visual rowspan), while each row still shows its own way label. A thin
 * connector renders between two rows belonging to the same joined group
 * (see the caller). Click-to-select (for Split/Reset and Bridge, which act
 * on "the selected row"); a Library row can also be dragged directly onto
 * this row to assign it (native HTML5 drag-and-drop, matching the old
 * software), highlighted via the same amber-accent convention `ChannelRail`
 * uses for its active entry — drag-over uses the same highlight so the
 * drop target is unambiguous. */
function PhysicalOutputChannelRow({
  channel,
  group,
  speakers,
  selected,
  dragOver,
  onSelect,
  onEject,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  channel: AmpAssignment["channels"][number];
  group: SpeakerOutputGroup;
  speakers: SpeakerLibraryEntry[];
  selected: boolean;
  dragOver: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onEject: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const isLeader = group.leaderChannelIndex === channel.channelIndex;
  const positionInGroup = group.channelIndexes.indexOf(channel.channelIndex);
  const wayLabel = group.speaker?.ways[positionInGroup]?.label ?? group.speaker?.ways[0]?.label ?? null;
  const speakerLabel = isLeader && group.speaker ? `${group.speaker.brand} ${group.speaker.model}` : null;
  // In a "mixed" group (an explicit Join whose members don't share one
  // uniform sequential speaker), every row resolves and shows its own
  // assignment instead of relying on a single group-wide label.
  const ownLabel = group.mixed ? formatSpeakerAssignment(speakers, channel.speakerLibraryId, channel.wayIndex) : null;
  const highlighted = selected || dragOver;
  const canEject = group.speaker !== null || group.mixed || group.channelIndexes.length > 1;

  return (
    <UnstyledButton
      onClick={onSelect}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e);
      }}
      w="100%"
      p={8}
      bdrs="sm"
      bd={`1px solid ${highlighted ? "var(--mantine-color-amber-filled)" : "var(--mantine-color-default-border)"}`}
      style={{ backgroundColor: highlighted ? "var(--mantine-color-amber-light)" : undefined }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" c={speakerLabel || ownLabel ? undefined : "dimmed"} lineClamp={1} className="flex-1">
          {speakerLabel ?? ownLabel ?? (isLeader ? "Speaker Model" : "")}
        </Text>
        <Text size="xs" c="dimmed" lineClamp={1} className="flex-1" ta="center">
          {group.mixed ? "-" : (wayLabel ?? "-")}
        </Text>
        <Center w={22} h={22} bdrs="xl" bd="1px solid var(--mantine-color-default-border)" className="shrink-0">
          <Text fz={10} fw={700}>
            {SPEAKER_OUTPUT_LETTER(channel.channelIndex)}
          </Text>
        </Center>
        {isLeader && canEject ? (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              onEject();
            }}
            aria-label={`Clear Out${SPEAKER_OUTPUT_LETTER(channel.channelIndex)}`}
          >
            <X size={12} />
          </ActionIcon>
        ) : (
          <div style={{ width: 28 }} />
        )}
      </Group>
    </UnstyledButton>
  );
}

/** Drag payload MIME type used to drag a Library row onto a Physical
 * Outputs row — plain text carrying the speaker's id. */
const SPEAKER_DRAG_MIME = "application/x-ampcore-speaker-id";

/** Project-only — never rendered for a live-device source (see the tab-list
 * filter in `AmpConfigureView`), so `project`/`onProjectUpdate` are always
 * defined in practice despite being typed optional on `ConfigurableTabProps`
 * for the benefit of the other (dual-mode) tabs. */
function SpeakerConfigurationTab({
  assignment,
  project: projectProp,
  speakers,
  onSpeakersUpdate,
  onProjectUpdate: onProjectUpdateProp,
}: ConfigurableTabProps) {
  const [selectedChannelIndexes, setSelectedChannelIndexes] = useState<number[]>([]);
  const lastClickedChannelRef = useRef<number | null>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [dragOverLeaderIndex, setDragOverLeaderIndex] = useState<number | null>(null);
  const [brandFilter, setBrandFilter] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [waysFilter, setWaysFilter] = useState<string | null>("any");
  const [formEntry, setFormEntry] = useState<SpeakerLibraryEntry | "new" | null>(null);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"assign" | "split" | "join" | "bridge" | "archive" | "delete" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = computeSpeakerGroups(assignment.channels, speakers);
  const selectedGroups = groups.filter((g) => g.channelIndexes.some((idx) => selectedChannelIndexes.includes(idx)));
  const selectedGroup = selectedGroups.length === 1 ? selectedGroups[0] : null;
  const selectedLibraryEntry = speakers.find((s) => s.id === selectedLibraryId) ?? null;
  const sortedSelection = [...selectedChannelIndexes].sort((a, b) => a - b);
  const canJoin = sortedSelection.length >= 2 && sortedSelection.every((v, i) => i === 0 || v === sortedSelection[i - 1] + 1);

  useEffect(() => {
    setConfirmingDeleteId(null);
  }, [selectedLibraryId]);

  if (!projectProp || !onProjectUpdateProp) return null;
  const project = projectProp;
  const onProjectUpdate = onProjectUpdateProp;

  async function refreshLibrary() {
    const result = await commands.speakerLibraryList();
    if (result.status === "ok") {
      onSpeakersUpdate(result.data);
    }
  }

  /** Expands a click on `channelIndex` to its whole current group — a plain
   * click always selects the entire row it lands on. */
  function expandToGroup(channelIndex: number): number[] {
    return groups.find((g) => g.channelIndexes.includes(channelIndex))?.channelIndexes ?? [channelIndex];
  }

  /** Plain click selects the clicked row's whole group; ctrl/cmd-click
   * toggles a group in/out of the selection; shift-click range-selects
   * from the last-clicked channel. Feeds the Join/Split/Bridge actions and
   * the Load dialog's implicit target set. */
  function handleChannelClick(channelIndex: number, e: React.MouseEvent) {
    const grouped = expandToGroup(channelIndex);
    if (e.shiftKey) {
      const anchor =
        lastClickedChannelRef.current ?? selectedChannelIndexes[selectedChannelIndexes.length - 1] ?? channelIndex;
      const lo = Math.min(anchor, channelIndex);
      const hi = Math.max(anchor, channelIndex);
      setSelectedChannelIndexes(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      lastClickedChannelRef.current = channelIndex;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const already = grouped.every((idx) => selectedChannelIndexes.includes(idx));
      setSelectedChannelIndexes(
        already
          ? selectedChannelIndexes.filter((idx) => !grouped.includes(idx))
          : [...new Set([...selectedChannelIndexes, ...grouped])].sort((a, b) => a - b),
      );
      lastClickedChannelRef.current = channelIndex;
      return;
    }
    setSelectedChannelIndexes(grouped);
    lastClickedChannelRef.current = channelIndex;
  }

  /** Runs channel patches one at a time (awaited, not concurrent) — a
   * flood of concurrent per-channel calls was the root cause of a real
   * race-condition bug in the Limiter panel's sliders earlier this session
   * (Peak's floor getting stomped by a stale intermediate value). Only the
   * final successful result is applied to `onProjectUpdate`, so Apply/Split
   * don't flicker through intermediate partially-applied states. Surfaces
   * the first failure instead of silently breaking out of the loop. */
  async function applyChannelPatches(
    patches: { channelIndex: number; speakerLibraryId: string | null; wayIndex: number | null }[],
  ): Promise<{ ok: boolean; error: string | null }> {
    let latest: Project | null = null;
    for (const patch of patches) {
      const result = await commands.projectsSetChannelSpeaker(
        project.id,
        assignment.id,
        patch.channelIndex,
        patch.speakerLibraryId,
        patch.wayIndex,
      );
      if (result.status !== "ok") {
        if (latest) onProjectUpdate(latest);
        return { ok: false, error: result.error.message };
      }
      latest = result.data;
    }
    if (latest) {
      onProjectUpdate(latest);
    }
    return { ok: true, error: null };
  }

  /** Writes `speaker` across as many consecutive channels as it has ways,
   * starting at `group`'s leader — dropped directly onto a Physical
   * Outputs row (native HTML5 drag-and-drop from the Library table,
   * matching the old software), no separate Load/Apply step. Also clears
   * any leftover channels from the group being dropped onto that fall
   * outside the new speaker's span, so replacing e.g. a 3-way with a 1-way
   * doesn't leave orphaned way indices behind. A multi-way drop additionally
   * auto-Joins its span (`projectsSetOutputJoin`) so the quick-drop path
   * keeps looking grouped, exactly as it did before Join grouping became
   * explicit. */
  async function handleDropOnGroup(group: SpeakerOutputGroup, speaker: SpeakerLibraryEntry) {
    const wayCount = Math.max(1, speaker.ways.length);
    const leader = group.leaderChannelIndex;
    if (leader + wayCount > assignment.channels.length) return;
    const newIndexes = Array.from({ length: wayCount }, (_, i) => leader + i);
    const patches = newIndexes.map((channelIndex, i) => ({
      channelIndex,
      speakerLibraryId: speaker.id,
      wayIndex: wayCount > 1 ? i : null,
    }));
    const leftover = group.channelIndexes.filter((idx) => !newIndexes.includes(idx));
    const clearPatches = leftover.map((channelIndex) => ({ channelIndex, speakerLibraryId: null, wayIndex: null }));

    setBusyAction("assign");
    setActionError(null);
    const result = await applyChannelPatches([...patches, ...clearPatches]);
    if (!result.ok) {
      setActionError(result.error);
      setBusyAction(null);
      return;
    }
    if (newIndexes.length > 1) {
      const joinResult = await commands.projectsSetOutputJoin(project.id, assignment.id, newIndexes, true);
      if (joinResult.status === "ok") onProjectUpdate(joinResult.data);
      else setActionError(joinResult.error.message);
    }
    setBusyAction(null);
  }

  function handleDropEvent(group: SpeakerOutputGroup, e: React.DragEvent) {
    setDragOverLeaderIndex(null);
    const speakerId = e.dataTransfer.getData(SPEAKER_DRAG_MIME);
    const speaker = speakers.find((s) => s.id === speakerId);
    if (speaker) handleDropOnGroup(group, speaker);
  }

  function handleSplit() {
    if (!selectedGroup) return;
    ejectGroup(selectedGroup);
  }

  /** Clears assignments for `group`'s channels, and (for a >1-channel
   * group) also clears the explicit Join grouping via
   * `projectsSetOutputJoin`, so Split fully un-groups rather than leaving a
   * now-empty joined row behind. */
  async function ejectGroup(group: SpeakerOutputGroup) {
    setBusyAction("split");
    setActionError(null);
    const patches = group.channelIndexes.map((channelIndex) => ({
      channelIndex,
      speakerLibraryId: null,
      wayIndex: null,
    }));
    const result = await applyChannelPatches(patches);
    if (!result.ok) {
      setActionError(result.error);
      setBusyAction(null);
      return;
    }
    if (group.channelIndexes.length > 1) {
      const joinResult = await commands.projectsSetOutputJoin(project.id, assignment.id, group.channelIndexes, false);
      if (joinResult.status === "ok") onProjectUpdate(joinResult.data);
      else setActionError(joinResult.error.message);
    }
    setBusyAction(null);
    setSelectedChannelIndexes([]);
  }

  /** Joins the current (contiguous) selection into one explicit group.
   * Wipes any existing per-channel assignments on the span first — a fresh
   * Join shouldn't silently inherit stale data, matching the old app's
   * `joinSelected`. */
  async function handleJoin() {
    if (!canJoin) return;
    setBusyAction("join");
    setActionError(null);
    const wipeResult = await applyChannelPatches(
      sortedSelection.map((channelIndex) => ({ channelIndex, speakerLibraryId: null, wayIndex: null })),
    );
    if (!wipeResult.ok) {
      setActionError(wipeResult.error);
      setBusyAction(null);
      return;
    }
    const joinResult = await commands.projectsSetOutputJoin(project.id, assignment.id, sortedSelection, true);
    if (joinResult.status === "ok") {
      onProjectUpdate(joinResult.data);
      setSelectedChannelIndexes(sortedSelection);
    } else {
      setActionError(joinResult.error.message);
    }
    setBusyAction(null);
  }

  async function handleBridgeToggle() {
    if (!selectedGroup) return;
    const leaderChannel = assignment.channels.find((c) => c.channelIndex === selectedGroup.leaderChannelIndex);
    setBusyAction("bridge");
    setActionError(null);
    const result = await commands.projectsSetOutputBridge(
      project.id,
      assignment.id,
      selectedGroup.leaderChannelIndex,
      !(leaderChannel?.outputBridged ?? false),
    );
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    } else {
      setActionError(result.error.message);
    }
    setBusyAction(null);
  }

  async function handleArchive(id: string) {
    setBusyAction("archive");
    setActionError(null);
    const result = await commands.speakerLibraryArchive(id);
    if (result.status === "ok") {
      if (selectedLibraryId === id) setSelectedLibraryId(null);
      onSpeakersUpdate(speakers.map((s) => (s.id === id ? { ...s, archived: true } : s)));
    } else {
      setActionError(result.error.message);
    }
    setBusyAction(null);
  }

  /** Two-click confirm (matches `ProjectEditModal`'s delete idiom) —
   * permanently removes the entry. The backend cascades: any channel across
   * any project referencing this speaker gets cleared server-side, so this
   * assignment's own display is refreshed via `projectsGet` afterward
   * rather than relying on a stale local `onProjectUpdate`. */
  async function handleDelete(id: string) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      return;
    }
    setBusyAction("delete");
    setActionError(null);
    const result = await commands.speakerLibraryDelete(id);
    if (result.status === "ok") {
      if (selectedLibraryId === id) setSelectedLibraryId(null);
      setConfirmingDeleteId(null);
      onSpeakersUpdate(speakers.filter((s) => s.id !== id));
      const projectResult = await commands.projectsGet(project.id);
      if (projectResult.status === "ok" && projectResult.data) onProjectUpdate(projectResult.data);
    } else {
      setActionError(result.error.message);
    }
    setBusyAction(null);
  }

  function handleFormSaved(entry: SpeakerLibraryEntry) {
    onSpeakersUpdate(
      speakers.some((s) => s.id === entry.id)
        ? speakers.map((s) => (s.id === entry.id ? entry : s))
        : [...speakers, entry],
    );
  }

  const canBridge = Boolean(
    selectedGroup &&
      selectedGroup.channelIndexes.length === 1 &&
      selectedGroup.leaderChannelIndex % 2 === 0 &&
      assignment.channels.some((c) => c.channelIndex === selectedGroup.leaderChannelIndex + 1),
  );
  const isBridged = selectedGroup
    ? (assignment.channels.find((c) => c.channelIndex === selectedGroup.leaderChannelIndex)?.outputBridged ?? false)
    : false;
  const assignedGroups = groups.filter(
    (g) => g.speaker !== null || g.channelIndexes.some((idx) => assignment.channels.find((c) => c.channelIndex === idx)?.speakerLibraryId),
  );

  const waysFilterOptions = [
    { value: "any", label: "Any" },
    { value: "1", label: "1" },
    { value: "2", label: "2" },
    { value: "3", label: "3" },
    { value: "4", label: "4+" },
  ];
  const filteredSpeakers = speakers.filter((s) => {
    if (s.archived) return false;
    if (brandFilter && !s.brand.toLowerCase().includes(brandFilter.toLowerCase())) return false;
    if (familyFilter && !(s.family ?? "").toLowerCase().includes(familyFilter.toLowerCase())) return false;
    if (modelFilter && !s.model.toLowerCase().includes(modelFilter.toLowerCase())) return false;
    if (waysFilter && waysFilter !== "any") {
      const n = Number(waysFilter);
      if (n === 4 ? s.ways.length < 4 : s.ways.length !== n) return false;
    }
    return true;
  });

  const canSplit = Boolean(
    selectedGroup && (selectedGroup.speaker !== null || selectedGroup.mixed || selectedGroup.channelIndexes.length > 1),
  );

  return (
    <div className="flex h-full" style={{ gap: 16, padding: 24 }}>
      <Stack gap="sm" h="100%" justify="center" className="flex-1" style={{ flexGrow: 2 }}>
        <Text size="sm" fw={600}>
          Physical Outputs
        </Text>
        <Stack gap={4} className="overflow-y-auto">
          {assignment.channels.map((channel, i) => {
            const group = groups.find((g) => g.channelIndexes.includes(channel.channelIndex))!;
            const nextChannel = assignment.channels[i + 1];
            const connectsToNext = Boolean(nextChannel && group.channelIndexes.includes(nextChannel.channelIndex));
            return (
              <Fragment key={channel.channelIndex}>
                <PhysicalOutputChannelRow
                  channel={channel}
                  group={group}
                  speakers={speakers}
                  selected={selectedChannelIndexes.includes(channel.channelIndex)}
                  dragOver={dragOverLeaderIndex === group.leaderChannelIndex}
                  onSelect={(e) => handleChannelClick(channel.channelIndex, e)}
                  onEject={() => ejectGroup(group)}
                  onDragOver={() => setDragOverLeaderIndex(group.leaderChannelIndex)}
                  onDragLeave={() => setDragOverLeaderIndex((current) => (current === group.leaderChannelIndex ? null : current))}
                  onDrop={(e) => handleDropEvent(group, e)}
                />
                {connectsToNext && (
                  <Center h={10}>
                    <Link2 size={10} color="var(--mantine-color-dimmed)" />
                  </Center>
                )}
              </Fragment>
            );
          })}
        </Stack>
      </Stack>

      <Stack gap="lg" w={150} h="100%" justify="center" className="shrink-0">
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Controls
          </Text>
          <Text size="xs" c="dimmed">
            Drag a Library entry onto a Physical Outputs row, or select multiple outputs (ctrl/shift-click) and Join
            them, then use Load... for per-channel control.
          </Text>
          <Button size="sm" variant="default" loading={busyAction === "split"} disabled={!canSplit} onClick={handleSplit}>
            Split/Reset
          </Button>
          <Button size="sm" variant="default" loading={busyAction === "join"} disabled={!canJoin} onClick={handleJoin}>
            Join
          </Button>
          <div style={{ opacity: canBridge ? 1 : 0.45, pointerEvents: canBridge ? "auto" : "none" }}>
            <BridgeToggle label="Bridge" bridged={isBridged} onClick={handleBridgeToggle} />
          </div>
          {actionError && (
            <Text size="xs" c="red">
              {actionError}
            </Text>
          )}
        </Stack>

        <Stack gap={2}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            Status
          </Text>
          {assignedGroups.length === 0 ? (
            <Text size="xs" c="dimmed">
              No outputs assigned
            </Text>
          ) : (
            assignedGroups.map((g) => (
              <Group key={g.leaderChannelIndex} gap={6} justify="space-between">
                <Text size="xs" fw={600}>
                  Out{SPEAKER_OUTPUT_LETTER(g.leaderChannelIndex)}
                </Text>
                <Text size="xs" c="dimmed">
                  NO CHECKSUM
                </Text>
              </Group>
            ))
          )}
        </Stack>

        <Stack gap="xs">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            Library Actions
          </Text>
          <Button size="xs" variant="default" onClick={() => setFormEntry("new")}>
            Add
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={!selectedLibraryEntry}
            onClick={() => selectedLibraryEntry && setFormEntry(selectedLibraryEntry)}
          >
            Save
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={!selectedLibraryEntry}
            onClick={() => selectedLibraryEntry && setLoadDialogOpen(true)}
          >
            Load...
          </Button>
          <Button
            size="xs"
            variant="default"
            color="red"
            loading={busyAction === "archive"}
            disabled={!selectedLibraryEntry}
            onClick={() => selectedLibraryEntry && handleArchive(selectedLibraryEntry.id)}
          >
            Archive
          </Button>
          <Button
            size="xs"
            variant={confirmingDeleteId === selectedLibraryEntry?.id ? "filled" : "default"}
            color="red"
            loading={busyAction === "delete"}
            disabled={!selectedLibraryEntry}
            onClick={() => selectedLibraryEntry && handleDelete(selectedLibraryEntry.id)}
          >
            {confirmingDeleteId === selectedLibraryEntry?.id ? "Confirm Delete" : "Delete Permanently"}
          </Button>
          <Button size="xs" variant="default" onClick={refreshLibrary}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Stack gap="sm" className="flex-1 min-w-0" style={{ flexGrow: 3 }}>
        <Text size="sm" fw={600}>
          Library
        </Text>
        <Group gap="xs" grow>
          <TextInput size="xs" placeholder="Filter brand" value={brandFilter} onChange={(e) => setBrandFilter(e.currentTarget.value)} />
          <TextInput
            size="xs"
            placeholder="Filter family"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.currentTarget.value)}
          />
          <TextInput size="xs" placeholder="Filter model" value={modelFilter} onChange={(e) => setModelFilter(e.currentTarget.value)} />
          <Select size="xs" label="Ways°" data={waysFilterOptions} value={waysFilter} onChange={setWaysFilter} allowDeselect={false} />
        </Group>
        <Table.ScrollContainer minWidth={420} className="flex-1 overflow-y-auto">
          <Table highlightOnHover verticalSpacing="xs" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Brand</Table.Th>
                <Table.Th>Family</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Application</Table.Th>
                <Table.Th>Ways</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredSpeakers.map((speaker) => (
                <Table.Tr
                  key={speaker.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SPEAKER_DRAG_MIME, speaker.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => setSelectedLibraryId(speaker.id)}
                  className="cursor-pointer"
                  style={{
                    backgroundColor: selectedLibraryId === speaker.id ? "var(--mantine-color-amber-light)" : undefined,
                    cursor: "grab",
                  }}
                >
                  <Table.Td>{speaker.brand}</Table.Td>
                  <Table.Td>{speaker.family ?? <Text component="span" c="dimmed">—</Text>}</Table.Td>
                  <Table.Td>{speaker.model}</Table.Td>
                  <Table.Td>{speaker.application ?? <Text component="span" c="dimmed">—</Text>}</Table.Td>
                  <Table.Td>{speaker.ways.map((w) => w.label).join(", ") || <Text component="span" c="dimmed">—</Text>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <SpeakerFormModal
        opened={formEntry !== null}
        onClose={() => setFormEntry(null)}
        editEntry={formEntry === "new" ? null : formEntry}
        onSaved={handleFormSaved}
      />

      {selectedLibraryEntry && (
        <LoadSpeakerConfigDialog
          opened={loadDialogOpen}
          onClose={() => setLoadDialogOpen(false)}
          assignment={assignment}
          speakers={speakers}
          profile={selectedLibraryEntry}
          onApply={applyChannelPatches}
        />
      )}
    </div>
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
  capability,
  actions,
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
    if (!actions.setChannelSource) return;
    await actions.setChannelSource(channelIndex, kind, index);
  }

  async function handleGainChange(
    channelIndex: number,
    sourceIndex: number,
    gainDb: number,
  ) {
    if (!actions.setMatrixCrosspoint) return;
    await actions.setMatrixCrosspoint(channelIndex, sourceIndex, gainDb, null);
  }

  async function handleActiveChange(
    channelIndex: number,
    sourceIndex: number,
    active: boolean,
  ) {
    if (!actions.setMatrixCrosspoint) return;
    await actions.setMatrixCrosspoint(channelIndex, sourceIndex, null, active);
  }

  return (
    <Center h="100%" p="xl">
      <Stack gap="md" align="center">
        <Text fw={600}>Routing</Text>
        <ScrollArea offsetScrollbars type="auto" scrollbarSize={8}>
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
                    <LevelMeter />
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
  speakerConfiguration: SpeakerConfigurationTab,
};

export function AmpConfigureView({ source }: AmpConfigureViewProps) {
  const ampModel = source?.ampModel;
  const liveChannelCount =
    source?.kind === "live" ? source.device.outputChannels || DEFAULT_SCHEME_CHANNEL_COUNT : DEFAULT_SCHEME_CHANNEL_COUNT;
  const assignment: AmpAssignment | undefined =
    source?.kind === "project"
      ? source.assignment
      : source?.kind === "live"
        ? buildLiveAssignmentViewModel(source.device, source.channelConfig, liveChannelCount)
        : undefined;
  const channelCount = assignment?.channels.length ?? DEFAULT_SCHEME_CHANNEL_COUNT;
  const firmwareVersion =
    source?.kind === "project" ? (source.assignment.firmwareVersion ?? null) : source?.kind === "live" ? source.device.firmwareVersion : null;

  const [capability, setCapability] = useState<AmpCapability | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [speakers, setSpeakers] = useState<SpeakerLibraryEntry[]>([]);

  useEffect(() => {
    if (!ampModel) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    setCapabilityLoading(true);
    commands.ampCapabilityResolve(ampModel.id, firmwareVersion).then((result) => {
      if (cancelled) return;
      setCapabilityLoading(false);
      if (result.status === "ok") {
        setCapability(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ampModel, firmwareVersion]);

  useEffect(() => {
    commands.speakerLibraryList().then((result) => {
      if (result.status === "ok") {
        setSpeakers(result.data);
      }
    });
  }, []);

  const actions: ConfigureActions | undefined =
    source?.kind === "project"
      ? createProjectConfigureActions(source.project.id, source.assignment.id, source.onProjectUpdate)
      : source?.kind === "live"
        ? createLiveConfigureActions(source.device.id)
        : undefined;
  const capabilities: ConfigureCapabilities = source?.kind === "live" ? LIVE_CONFIGURE_CAPABILITIES : PROJECT_CONFIGURE_CAPABILITIES;
  const project = source?.kind === "project" ? source.project : undefined;
  const onProjectUpdate = source?.kind === "project" ? source.onProjectUpdate : undefined;

  // Speaker Configuration is a Project-only planning concept (physical
  // output assignment, Join grouping) with no live-device equivalent — not
  // shown at all for a live source, rather than rendered disabled.
  const visibleTabs = source?.kind === "live" ? TABS.filter((t) => t.value !== "speakerConfiguration") : TABS;

  return (
    <Tabs defaultValue="scheme" orientation="vertical" className="h-full">
      <Tabs.List className="justify-center">
        {visibleTabs.map(({ value, label, icon: Icon }) => (
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

      {visibleTabs.map(({ value, label, skeleton }) => {
        let content: ReactNode;

        if (
          !CONFIGURABLE_TABS.has(value) ||
          !assignment ||
          !actions
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
              capability={capability}
              speakers={speakers}
              onSpeakersUpdate={setSpeakers}
              actions={actions}
              capabilities={capabilities}
              project={project}
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
