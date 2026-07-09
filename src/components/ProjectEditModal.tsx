import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { commands, type Project } from "../lib/bindings";

interface ProjectEditModalProps {
  project: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted: (id: string) => void;
}

export function ProjectEditModal({ project, onClose, onSaved, onDeleted }: ProjectEditModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setConfirmingDelete(false);
      setError(null);
    }
  }, [project]);

  async function handleSave() {
    if (!project) return;
    setError(null);
    setSubmitting(true);
    const result = await commands.projectsUpdate({ ...project, name: name.trim() });
    setSubmitting(false);
    if (result.status === "ok") {
      onSaved(result.data);
      onClose();
    } else {
      setError(result.error.message);
    }
  }

  async function handleDelete() {
    if (!project) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await commands.projectsDelete(project.id);
    setSubmitting(false);
    if (result.status === "ok") {
      onDeleted(project.id);
      onClose();
    } else {
      setError(result.error.message);
    }
  }

  return (
    <Modal opened={!!project} onClose={onClose} title="Edit Project" centered>
      <Stack gap="sm">
        <TextInput
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="space-between">
          <Button color="red" variant={confirmingDelete ? "filled" : "light"} onClick={handleDelete} disabled={submitting}>
            {confirmingDelete ? "Confirm Delete" : "Delete"}
          </Button>
          <Button loading={submitting} disabled={!name.trim()} onClick={handleSave}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
