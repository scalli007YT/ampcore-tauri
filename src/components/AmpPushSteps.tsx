import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Group, Loader, Stack, Text } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { Check, Minus, X } from "lucide-react";
import { commands, type AmpEditLock, type AmpPushPlan, type PushStage } from "../lib/bindings";

/** Payload of the Rust `amp_push:progress` event (`AmpPushProgress` in
 * `commands/amp_push.rs`). Declared here rather than imported because specta
 * only exports types a command's signature reaches, and this one is only ever
 * emitted. */
type PushProgress = {
  assignmentId: string;
  stageIndex: number;
  stageId: string;
  state: "running" | "done" | "failed";
  packetsDone: number;
  packetsTotal: number;
};

type StageState = "pending" | "running" | "done" | "failed" | "skipped";

function StageIcon({ state }: { state: StageState }) {
  switch (state) {
    case "running":
      return <Loader size={14} color="amber" />;
    case "done":
      return <Check size={14} strokeWidth={3} className="text-[var(--mantine-color-green-filled)]" />;
    case "failed":
      return <X size={14} strokeWidth={3} className="text-[var(--mantine-color-red-filled)]" />;
    case "skipped":
      return <Minus size={14} className="text-[var(--mantine-color-dimmed)]" />;
    default:
      return (
        <span className="block size-[6px] rounded-full bg-[var(--mantine-color-default-border)]" aria-hidden="true" />
      );
  }
}

/** Right-hand column: how far this stage got, in packets. */
function StageCount({ state, done, total }: { state: StageState; done: number; total: number }) {
  const text =
    state === "running" || (state === "failed" && done > 0) ? `${done}/${total}` : `${total} ${total === 1 ? "write" : "writes"}`;
  const color = state === "failed" ? "red" : state === "done" ? "green" : "dimmed";
  return (
    <Text size="xs" c={color} ff="monospace" className="shrink-0 tabular-nums">
      {text}
    </Text>
  );
}

/** The animated step list for a push: every stage the plan will write, in send
 * order, advancing as `amp_push:progress` arrives.
 *
 * The plan is fetched up front so the list is readable *before* the user
 * commits to the push — it doubles as the preview of what a push would change,
 * including the device-determined fields that travel the other way instead
 * (`AmpPushPlan.adopted`). */
