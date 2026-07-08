import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Center, Title } from "@mantine/core";
import { ProjectSelector } from "./components/ProjectSelector";
import { SettingsModal } from "./components/SettingsModal";
import { TitleBar } from "./components/TitleBar";
import type { Project } from "./lib/bindings";

async function checkForUpdates() {
  try {
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      await relaunch();
    }
  } catch (e) {
    console.error("Update check failed", e);
  }
}

function App() {
  const [version, setVersion] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    checkForUpdates();
    getVersion().then(setVersion);
  }, []);

  const windowTitle = selectedProject
    ? `AmpCore ${version} - ${selectedProject.name}`.trim()
    : `AmpCore ${version}`.trim();

  useEffect(() => {
    // Kept for the OS taskbar / Alt-Tab switcher — the native titlebar
    // itself is hidden (decorations: false), replaced by <TitleBar />.
    getCurrentWindow().setTitle(windowTitle);
  }, [windowTitle]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TitleBar
        title={windowTitle}
        projectName={selectedProject?.name}
        onCloseProject={() => setSelectedProject(null)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {!selectedProject ? (
          <ProjectSelector onSelect={setSelectedProject} />
        ) : (
          <Center style={{ height: "100%" }}>
            <Title order={1}>hello</Title>
          </Center>
        )}
      </div>
      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
