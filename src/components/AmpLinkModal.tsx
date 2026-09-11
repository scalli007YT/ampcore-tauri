import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { Check, Link, Network, Server, X } from "lucide-react";
import {
  commands,
  type AmpAssignment,
  type AmpLinkCheckKind,
  type AmpLinkValidation,
  type AmpModelCatalogEntry,
  type DiscoveredDevice,
  type Project,
} from "../lib/bindings";
import { AMP_LINK_STATUS_META, ampLinkStatus, linkedDeviceFor } from "../lib/ampLinkStatus";
import { useIsCompact, useIsTight } from "../lib/breakpoints";

interface AmpLinkModalProps {
  project: Project;
  assignment: AmpAssignment | null;
  displayName: string;
  modelName: string | null;
  devices: DiscoveredDevice[];
  devicesReady: boolean;
  onProjectUpdate: (project: Project) => void;
  onClose: () => void;
}

const CHECK_LABELS: Record<AmpLinkCheckKind, string> = {
  deviceOnline: "Online",
  modelDetected: "Model detected",
  modelMatches: "Model",
  firmwareMatches: "Firmware",
  notLinkedElsewhere: "Not in use",
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>
      {children}
    </Text>
  );
}

/** Same dot as the Workspace amp cards, plus a text label. */
function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap" className="shrink-0">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--mantine-color-${color}-filled)` }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ff={mono ? "monospace" : undefined} truncate>
        {value}
      </Text>
    </div>
  );
}

/** Catalog model per discovered device id, resolved exactly like Live Control's
 * model select (`deviceModelLinkAutoMatch`: a manual pick wins, otherwise the
 * firmware-string match). Only resolves while `enabled`, and only for device
 * ids it hasn't resolved yet. */
function useDetectedModels(devices: DiscoveredDevice[], enabled: boolean) {
  const [models, setModels] = useState<Record<string, AmpModelCatalogEntry | null>>({});
  const pendingKey = devices
    .filter((d) => !(d.id in models))
    .map((d) => d.id)
    .join(",");

  useEffect(() => {
    if (!enabled || !pendingKey) return;
    for (const device of devices.filter((d) => !(d.id in models))) {
      commands
        .deviceModelLinkAutoMatch(device.mac, device.firmwareVersion, device.digitalInputChannels, device.outputChannels)
        .then((result) => {
          setModels((prev) => ({ ...prev, [device.id]: result.status === "ok" ? result.data : null }));
        });
    }
    // `pendingKey` stands in for `devices`, whose identity changes on every discovery tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pendingKey]);

  return models;
}

type StripState = "idle" | "validating" | "compatible" | "incompatible";

/** `[project amp] ——— node ——— [network amp]`. On a compatible result the
 * connector fills green left→right and a check pops in; `animationKey`
 * replays that whenever a different device is validated. */
function LinkMatchStrip({ state, animationKey }: { state: StripState; animationKey: string }) {
  const compatible = state === "compatible";
  const iconColor = compatible ? "green" : "gray";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <ThemeIcon variant="light" color={iconColor} size={36} className="shrink-0 transition-colors">
        <Server size={18} />
      </ThemeIcon>

      <div className="relative h-7 min-w-0 flex-1">
        <div
          className={`absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden ${
            state === "idle" ? "" : "h-0.5 rounded-full bg-[var(--mantine-color-default-border)]"
          }`}
          // Full shorthand, not `border-t-2 border-dashed`: without Tailwind's preflight the
          // other sides would fall back to a `medium` width and draw a second dashed line.
          style={state === "idle" ? { borderTop: "2px dashed var(--mantine-color-default-border)" } : undefined}
        >
          {state === "validating" && (
            <div
              className="absolute inset-y-0 left-0 w-1/4 animate-[link-shimmer_1.1s_linear_infinite] motion-reduce:animate-none"
              style={{ background: "linear-gradient(90deg, transparent, var(--mantine-color-gray-5), transparent)" }}
            />
          )}
          {compatible && (
            <div
              key={animationKey}
              className="absolute inset-0 origin-left animate-[link-fill_500ms_ease-out_both] bg-[var(--mantine-color-green-filled)] motion-reduce:animate-none"
            />
          )}
          {state === "incompatible" && <div className="absolute inset-0 bg-[var(--mantine-color-red-filled)]" />}
        </div>

        {(compatible || state === "incompatible") && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              key={animationKey}
              className={`flex size-7 items-center justify-center rounded-full motion-reduce:animate-none ${
                compatible
                  ? "animate-[link-pop_320ms_ease-out_450ms_both] bg-[var(--mantine-color-green-filled)]"
                  : "animate-[link-pop_240ms_ease-out_both] bg-[var(--mantine-color-red-filled)]"
              }`}
            >
              {compatible ? <Check size={16} strokeWidth={3} color="white" /> : <X size={16} strokeWidth={3} color="white" />}
            </div>
          </div>
        )}
      </div>

      <ThemeIcon variant="light" color={iconColor} size={36} className="shrink-0 transition-colors">
        <Network size={18} />
      </ThemeIcon>
    </div>
  );
}

