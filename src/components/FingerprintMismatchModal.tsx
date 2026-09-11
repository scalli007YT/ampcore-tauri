import { Fragment, useState } from "react";
import { Alert, Badge, Button, Code, CopyButton, Group, Modal, Stack, Switch, Text } from "@mantine/core";
import type { AmpEditLock, AmpEditLockState, FingerprintRow } from "../lib/bindings";
import { useIsCompact } from "../lib/breakpoints";

const STATE_BADGE: Record<AmpEditLockState, { color: string; label: string }> = {
  unlinked: { color: "gray", label: "Unlinked" },
  offline: { color: "gray", label: "Offline" },
  checking: { color: "gray", label: "Checking" },
  matches: { color: "green", label: "Matches" },
  mismatch: { color: "red", label: "Mismatch" },
  unreadable: { color: "red", label: "Unreadable" },
};

const CELL = "min-w-0 px-2 py-1";
const DIVIDER = "border-0 border-l border-solid border-[var(--mantine-color-default-border)]";

/** The project amp's fingerprint next to its linked network amp's, row by row,
 * with differing settings in red. Read-only — no accept/ignore actions yet. */
export function FingerprintMismatchModal({
  opened,
  onClose,
  lock,
}: {
  opened: boolean;
  onClose: () => void;
  lock: AmpEditLock | null;
}) {
  const compact = useIsCompact();
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  const rows = lock?.rows ?? [];
  const differenceCount = rows.filter((r) => r.differs).length;
  const visible = onlyDifferences ? rows.filter((r) => r.differs) : rows;

  const groups: { name: string; rows: FingerprintRow[] }[] = [];
  for (const row of visible) {
    const last = groups[groups.length - 1];
    if (last && last.name === row.group) last.rows.push(row);
    else groups.push({ name: row.group, rows: [row] });
  }

  const badge = lock ? STATE_BADGE[lock.state] : null;

  // Everything, independent of the "Only differences" filter.
  const json = lock
    ? JSON.stringify(
        {
          state: lock.state,
          locked: lock.locked,
          offline: lock.project,
          online: lock.live,
          rows: lock.rows,
          unreadable: lock.unreadable,
        },
        null,
        2,
      )
    : "";

  return (
    <Modal opened={opened} onClose={onClose} title="Offline Amp vs. Online Amp" size="xl" centered fullScreen={compact}>
      <Stack gap="sm" className="min-w-0">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            {badge && (
              <Badge color={badge.color} variant="light">
                {badge.label}
              </Badge>
            )}
            {rows.length > 0 && (
              <Text size="sm" c="dimmed">
                {differenceCount} {differenceCount === 1 ? "difference" : "differences"}
              </Text>
            )}
          </Group>
          <Group gap="sm" wrap="wrap">
            <Switch
              size="sm"
              label="Only differences"
              checked={onlyDifferences}
              onChange={(e) => setOnlyDifferences(e.currentTarget.checked)}
            />
            <CopyButton value={json}>
              {({ copied, copy }) => (
                <Button size="xs" color={copied ? "green" : undefined} disabled={!lock} onClick={copy}>
                  {copied ? "Copied" : "Copy all as JSON"}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Group>

        {lock && lock.unreadable.length > 0 && (
          <Alert color="red" variant="light" title="Can't compare everything">
            <Stack gap={2}>
              {lock.unreadable.map((reason) => (
                <Text key={reason} size="sm">
                  {reason}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {lock?.state === "checking" && (
          <Text size="sm" c="dimmed">
            Waiting for the amp's first settings reading…
          </Text>
        )}

        {rows.length > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <div
              className="grid min-w-[560px]"
              style={{ gridTemplateColumns: "minmax(150px, 0.8fr) minmax(0, 1fr) minmax(0, 1fr)" }}
            >
              <div className={CELL} />
              <div className={CELL}>
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Offline Amp
                </Text>
                <Code>{lock?.project?.ampHash ?? "—"}</Code>
              </div>
              <div className={`${CELL} ${DIVIDER}`}>
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Online Amp
                </Text>
                <Code>{lock?.live?.ampHash ?? "—"}</Code>
              </div>

              {groups.map((group) => (
                <Fragment key={group.name}>
                  <div className="col-span-3 mt-2 px-2 py-1">
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>
                      {group.name}
                    </Text>
                  </div>
                  {group.rows.map((row) => {
                    const tint = row.differs ? "bg-[var(--mantine-color-red-light)]" : "";
                    const valueColor = row.differs ? "red" : row.hashed ? undefined : "dimmed";
                    return (
                      <Fragment key={`${group.name}:${row.label}`}>
                        <div className={`${CELL} ${tint}`}>
                          <Text size="xs" c="dimmed">
                            {row.label}
                            {!row.hashed && " (not compared)"}
                          </Text>
                        </div>
                        <div className={`${CELL} ${tint}`}>
                          <Text size="xs" c={valueColor} fw={row.differs ? 500 : undefined}>
                            {row.project ?? "—"}
                          </Text>
                        </div>
                        <div className={`${CELL} ${DIVIDER} ${tint}`}>
                          <Text size="xs" c={valueColor} fw={row.differs ? 500 : undefined}>
                            {row.live ?? "—"}
                          </Text>
                        </div>
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {onlyDifferences && visible.length === 0 && rows.length > 0 && (
          <Text size="sm" c="dimmed" ta="center">
            No differences.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
