import { useState } from "react";
import { Tabs } from "@mantine/core";
import { OperatorView } from "./OperatorView";
import { WorkspaceView } from "./WorkspaceView";
import type { Project } from "../lib/bindings";

interface ProjectWorkspaceProps {
  project: Project;
  onProjectUpdate: (project: Project) => void;
}

export function ProjectWorkspace({ project, onProjectUpdate }: ProjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<string | null>("workspace");

  return (
    <Tabs
      value={activeTab}
      onChange={setActiveTab}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Tabs.List justify="center">
        <Tabs.Tab value="workspace">Workspace</Tabs.Tab>
        <Tabs.Tab value="operator">Operator View</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="workspace" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <WorkspaceView project={project} onProjectUpdate={onProjectUpdate} />
      </Tabs.Panel>
      <Tabs.Panel value="operator" style={{ flex: 1, minHeight: 0 }}>
        <OperatorView />
      </Tabs.Panel>
    </Tabs>
  );
}