/** Project amp (left) vs. amps found on the network (right). Selecting a network
 * amp runs the Rust compatibility checks (`projects_validate_amp_link`); Assign
 * writes its MAC to the project amp, Unlink clears it. Only the link itself is
 * written here — matching offline and online config happens in the editor. */
export function AmpLinkModal({
  project,
  assignment,
  displayName,
  modelName,
  devices,
  devicesReady,
  onProjectUpdate,
  onClose,
}: AmpLinkModalProps) {
  const compact = useIsCompact();
  const tight = useIsTight();

  const status = AMP_LINK_STATUS_META[assignment ? ampLinkStatus(assignment, devices) : "unlinked"];
  const linkedDevice = assignment ? linkedDeviceFor(assignment, devices) : undefined;
  const detectedModels = useDetectedModels(devices, assignment !== null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ deviceId: string; result: AmpLinkValidation } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedDevice = devices.find((d) => d.id === selectedId);

  // Fresh state per opened amp; preselect its linked device when there is one.
  useEffect(() => {
    setSelectedId(linkedDevice?.id ?? null);
    setValidation(null);
    setValidationError(null);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id]);

  // Everything the checks read: selection, its online state, and every
  // project amp's model/firmware/MAC ("not linked elsewhere").
  const validationKey = [
    selectedId,
    selectedDevice?.online,
    detectedModels[selectedId ?? ""]?.id,
    ...project.ampAssignments.map((a) => `${a.id}:${a.ampModelId}:${a.firmwareVersion}:${a.mac}`),
  ].join("|");

  useEffect(() => {
    if (!assignment || !selectedId) return;
    let cancelled = false;
    const deviceId = selectedId;
    commands.projectsValidateAmpLink(project.id, assignment.id, deviceId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setValidation({ deviceId, result: result.data });
        setValidationError(null);
      } else {
        setValidation(null);
        setValidationError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
    // `validationKey` stands in for the project/device objects, whose identity changes constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, assignment?.id, validationKey]);

  function selectDevice(id: string) {
    setSelectedId(id);
    setValidationError(null);
    setActionError(null);
  }

  // A re-validation of the same device keeps showing its last result instead of
  // flashing back to "checking", so the animation only plays on a new selection.
  const result = validation && validation.deviceId === selectedId ? validation.result : null;
  const stripState: StripState = !selectedId
    ? "idle"
    : validationError
      ? "incompatible"
      : !result
        ? "validating"
        : result.compatible
          ? "compatible"
          : "incompatible";
  const alreadyLinked = !!selectedId && selectedId === linkedDevice?.id;
  const failedCount = result?.checks.filter((c) => !c.passed).length ?? 0;

  const caption =
    stripState === "idle"
      ? "Select a network amp to check compatibility"
      : stripState === "validating"
        ? "Checking compatibility…"
        : stripState === "compatible"
          ? alreadyLinked
            ? "Linked to this amp"
            : "Compatible"
          : validationError
            ? "Could not check compatibility"
            : `Not compatible — ${failedCount} ${failedCount === 1 ? "check" : "checks"} failed`;
  const captionColor = stripState === "compatible" ? "green" : stripState === "incompatible" ? "red" : "dimmed";

  async function handleAssign() {
    if (!assignment || !selectedId) return;
    setBusy("link");
    setActionError(null);
    const response = await commands.projectsLinkAmp(project.id, assignment.id, selectedId);
    setBusy(null);
    if (response.status === "ok") onProjectUpdate(response.data);
    else setActionError(response.error.message);
  }

  async function handleUnlink() {
    if (!assignment) return;
    setBusy("unlink");
    setActionError(null);
    const response = await commands.projectsUnlinkAmp(project.id, assignment.id);
    setBusy(null);
    if (response.status === "ok") onProjectUpdate(response.data);
    else setActionError(response.error.message);
  }

  return (
    <Modal opened={assignment !== null} onClose={onClose} title="Link Amp" size="xl" centered fullScreen={compact}>
      <div className={`flex min-w-0 ${tight ? "flex-col gap-4" : "flex-row items-stretch gap-5"}`}>
        {/* Project amp */}
        <Stack gap="sm" className="min-w-0 flex-1 basis-0">
          <SectionLabel>Project Amp</SectionLabel>
          <Card withBorder padding="md">
            <Group wrap="nowrap" gap="sm">
              <ThemeIcon variant="light" color="gray" size={40}>
                <Server size={20} />
              </ThemeIcon>
              <div className="min-w-0 flex-1">
                <Text fw={600} truncate>
                  {displayName}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {modelName ?? "No model"}
                </Text>
              </div>
              <StatusDot color={status.color} label={status.label} />
            </Group>
            <Divider my="md" />
            <SimpleGrid cols={2} spacing="md" verticalSpacing="md">
              <Field label="Firmware" value={assignment?.firmwareVersion ?? "—"} />
              <Field label="Outputs" value={assignment?.channels.length ?? "—"} />
              <Field label="MAC" value={assignment?.mac ?? "Not linked"} mono={!!assignment?.mac} />
              <Field label="IP" value={linkedDevice?.ip ?? "—"} mono={!!linkedDevice} />
            </SimpleGrid>
          </Card>
        </Stack>

        <Divider orientation={tight ? "horizontal" : "vertical"} />

        {/* Network amps */}
        <Stack gap="sm" className="min-w-0 flex-1 basis-0">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <SectionLabel>Network Amps</SectionLabel>
            {devices.length > 0 && (
              <Badge variant="default" size="sm" radius="sm">
                {devices.length}
              </Badge>
            )}
          </Group>
          {devices.length === 0 ? (
            <Stack
              align="center"
              justify="center"
              gap="xs"
              mih={140}
              className="rounded-[var(--mantine-radius-sm)] border border-dashed border-[var(--mantine-color-default-border)]"
            >
              <Loader size="xs" />
              <Text c="dimmed" size="sm" ta="center">
                {devicesReady ? "Scanning the network…" : "Starting discovery…"}
              </Text>
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={compact ? undefined : 360}>
              <Stack gap="xs">
                {devices.map((d) => {
                  const isLinked = d.id === linkedDevice?.id;
                  const isSelected = d.id === selectedId;
                  const detected = detectedModels[d.id];
                  const modelLabel =
                    detected === undefined ? "Detecting…" : detected ? `${detected.brand} ${detected.model}` : "Unknown model";
                  return (
                    <UnstyledButton
                      key={d.id}
                      onClick={() => selectDevice(d.id)}
                      aria-pressed={isSelected}
                      className="block w-full"
                    >
                      <Card
                        withBorder
                        padding="sm"
                        className={`transition-colors ${
                          isSelected
                            ? "border-[var(--mantine-color-amber-filled)] bg-[var(--mantine-color-amber-light)]"
                            : "hover:border-[var(--mantine-color-gray-6)]"
                        }`}
                      >
                        <Group justify="space-between" wrap="nowrap" gap="sm">
                          <div className="min-w-0 flex-1">
                            <Group gap={6} wrap="nowrap">
                              <Text fw={500} size="sm" truncate>
                                {d.name || d.mac}
                              </Text>
                              {isLinked && (
                                <Badge size="xs" variant="light" color="green" className="shrink-0">
                                  Linked
                                </Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed" truncate>
                              {modelLabel} · {d.ip} · {d.firmwareFamily ?? "unknown"}
                            </Text>
                          </div>
                          <StatusDot color={d.online ? "green" : "red"} label={d.online ? "Online" : "Offline"} />
                        </Group>
                      </Card>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </div>

      {/* Match row */}
      <Divider my="md" />
      <Stack gap="sm" className="min-w-0">
        <LinkMatchStrip state={stripState} animationKey={`${selectedId}:${stripState}`} />
        <Text size="sm" fw={500} ta="center" c={captionColor}>
          {caption}
        </Text>

        {result && (
          <Stack gap={6} className="min-w-0">
            {result.checks.map((check) => (
              <Group key={check.kind} gap={8} wrap="nowrap" align="flex-start" className="min-w-0">
                <ThemeIcon size={16} radius="xl" variant="light" color={check.passed ? "green" : "red"} className="mt-px shrink-0">
                  {check.passed ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                </ThemeIcon>
                <Text size="xs" fw={500} w={104} className="shrink-0">
                  {CHECK_LABELS[check.kind]}
                </Text>
                <Text size="xs" c="dimmed" className="min-w-0">
                  {check.detail}
                </Text>
              </Group>
            ))}
          </Stack>
        )}

        {(validationError || actionError) && (
          <Alert color="red" variant="light">
            {actionError ?? validationError}
          </Alert>
        )}

        <Group justify="flex-end" gap="xs" wrap="wrap">
          {assignment?.mac && (
            <Button variant="default" loading={busy === "unlink"} disabled={busy === "link"} onClick={handleUnlink}>
              Unlink
            </Button>
          )}
          <Button
            color="green"
            leftSection={alreadyLinked ? <Check size={14} /> : <Link size={14} />}
            loading={busy === "link"}
            disabled={stripState !== "compatible" || alreadyLinked || busy === "unlink"}
            onClick={handleAssign}
          >
            {alreadyLinked ? "Linked" : "Assign"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
