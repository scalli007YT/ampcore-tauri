import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ActionIcon, Button, Group, Menu, Text } from "@mantine/core";
import { Copy, Minus, Square, X } from "lucide-react";

const appWindow = getCurrentWindow();

interface TitleBarProps {
  title: string;
  projectName?: string;
  onCloseProject?: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({ title, projectName, onCloseProject, onOpenSettings }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <Group
      data-tauri-drag-region
      justify="space-between"
      wrap="nowrap"
      h={36}
      px="xs"
      style={{
        userSelect: "none",
        borderBottom:
          "1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-6))",
      }}
    >
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Menu shadow="md" width={180} position="bottom-start">
          <Menu.Target>
            <Button variant="subtle" color="gray" size="compact-sm">
              File
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={onOpenSettings}>Open App Settings</Menu.Item>
            {projectName && onCloseProject && (
              <>
                <Menu.Divider />
                <Menu.Item onClick={onCloseProject}>Exit Project</Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
        <Text data-tauri-drag-region size="sm" fw={500} truncate style={{ flex: 1 }}>
          {title}
        </Text>
      </Group>

      <Group gap={4} wrap="nowrap">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => appWindow.minimize()}
          aria-label="Minimize"
        >
          <Minus size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => appWindow.toggleMaximize()}
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          onClick={() => appWindow.close()}
          aria-label="Close"
        >
          <X size={16} />
        </ActionIcon>
      </Group>
    </Group>
  );
}