export function AmpPushSteps({
  lock,
  projectId,
  assignmentId,
  running,
  /** Bumped by the parent after every settled attempt, to re-plan against the
   * amp's new state. */
  reloadKey,
}: {
  lock: AmpEditLock | null;
  projectId: string;
  assignmentId: string;
  running: boolean;
  reloadKey: number;
}) {
  const [plan, setPlan] = useState<AmpPushPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { state: StageState; done: number }>>({});
  const [failedIndex, setFailedIndex] = useState<number | null>(null);

  // A plan is only meaningful against a readable online amp; the panel above
  // already explains the other states.
  const plannable = lock?.state === "mismatch" || lock?.state === "matches";
  const liveHash = lock?.live?.ampHash ?? null;

  const load = useCallback(async () => {
    const response = await commands.projectsPlanAmpPush(projectId, assignmentId);
    if (response.status === "error") {
      setPlan(null);
      setPlanError(response.error.message);
      return;
    }
    setPlan(response.data);
    setPlanError(null);
    // A fresh plan is fresh work: keeping the last run's ticks and crosses
    // against it would mark stages that no longer mean the same thing. After
    // a push that stopped partway this is what makes the list read as "what's
    // still left" — the panel above is what reports the failure.
    setProgress({});
    setFailedIndex(null);
  }, [projectId, assignmentId]);

  // Never re-plan mid-push: the writes suppress the FC=27 poll, so a plan
  // built now would diff against a stale snapshot and could drop stages the
  // list is already showing as running.
  useEffect(() => {
    if (!plannable || running) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [plannable, running, liveHash, reloadKey, load]);

  // Cleared on a new attempt, not on every render, so a finished run keeps
  // its checkmarks until the next one starts.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running && !wasRunning.current) {
      setProgress({});
      setFailedIndex(null);
    }
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const stop = await listen<PushProgress>("amp_push:progress", (event) => {
        const update = event.payload;
        if (update.assignmentId !== assignmentId) return;
        setProgress((current) => ({
          ...current,
          [update.stageId]: { state: update.state, done: update.packetsDone },
        }));
        if (update.state === "failed") setFailedIndex(update.stageIndex);
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [assignmentId]);

  if (planError) {
    return (
      <Alert color="red" variant="light" title="Can't plan the push">
        <Text size="sm">{planError}</Text>
      </Alert>
    );
  }
  if (!plan) return null;

  if (plan.stages.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center">
        Nothing to write — every setting the amp can take already matches this project amp.
      </Text>
    );
  }

  // Stages arrive in send order and are already grouped by amp/channel, so
  // consecutive runs of one group become one section.
  const groups: { name: string; stages: { stage: PushStage; index: number }[] }[] = [];
  plan.stages.forEach((stage, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === stage.group) last.stages.push({ stage, index });
    else groups.push({ name: stage.group, stages: [{ stage, index }] });
  });

  const stateFor = (stage: PushStage, index: number): StageState => {
    const reported = progress[stage.id];
    if (reported) return reported.state;
    // Everything after a failure never ran — shown as skipped rather than
    // left looking pending forever.
    if (failedIndex !== null && index > failedIndex) return "skipped";
    return "pending";
  };

  return (
    <Stack gap="xs" className="min-w-0">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>
          Write plan
        </Text>
        <Text size="xs" c="dimmed">
          {plan.stages.length} {plan.stages.length === 1 ? "step" : "steps"} · {plan.packetCount}{" "}
          {plan.packetCount === 1 ? "write" : "writes"}
        </Text>
      </Group>

      {/* Its own scroll container: a full 4-channel push is ~26 rows, which
          must not stretch the modal on a short window. */}
      <div className="max-h-[320px] min-w-0 overflow-y-auto">
        <Stack gap={2} className="min-w-0">
          {groups.map((group) => (
            <Fragment key={`${group.name}-${group.stages[0].index}`}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5} className="px-2 pt-2">
                {group.name}
              </Text>
              {group.stages.map(({ stage, index }) => {
                const state = stateFor(stage, index);
                const done = progress[stage.id]?.done ?? 0;
                const tint =
                  state === "failed"
                    ? "bg-[var(--mantine-color-red-light)]"
                    : state === "running"
                      ? "bg-[var(--mantine-color-amber-light)]"
                      : "";
                return (
                  <Group
                    key={stage.id}
                    gap="xs"
                    wrap="nowrap"
                    className={`min-w-0 rounded-[var(--mantine-radius-sm)] px-2 py-1 transition-colors duration-300 ${tint}`}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <StageIcon state={state} />
                    </span>
                    <Text size="sm" c={state === "skipped" ? "dimmed" : undefined} className="min-w-0 grow truncate">
                      {stage.label}
                    </Text>
                    <StageCount state={state} done={done} total={stage.packets} />
                  </Group>
                );
              })}
            </Fragment>
          ))}
        </Stack>
      </div>

      {plan.adopted.length > 0 && (
        <Alert color="amber" variant="light" title="Taken from the amp instead">
          <Stack gap={4}>
            <Text size="xs">
              The amp can't be told to change these — they describe the hardware itself. Pushing updates the project
              amp to match what the amp reports.
            </Text>
            {plan.adopted.map((row) => (
              <Text key={`${row.group}:${row.label}`} size="xs">
                <Text span fw={500}>
                  {row.group} · {row.label}
                </Text>
                {" — "}
                {row.project ?? "—"} → {row.live ?? "—"}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
