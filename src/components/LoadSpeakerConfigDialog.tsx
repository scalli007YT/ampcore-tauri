import { useEffect, useState } from "react";
import { Button, Group, Modal, Select, Stack, Table, Text } from "@mantine/core";
import { type AmpAssignment, type SpeakerLibraryEntry_Serialize as SpeakerLibraryEntry } from "../lib/bindings";
import { formatSpeakerAssignment, SPEAKER_OUTPUT_LETTER } from "./AmpConfigureView";

const NO_CHANGE = "__no_change__";

interface LoadDialogRow {
  channelIndexes: number[];
  isBridge: boolean;
}

/** One row per physical channel, collapsed to one row only for a real
 * hardware-bridged pair (`outputBridged`) — a bridged pair shares one
 * physical output signal so a single pick is physically correct. This is
 * deliberately NOT collapsed on `joinGroupId`: Join is purely a visual
 * grouping in the Physical Outputs panel, and its members must stay
 * independently editable here — that's the whole point of this dialog. */
function buildLoadDialogRows(channels: AmpAssignment["channels"]): LoadDialogRow[] {
  const rows: LoadDialogRow[] = [];
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    const next = channels[i + 1];
    if (channel.channelIndex % 2 === 0 && channel.outputBridged && next?.channelIndex === channel.channelIndex + 1) {
      rows.push({ channelIndexes: [channel.channelIndex, next.channelIndex], isBridge: true });
      i++;
    } else {
      rows.push({ channelIndexes: [channel.channelIndex], isBridge: false });
    }
  }
  return rows;
}

interface LoadSpeakerConfigDialogProps {
  opened: boolean;
  onClose: () => void;
  assignment: AmpAssignment;
  speakers: SpeakerLibraryEntry[];
  /** The single library entry driving the per-row way options — whatever's
   * currently selected in the Library table when "Load..." is clicked. */
  profile: SpeakerLibraryEntry;
  onApply: (
    patches: { channelIndex: number; speakerLibraryId: string | null; wayIndex: number | null }[],
  ) => Promise<{ ok: boolean; error: string | null }>;
}

/** Per-channel independent way picker — the flexible counterpart to
 * drag-and-drop's whole-entry sequential assignment. Every physical output
 * row gets its own dropdown into `profile`'s ways (or "No change" to skip
 * it), so a user can apply only one way of a multi-way speaker, duplicate a
 * way onto multiple outputs, or pick ways out of order — none of which the
 * sequential drag-drop path supports. Deliberately does not auto-Join
 * anything it assigns (see the dialog's body text) since its whole purpose
 * is supporting assignments that often shouldn't be grouped. */
export function LoadSpeakerConfigDialog({
  opened,
  onClose,
  assignment,
  speakers,
  profile,
  onApply,
}: LoadSpeakerConfigDialogProps) {
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setSelections({});
      setSubmitError(null);
    }
  }, [opened, profile.id]);

  const rows = buildLoadDialogRows(assignment.channels);
  const wayOptions = [
    { value: NO_CHANGE, label: "No change" },
    ...(profile.ways.length > 0
      ? profile.ways.map((w, i) => ({ value: w.id, label: w.label || `Way ${i + 1}` }))
      : [{ value: "full", label: "Full" }]),
  ];
  const hasAnyPick = rows.some((row) => {
    const picked = selections[row.channelIndexes[0]];
    return picked && picked !== NO_CHANGE;
  });

  async function handleApply() {
    setSubmitting(true);
    setSubmitError(null);
    const patches: { channelIndex: number; speakerLibraryId: string | null; wayIndex: number | null }[] = [];
    for (const row of rows) {
      const picked = selections[row.channelIndexes[0]];
      if (!picked || picked === NO_CHANGE) continue;
      const wayIndex = profile.ways.length > 1 ? Math.max(0, profile.ways.findIndex((w) => w.id === picked)) : null;
      for (const channelIndex of row.channelIndexes) {
        patches.push({ channelIndex, speakerLibraryId: profile.id, wayIndex });
      }
    }
    const result = await onApply(patches);
    setSubmitting(false);
    if (result.ok) {
      onClose();
    } else {
      setSubmitError(result.error);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={`Load "${profile.brand} ${profile.model}"`} centered size="lg">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Pick a way for each physical output independently, or leave "No change" to skip it.
        </Text>
        <Table.ScrollContainer minWidth={420}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Output</Table.Th>
                <Table.Th>Current</Table.Th>
                <Table.Th>New</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const leaderIndex = row.channelIndexes[0];
                const leaderChannel = assignment.channels.find((c) => c.channelIndex === leaderIndex)!;
                const label = row.isBridge
                  ? `Out${SPEAKER_OUTPUT_LETTER(row.channelIndexes[0])}+${SPEAKER_OUTPUT_LETTER(row.channelIndexes[1])} (Bridged)`
                  : `Out${SPEAKER_OUTPUT_LETTER(leaderIndex)}`;
                const current = formatSpeakerAssignment(speakers, leaderChannel.speakerLibraryId, leaderChannel.wayIndex);
                return (
                  <Table.Tr key={leaderIndex}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {current}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={wayOptions}
                        value={selections[leaderIndex] ?? NO_CHANGE}
                        onChange={(value) => setSelections((prev) => ({ ...prev, [leaderIndex]: value ?? NO_CHANGE }))}
                        allowDeselect={false}
                        comboboxProps={{ withinPortal: true }}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {submitError && (
          <Text c="red" size="sm">
            {submitError}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button loading={submitting} disabled={!hasAnyPick} onClick={handleApply}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
