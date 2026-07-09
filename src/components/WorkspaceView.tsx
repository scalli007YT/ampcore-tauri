import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { Pencil, Server, X } from "lucide-react";
import { AmpCatalogueModal } from "./AmpCatalogueModal";
import { commands, type AmpAssignment, type AmpModelCatalogEntry, type Project } from "../lib/bindings";

interface WorkspaceViewProps {
  project: Project;
  onProjectUpdate: (project: Project) => void;
  ampModels: AmpModelCatalogEntry[] | null;
  onOpenDevice: (assignment: AmpAssignment) => void;
}

export function WorkspaceView({ project, onProjectUpdate, ampModels, onOpenDevice }: WorkspaceViewProps) {
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AmpAssignment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<AmpAssignment | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  const modelsById = useMemo(() => {
    const map = new Map<string, AmpModelCatalogEntry>();
    for (const model of ampModels ?? []) {
      map.set(model.id, model);
    }
    return map;
  }, [ampModels]);

  if (ampModels === null) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  const assignments = project.ampAssignments;
  const selectedAssignment = assignments.find((a) => a.id === selectedId) ?? null;

  function modelNameFor(assignment: AmpAssignment) {
    const model = assignment.ampModelId ? modelsById.get(assignment.ampModelId) : undefined;
    return model ? `${model.brand} ${model.model}` : null;
  }

  function nameFor(assignment: AmpAssignment) {
    return assignment.label ?? modelNameFor(assignment) ?? "Unnamed";
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await commands.projectsRemoveAmpAssignment(project.id, deleteTarget.id);
    setDeleting(false);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    }
  }

  async function handleSaveLabel() {
    if (!editTarget) return;
    setLabelError(null);
    setSavingLabel(true);
    const result = await commands.projectsUpdate({
      ...project,
      ampAssignments: project.ampAssignments.map((a) =>
        a.id === editTarget.id ? { ...a, label: editLabel.trim() || null } : a,
      ),
    });
    setSavingLabel(false);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
      setEditTarget(null);
    } else {
      setLabelError(result.error.message);
    }
  }

  return (
    <Group h="100%" gap={0} align="stretch" wrap="nowrap">
      {/* Amplifiers pane */}
      <Stack w={340} h="100%" p="md" gap="md" style={{ flexShrink: 0 }}>
        <Group justify="space-between">
          <Text fw={500} size="sm" c="dimmed">
            Amplifiers
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              disabled={!selectedAssignment}
              onClick={() => selectedAssignment && onOpenDevice(selectedAssignment)}
            >
              Configure
            </Button>
            <Button size="xs" onClick={() => setCatalogueOpen(true)}>
              Add Amp
            </Button>
          </Group>
        </Group>

        {assignments.length === 0 ? (
          <Center style={{ flex: 1 }}>
            <Text c="dimmed" size="sm" ta="center">
              No amps assigned yet — add one to get started.
            </Text>
          </Center>
        ) : (
          <SimpleGrid cols={3} spacing="md" style={{ flex: 1, alignContent: "start" }}>
            {assignments.map((assignment) => {
              const displayName = nameFor(assignment);
              const modelName = assignment.label ? modelNameFor(assignment) : null;
              const isSelected = assignment.id === selectedId;

              return (
                <div
                  key={assignment.id}
                  className="group"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
                >
                  <Box style={{ position: "relative" }}>
                    <Box
                      w={90}
                      h={90}
                      onClick={() => setSelectedId(assignment.id)}
                      className="flex items-center justify-center rounded-[var(--mantine-radius-sm)] border transition-colors duration-150 group-hover:border-[var(--mantine-color-amber-filled)] group-hover:bg-[var(--mantine-color-amber-light)]"
                      style={{
                        cursor: "pointer",
                        borderColor: isSelected
                          ? "var(--mantine-color-amber-filled)"
                          : "var(--mantine-color-default-border)",
                        borderWidth: isSelected ? 2 : 1,
                        borderStyle: "solid",
                      }}
                    >
                      <ThemeIcon variant="light" color="gray" size={48}>
                        <Server size={28} />
                      </ThemeIcon>
                    </Box>
                    <ActionIcon
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      size="sm"
                      radius="sm"
                      color="gray"
                      variant="filled"
                      style={{ position: "absolute", top: -6, left: -6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLabelError(null);
                        setEditLabel(assignment.label ?? "");
                        setEditTarget(assignment);
                      }}
                      aria-label="Rename amp"
                    >
                      <Pencil size={12} />
                    </ActionIcon>
                    <ActionIcon
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      size="sm"
                      radius="sm"
                      color="red"
                      variant="filled"
                      style={{ position: "absolute", top: -6, right: -6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(assignment);
                      }}
                      aria-label="Remove amp"
                    >
                      <X size={12} />
                    </ActionIcon>
                  </Box>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                    <Text size="xs" ta="center" lineClamp={2} style={{ maxWidth: 90 }}>
                      {displayName}
                    </Text>
                    {modelName && (
                      <Text size="xs" c="dimmed" ta="center" lineClamp={1} fz={10} style={{ maxWidth: 90 }}>
                        {modelName}
                      </Text>
                    )}
                  </div>
                </div>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>

      <Divider orientation="vertical" />

      {/* Speakers pane — mock only, no real data/functionality yet */}
      <Stack style={{ flex: 1 }} h="100%" p="md" gap="md">
        <Text fw={500} size="sm" c="dimmed">
          Speakers
        </Text>
        <Center style={{ flex: 1 }}>
          <Text c="dimmed">Speaker assignment — coming soon</Text>
        </Center>
      </Stack>

      <AmpCatalogueModal
        opened={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        projectId={project.id}
        ampModels={ampModels}
        onProjectUpdate={onProjectUpdate}
      />

      <Modal opened={editTarget !== null} onClose={() => setEditTarget(null)} title="Rename Amp" centered size="sm">
        <Stack gap="md">
          <TextInput
            label="Label"
            placeholder="Optional"
            value={editLabel}
            onChange={(e) => setEditLabel(e.currentTarget.value)}
            data-autofocus
          />
          {labelError && (
            <Text c="red" size="sm">
              {labelError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditTarget(null)} disabled={savingLabel}>
              Cancel
            </Button>
            <Button loading={savingLabel} onClick={handleSaveLabel}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Remove Amp"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Remove {deleteTarget ? nameFor(deleteTarget) : ""} from this project? This can't be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button color="red" loading={deleting} onClick={handleConfirmDelete}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Group>
  );
}
