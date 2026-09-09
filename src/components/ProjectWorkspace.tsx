import { useEffect, useState } from "react";
import { ActionIcon, Box, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { Server, X } from "lucide-react";
import { AmpConfigureView } from "./AmpConfigureView";
import { OperatorView } from "./OperatorView";
import { WorkspaceView } from "./WorkspaceView";
import { commands, type AmpAssignment, type AmpModelCatalogEntry, type Project } from "../lib/bindings";

interface ProjectWorkspaceProps {
  project: Project;
  onProjectUpdate: (project: Project) => void;
  /** Workspace/Operator View selection — owned by `App` since the tab
   * selector itself now renders in the title bar, not here. */
  activeTab: string | null;
  onActiveTabChange: (tab: string | null) => void;
}

const deviceTabValue = (assignmentId: string) => `device:${assignmentId}`;

export function ProjectWorkspace({ project, onProjectUpdate, activeTab, onActiveTabChange }: ProjectWorkspaceProps) {
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
    onActiveTabChange(deviceTabValue(assignment.id));
  }

  function closeDevice(assignmentId: string) {
    setOpenDeviceIds((prev) => prev.filter((id) => id !== assignmentId));
    if (activeTab === deviceTabValue(assignmentId)) {
      onActiveTabChange("workspace");
    }
  }

  const openAssignments = openDeviceIds
    .map((id) => project.ampAssignments.find((a) => a.id === id))
    .filter((a): a is AmpAssignment => a !== undefined);

  const activeDevice = openAssignments.find((a) => deviceTabValue(a.id) === activeTab) ?? null;

  return (
    <div className="flex h-full flex-col">

      <div className="flex min-h-0 flex-1">
        {/* Vertical device rail — Armonia-style, persists across Workspace/Operator View */}
        {openAssignments.length > 0 && (
          <Stack
            gap={4}
            p={4}
            w={56}
            className="shrink-0 overflow-y-auto border-r border-[var(--mantine-color-default-border)]"
          >
            {openAssignments.map((assignment) => {
              const tabValue = deviceTabValue(assignment.id);
              const isActive = activeTab === tabValue;
              return (
                <Box key={assignment.id} className="relative">
                  <UnstyledButton
                    onClick={() => onActiveTabChange(tabValue)}
                    p={4}
                    className={`w-full rounded-[var(--mantine-radius-sm)] border ${
                      isActive
                        ? "border-[var(--mantine-color-amber-filled)] bg-[var(--mantine-color-amber-light)]"
                        : "border-transparent"
                    }`}
                  >
                    <Stack align="center" gap={2}>
                      <ThemeIcon variant="light" color="gray" size={28}>
                        <Server size={16} />
                      </ThemeIcon>
                      <Text fz={9} ta="center" lineClamp={2} className="max-w-[48px]">
                        {assignment.label ?? "Amp"}
                      </Text>
                    </Stack>
                  </UnstyledButton>
                  <ActionIcon
                    size="xs"
                    variant="filled"
                    color="red"
                    radius="sm"
                    className="absolute -top-1 -right-1"
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

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {activeTab === "workspace" && (
            <WorkspaceView
              project={project}
              onProjectUpdate={onProjectUpdate}
              ampModels={ampModels}
              onOpenDevice={openDevice}
            />
          )}
          {activeTab === "operator" && <OperatorView />}
          {activeDevice && (
            <AmpConfigureView
              source={{
                kind: "project",
                project,
                assignment: activeDevice,
                ampModel: activeDevice.ampModelId ? ampModels?.find((m) => m.id === activeDevice.ampModelId) : undefined,
                onProjectUpdate,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
