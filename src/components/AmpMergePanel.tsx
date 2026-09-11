import { useEffect, useState, type ReactNode } from "react";
import { Button, Loader, SegmentedControl, Stack, Text, ThemeIcon } from "@mantine/core";
import { ArrowLeft, Check, Network, Server, X } from "lucide-react";
import { commands, type AmpEditLock, type AmpMergeResult, type Project } from "../lib/bindings";
import { useHoldToConfirm } from "../hooks/useHoldToConfirm";

const HOLD_MS = 1000;

type Outcome =
  | { kind: "merged"; ampHash: string | null }
  | { kind: "diverged"; count: number }
  | { kind: "error"; message: string };

type StripState = "blocked" | "idle" | "holding" | "pending" | "merged" | "inSync" | "failed";

/** Why the match can't run right now, or `null` when it can (or already did). */
function blockedReason(lock: AmpEditLock | null): string | null {
  if (!lock) return "Comparing the amps…";
  switch (lock.state) {
    case "unlinked":
      return "Link this amp to a network amp first.";
    case "offline":
      return "The linked amp is offline.";
    case "checking":
      return "Waiting for the amp's first settings reading…";
    case "unreadable":
      return lock.unreadable[0] ?? "The amps can't be compared completely yet.";
    default:
      return null;
  }
}

function caption(state: StripState, outcome: Outcome | null, reason: string | null): { text: string; color?: string } {
  switch (state) {
    case "pending":
      return { text: "Copying the online settings and re-checking the fingerprint…" };
    case "merged":
      return {
        text:
          outcome?.kind === "merged" && outcome.ampHash
            ? `Matched — both amps now share ${outcome.ampHash}`
            : "Matched — both amps now share one fingerprint",
        color: "green",
      };
    case "inSync":
      return { text: "The offline amp already matches the online amp.", color: "green" };
    case "failed":
      if (outcome?.kind === "diverged") {
        const noun = outcome.count === 1 ? "setting" : "settings";
        return { text: `${outcome.count} ${noun} couldn't be matched — nothing was saved.`, color: "red" };
      }
      return { text: outcome?.kind === "error" ? outcome.message : "Matching failed.", color: "red" };
    case "blocked":
      return { text: reason ?? "" };
    default:
      return { text: "Hold to copy every online setting into this project amp." };
  }
}

/** One side of the strip. `pulseKey` replays a green ring pulse whenever it
 * changes — used on the offline side, the one that just received data. */
function AmpEnd({ icon, label, color, pulseKey }: { icon: ReactNode; label: string; color: string; pulseKey?: string }) {
  return (
    <Stack gap={4} align="center" className="shrink-0">
      <span
        key={pulseKey}
        className={`rounded-[var(--mantine-radius-sm)] ${
          pulseKey ? "animate-[merge-pulse_900ms_ease-out_450ms_2] motion-reduce:animate-none" : ""
        }`}
      >
        <ThemeIcon variant="light" color={color} size={40} className="transition-colors duration-300">
          {icon}
        </ThemeIcon>
      </span>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}

function CenterNode({ state }: { state: StripState }) {
  const base =
    "flex size-7 items-center justify-center rounded-full border-2 border-solid transition-colors duration-300";
  switch (state) {
    case "pending":
      return (
        <div className={`${base} border-[var(--mantine-color-amber-filled)] bg-[var(--mantine-color-body)]`}>
          <Loader size={12} color="amber" />
        </div>
      );
    case "merged":
      return (
        <div
          className={`${base} animate-[link-pop_320ms_ease-out_450ms_both] border-transparent bg-[var(--mantine-color-green-filled)] motion-reduce:animate-none`}
        >
          <Check size={16} strokeWidth={3} color="white" />
        </div>
      );
    case "inSync":
      return (
        <div className={`${base} border-transparent bg-[var(--mantine-color-green-filled)]`}>
          <Check size={16} strokeWidth={3} color="white" />
        </div>
      );
    case "failed":
      return (
        <div
          className={`${base} animate-[merge-shake_360ms_ease-in-out] border-transparent bg-[var(--mantine-color-red-filled)] motion-reduce:animate-none`}
        >
          <X size={16} strokeWidth={3} color="white" />
        </div>
      );
    default: {
      const tone =
        state === "holding"
          ? "border-[var(--mantine-color-amber-filled)] text-[var(--mantine-color-amber-filled)]"
          : "border-[var(--mantine-color-default-border)] text-[var(--mantine-color-dimmed)]";
      return (
        <div className={`${base} ${tone} bg-[var(--mantine-color-body)]`}>
          <ArrowLeft size={14} strokeWidth={2.5} />
        </div>
      );
    }
  }
}

/** `[offline] ◂◂◂ ── node ── ◂◂◂ [online]`. Every motion runs right to left,
 * the way the data travels: dashes drift toward the offline amp while idle,
 * the hold fills amber from the online side, a shimmer carries the request,
 * and the result fills green (or flashes red). */
function MergeStrip({ state, progress, attempt }: { state: StripState; progress: number; attempt: number }) {
  const green = state === "merged" || state === "inSync";
  const drifting = state === "idle" || state === "holding";

  return (
    <div className="flex w-full max-w-[520px] min-w-0 items-start gap-3">
      <AmpEnd
        icon={<Server size={20} />}
        label="Offline Amp"
        color={green ? "green" : state === "failed" ? "red" : "gray"}
        pulseKey={state === "merged" ? `merged-${attempt}` : undefined}
      />

      <div className="relative mt-1 h-8 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-[var(--mantine-color-default-border)]">
          {drifting && (
            <div
              className="absolute inset-0 animate-[merge-flow_900ms_linear_infinite] opacity-80 motion-reduce:animate-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--mantine-color-gray-5) 0 6px, transparent 6px 18px)",
              }}
            />
          )}
          {/* The hold fill: follows the hook's progress frame by frame while
              held, and eases back on an early release. */}
          <div
            className={`absolute inset-0 origin-right bg-[var(--mantine-color-amber-filled)] ${
              state === "holding" ? "" : "transition-transform duration-200"
            }`}
            style={{ transform: `scaleX(${state === "holding" || state === "idle" ? progress : 0})` }}
          />
          {state === "pending" && (
            <div
              className="absolute inset-y-0 left-0 w-1/4 animate-[merge-shimmer_900ms_linear_infinite] motion-reduce:animate-none"
              style={{
                background: "linear-gradient(90deg, transparent, var(--mantine-color-amber-filled), transparent)",
              }}
            />
          )}
          {state === "merged" && (
            <div
              key={`fill-${attempt}`}
              className="absolute inset-0 origin-right animate-[link-fill_500ms_ease-out_both] bg-[var(--mantine-color-green-filled)] motion-reduce:animate-none"
            />
          )}
          {state === "inSync" && <div className="absolute inset-0 bg-[var(--mantine-color-green-filled)]" />}
          {state === "failed" && <div className="absolute inset-0 bg-[var(--mantine-color-red-filled)]" />}
        </div>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <CenterNode key={`${state}-${attempt}`} state={state} />
        </div>
      </div>

      <AmpEnd icon={<Network size={20} />} label="Online Amp" color={green ? "green" : "gray"} />
    </div>
  );
}

