import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { commands, type SpeakerLibraryEntry_Serialize } from "../lib/bindings";

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
  const [waysText, setWaysText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setBrand(editEntry?.brand ?? "");
      setFamily(editEntry?.family ?? "");
      setModel(editEntry?.model ?? "");
      setApplication(editEntry?.application ?? "");
      setWaysText(editEntry?.ways.map((w) => w.label).join(", ") ?? "");
      setSubmitError(null);
    }
  }, [opened, editEntry]);

  function parseWays() {
    return waysText
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .map((label) => ({ id: crypto.randomUUID(), label }));
  }

  async function handleSubmit() {
    if (!editEntry) return;
    setSubmitError(null);
    setSubmitting(true);

    const ways = parseWays();
    const result = await commands.speakerLibraryUpdate({
      ...editEntry,
      brand: brand.trim(),
      family: family.trim() || null,
      model: model.trim(),
      application: application.trim() || null,
      ways,
    });

    setSubmitting(false);
    if (result.status === "ok") {
      onSaved(result.data);
      onClose();
    } else {
      setSubmitError(result.error.message);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Edit Speaker" centered>
      <Stack gap="sm">
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
        <TextInput
          label="Ways"
          placeholder="e.g. LF, HF (comma-separated, leave blank for single-way)"
          value={waysText}
          onChange={(e) => setWaysText(e.currentTarget.value)}
        />
        {submitError && (
          <Text c="red" size="sm">
            {submitError}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button loading={submitting} disabled={!brand.trim() || !model.trim()} onClick={handleSubmit}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
