import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Center, Title } from "@mantine/core";
import { ProjectSelector } from "./components/ProjectSelector";
import { SettingsModal } from "./components/SettingsModal";
import { TitleBar } from "./components/TitleBar";
import { UpdateAvailableModal } from "./components/UpdateAvailableModal";
import { getAutoUpdateChecksEnabled, setAutoUpdateChecksEnabled } from "./lib/preferences";
import type { Project } from "./lib/bindings";

function App() {
  const [version, setVersion] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion);

    if (import.meta.env.DEV || !getAutoUpdateChecksEnabled()) {
      return;
    }

    check()
      .then((update) => {
        if (update) {
          setPendingUpdate(update);
        }
      })
      .catch((e) => console.error("Update check failed", e));
  }, []);

  async function handleInstallUpdate() {
    if (!pendingUpdate) return;
    setInstallingUpdate(true);
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error("Update install failed", e);
      setInstallingUpdate(false);
    }
  }

  function handleDisableUpdateChecks() {
    setAutoUpdateChecksEnabled(false);
    setPendingUpdate(null);
  }

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
      <UpdateAvailableModal
        update={pendingUpdate}
        installing={installingUpdate}
        onInstall={handleInstallUpdate}
        onAbort={() => setPendingUpdate(null)}
        onDisable={handleDisableUpdateChecks}
      />
    </div>
  );
}

export default App;