/** Top of the "Offline Amp vs. Online Amp" modal: matches the offline
 * project amp to its linked online amp (`projects_merge_amp_from_live`).
 * Hold-to-confirm, since it overwrites every setting of the project amp. The
 * direction switch is there for the reverse (online ← offline), which isn't
 * built yet. */
export function AmpMergePanel({
  lock,
  projectId,
  assignmentId,
  onProjectUpdate,
  onResult,
}: {
  lock: AmpEditLock | null;
  projectId: string;
  assignmentId: string;
  onProjectUpdate: (project: Project) => void;
  /** Every settled attempt (`null` when a new one starts), so the modal can
   * show the rows that still differ after a failed match. */
  onResult: (result: AmpMergeResult | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A new online reading, or another amp, makes an old outcome stale. A
  // successful match changes only the offline hash, so it keeps showing.
  const liveHash = lock?.live?.ampHash ?? null;
  useEffect(() => {
    setOutcome(null);
  }, [liveHash, assignmentId]);

  const reason = blockedReason(lock);
  const mergeable = lock?.state === "mismatch" && !busy && outcome?.kind !== "merged";

  async function merge() {
    setBusy(true);
    setOutcome(null);
    setAttempt((n) => n + 1);
    onResult(null);
    const response = await commands.projectsMergeAmpFromLive(projectId, assignmentId);
    setBusy(false);
    if (response.status === "error") {
      setOutcome({ kind: "error", message: response.error.message });
      return;
    }
    const result = response.data;
    onResult(result);
    if (result.merged && result.project) {
      onProjectUpdate(result.project);
      setOutcome({ kind: "merged", ampHash: result.ampHash });
    } else {
      setOutcome({ kind: "diverged", count: result.remaining.filter((row) => row.differs).length });
    }
  }

  const hold = useHoldToConfirm({ durationMs: HOLD_MS, disabled: !mergeable, onConfirm: () => void merge() });

  const state: StripState = busy
    ? "pending"
    : outcome?.kind === "merged"
      ? "merged"
      : lock?.state === "matches"
        ? "inSync"
        : outcome
          ? "failed"
          : reason
            ? "blocked"
            : hold.holding
              ? "holding"
              : "idle";
  const { text, color } = caption(state, outcome, reason);
  const done = state === "merged" || state === "inSync";

  return (
    <Stack gap="sm" align="center" className="min-w-0 py-1">
      <SegmentedControl
        size="xs"
        radius="xl"
        value="pull"
        data={[
          { value: "pull", label: "Offline ← Online" },
          { value: "push", label: "Online ← Offline · soon", disabled: true },
        ]}
      />

      <MergeStrip state={state} progress={hold.progress} attempt={attempt} />

      {/* The whole ring is the hold target, not just the button inside it,
          and the button keeps one width while its label changes — a hit area
          that shrank under the pointer mid-hold used to cancel the hold. */}
      <div
        className={`inline-flex max-w-full touch-none rounded-full p-[3px] select-none ${
          mergeable ? "cursor-pointer" : ""
        }`}
        style={{
          background: done
            ? "var(--mantine-color-green-filled)"
            : `conic-gradient(var(--mantine-color-amber-filled) ${hold.progress * 360}deg, var(--mantine-color-default-border) 0deg)`,
        }}
        {...(done ? {} : hold.bind)}
      >
        {done ? (
          <Button
            component="div"
            w={272}
            maw="100%"
            radius="xl"
            color="green"
            variant="light"
            leftSection={<Check size={14} />}
          >
            {state === "merged" ? "Matched" : "In sync"}
          </Button>
        ) : (
          <Button
            w={272}
            maw="100%"
            radius="xl"
            color="amber"
            variant={state === "holding" ? "filled" : "light"}
            loading={busy}
            disabled={!mergeable}
            leftSection={<ArrowLeft size={14} />}
            // Mantine nudges a pressed button down 1px, which reads as the
            // button slipping inside the ring while held.
            className="active:transform-none"
          >
            {state === "holding" ? "Keep holding…" : state === "failed" ? "Hold to try again" : "Hold to match offline to online"}
          </Button>
        )}
      </div>

      <Text size="sm" ta="center" c={color ?? "dimmed"} className="min-w-0">
        {text}
      </Text>
    </Stack>
  );
}
