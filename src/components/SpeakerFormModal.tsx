import { useEffect, useState } from "react";
import { ActionIcon, Button, Group, Modal, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { Plus, X } from "lucide-react";
import { commands, type SpeakerLibraryEntry_Serialize, type SpeakerWay } from "../lib/bindings";

interface SpeakerFormModalProps {
  opened: boolean;
  onClose: () => void;
  editEntry: SpeakerLibraryEntry_Serialize | null;
  onSaved: (entry: SpeakerLibraryEntry_Serialize) => void;
}

export function SpeakerFormModal({ opened, onClose, editEntry, onSaved }: SpeakerFormModalProps) {
  const [brand, setBrand] = useState("");
  const [family, setFamily] = useState("");
  const [model, setModel] = useState("");
  const [application, setApplication] = useState("");
  const [notes, setNotes] = useState("");
  const [ways, setWays] = useState<SpeakerWay[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setBrand(editEntry?.brand ?? "");
      setFamily(editEntry?.family ?? "");
      setModel(editEntry?.model ?? "");
      setApplication(editEntry?.application ?? "");
      setNotes(editEntry?.notes ?? "");
      setWays(editEntry?.ways ?? []);
      setSubmitError(null);
    }
  }, [opened, editEntry]);

  function addWay() {
    setWays((prev) => [...prev, { id: crypto.randomUUID(), label: "" }]);
  }

  function removeWay(id: string) {
    setWays((prev) => prev.filter((w) => w.id !== id));
  }

  function updateWayLabel(id: string, label: string) {
    setWays((prev) => prev.map((w) => (w.id === id ? { ...w, label } : w)));
  }

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);

    const finalWays = ways.map((w) => ({ ...w, label: w.label.trim() })).filter((w) => w.label.length > 0);
    const result = editEntry
      ? await commands.speakerLibraryUpdate({
          ...editEntry,
          brand: brand.trim(),
          family: family.trim() || null,
          model: model.trim(),
          application: application.trim() || null,
          notes: notes.trim() || null,
          ways: finalWays,
        })
      : await commands.speakerLibraryCreate(
          brand.trim(),
          model.trim(),
          family.trim() || null,
          application.trim() || null,
          finalWays,
        );

    setSubmitting(false);
    if (result.status === "ok") {
      onSaved(result.data);
      onClose();
    } else {
      setSubmitError(result.error.message);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={editEntry ? "Edit Speaker" : "Add Speaker"} centered size="lg">
      <Group align="flex-start" gap="lg" wrap="nowrap">
        <Stack gap="sm" className="flex-1">
          <TextInput
            label="Brand"
            required
            value={brand}
            onChange={(e) => setBrand(e.currentTarget.value)}
            data-autofocus
          />
          <TextInput label="Family" placeholder="Optional" value={family} onChange={(e) => setFamily(e.currentTarget.value)} />
          <TextInput label="Model" required value={model} onChange={(e) => setModel(e.currentTarget.value)} />
          <TextInput
            label="Application"
            placeholder="Optional"
            value={application}
            onChange={(e) => setApplication(e.currentTarget.value)}
          />
          <Textarea
            label="Notes"
            placeholder="Optional"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            autosize
            minRows={2}
          />
        </Stack>
        <Stack gap="sm" className="flex-1">
          <Text size="sm" fw={500}>
            Ways
          </Text>
          {ways.length === 0 && (
            <Text size="xs" c="dimmed">
              No ways added — leave blank for a single-way speaker.
            </Text>
          )}
          {ways.map((way, i) => (
            <Group key={way.id} gap="xs" wrap="nowrap">
              <TextInput
                size="sm"
                label={`Way ${i + 1}`}
                value={way.label}
                onChange={(e) => updateWayLabel(way.id, e.currentTarget.value)}
                className="flex-1"
              />
              <ActionIcon variant="default" color="red" mt={22} onClick={() => removeWay(way.id)} aria-label={`Remove way ${i + 1}`}>
                <X size={14} />
              </ActionIcon>
            </Group>
          ))}
          <Button size="xs" variant="default" leftSection={<Plus size={14} />} onClick={addWay}>
            Add way
          </Button>
        </Stack>
      </Group>
      {submitError && (
        <Text c="red" size="sm" mt="sm">
          {submitError}
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button loading={submitting} disabled={!brand.trim() || !model.trim()} onClick={handleSubmit}>
          Save
        </Button>
      </Group>
    </Modal>
  );
}
