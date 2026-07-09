import { useEffect, useState } from "react";
import { ActionIcon, Button, Card, Center, Group, Modal, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { Pencil } from "lucide-react";
import { ProjectEditModal } from "./ProjectEditModal";
import { commands, type Project } from "../lib/bindings";

interface ProjectSelectorProps {
  onSelect: (project: Project) => void;
}

export function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const form = useForm({
    initialValues: { name: "", description: "" },
    validate: {
      name: (value) => (value.trim().length === 0 ? "Name is required" : null),
    },
  });

  async function loadProjects() {
    setLoading(true);
    const result = await commands.projectsList();
    if (result.status === "ok") {
      setProjects(result.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function handleCreate(values: typeof form.values) {
    setCreateError(null);
    const result = await commands.projectsCreate(values.name.trim(), values.description.trim());
    if (result.status === "ok") {
      setModalOpen(false);
      form.reset();
      onSelect(result.data);
    } else {
      setCreateError(result.error.message);
    }
  }

  return (
    <Center style={{ height: "100%" }}>
      <Stack w={420}>
        <Title order={2} ta="center">
          Select a Project
        </Title>

        {!loading && projects.length === 0 && (
          <Text c="dimmed" ta="center">
            No projects yet — create one to get started.
          </Text>
        )}

        <Stack gap="xs">
          {projects.map((project) => (
            <Card
              key={project.id}
              withBorder
              padding="sm"
              onClick={() => onSelect(project)}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId((current) => (current === project.id ? null : current))}
              style={{ cursor: "pointer" }}
            >
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={500}>{project.name}</Text>
                  {project.description && (
                    <Text size="sm" c="dimmed">
                      {project.description}
                    </Text>
                  )}
                </div>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  style={{ visibility: hoveredId === project.id ? "visible" : "hidden" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProject(project);
                  }}
                  aria-label="Edit project"
                >
                  <Pencil size={16} />
                </ActionIcon>
              </Group>
            </Card>
          ))}
        </Stack>

        <Button onClick={() => setModalOpen(true)}>New Project</Button>
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCreateError(null);
        }}
        title="New Project"
      >
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack>
            <TextInput
              label="Name"
              placeholder="Project name"
              required
              data-autofocus
              {...form.getInputProps("name")}
            />
            <Textarea
              label="Description"
              placeholder="Optional description"
              {...form.getInputProps("description")}
            />
            {createError && (
              <Text c="red" size="sm">
                {createError}
              </Text>
            )}
            <Button type="submit">Create</Button>
          </Stack>
        </form>
      </Modal>

      <ProjectEditModal
        project={editingProject}
        onClose={() => setEditingProject(null)}
        onSaved={(updated) => setProjects((current) => current.map((p) => (p.id === updated.id ? updated : p)))}
        onDeleted={(id) => setProjects((current) => current.filter((p) => p.id !== id))}
      />
    </Center>
  );
}
