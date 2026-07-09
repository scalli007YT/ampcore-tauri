import { useEffect, useState } from "react";
import { ActionIcon, Box, Stack, Tabs, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { Server, X } from "lucide-react";
import { AmpConfigureView } from "./AmpConfigureView";
import { OperatorView } from "./OperatorView";
import { SpeakerLibraryView } from "./SpeakerLibraryView";
import { WorkspaceView } from "./WorkspaceView";
import { commands, type AmpAssignment, type AmpModelCatalogEntry, type Project } from "../lib/bindings";

interface ProjectWorkspaceProps {
  project: Project;
  onProjectUpdate: (project: Project) => void;
}

const deviceTabValue = (assignmentId: string) => `device:${assignmentId}`;

export function ProjectWorkspace({ project, onProjectUpdate }: ProjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<string | null>("workspace");
  const [openDeviceIds, setOpenDeviceIds] = useState<string[]>([]);
  const [ampModels, setAmpModels] = useState<AmpModelCatalogEntry[] | null>(null);

  useEffect(() => {
    commands.ampModelsList().then((result) => {
      if (result.status === "ok") {
        setAmpModels(result.data);
      }
    });
  }, []);

  function openDevice(assignment: AmpAssignment) {
    setOpenDeviceIds((prev) => (prev.includes(assignment.id) ? prev : [...prev, assignment.id]));
    setActiveTab(deviceTabValue(assignment.id));
  }

  function closeDevice(assignmentId: string) {
    setOpenDeviceIds((prev) => prev.filter((id) => id !== assignmentId));
    setActiveTab((current) => (current === deviceTabValue(assignmentId) ? "workspace" : current));
  }

  const openAssignments = openDeviceIds
    .map((id) => project.ampAssignments.find((a) => a.id === id))
    .filter((a): a is AmpAssignment => a !== undefined);

  const activeDevice = openAssignments.find((a) => deviceTabValue(a.id) === activeTab) ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List justify="center">
          <Tabs.Tab value="workspace">Workspace</Tabs.Tab>
          <Tabs.Tab value="operator">Operator View</Tabs.Tab>
          <Tabs.Tab value="speakerLibrary">Speaker Library</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Vertical device rail — Armonia-style, persists across Workspace/Operator View */}
        {openAssignments.length > 0 && (
          <Stack
            gap={4}
            p={4}
            w={56}
            style={{
              flexShrink: 0,
              borderRight: "1px solid var(--mantine-color-default-border)",
              overflowY: "auto",
            }}
          >
            {openAssignments.map((assignment) => {
              const tabValue = deviceTabValue(assignment.id);
              const isActive = activeTab === tabValue;
              return (
                <Box key={assignment.id} style={{ position: "relative" }}>
                  <UnstyledButton
                    onClick={() => setActiveTab(tabValue)}
                    p={4}
                    style={{
                      width: "100%",
                      borderRadius: "var(--mantine-radius-sm)",
                      border: `1px solid ${isActive ? "var(--mantine-color-amber-filled)" : "transparent"}`,
                      backgroundColor: isActive ? "var(--mantine-color-amber-light)" : undefined,
                    }}
                  >
                    <Stack align="center" gap={2}>
                      <ThemeIcon variant="light" color="gray" size={28}>
                        <Server size={16} />
                      </ThemeIcon>
                      <Text fz={9} ta="center" lineClamp={2} style={{ maxWidth: 48 }}>
                        {assignment.label ?? "Amp"}
                      </Text>
                    </Stack>
                  </UnstyledButton>
                  <ActionIcon
                    size="xs"
                    variant="filled"
                    color="red"
                    radius="sm"
                    style={{ position: "absolute", top: -4, right: -4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeDevice(assignment.id);
                    }}
                    aria-label="Close device"
                  >
                    <X size={10} />
                  </ActionIcon>
                </Box>
              );
            })}
          </Stack>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {activeTab === "workspace" && (
            <WorkspaceView
              project={project}
              onProjectUpdate={onProjectUpdate}
              ampModels={ampModels}
              onOpenDevice={openDevice}
            />
          )}
          {activeTab === "operator" && <OperatorView />}
          {activeTab === "speakerLibrary" && <SpeakerLibraryView />}
          {activeDevice && (
            <AmpConfigureView
              assignment={activeDevice}
              ampModel={
                activeDevice.ampModelId
                  ? ampModels?.find((m) => m.id === activeDevice.ampModelId)
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
