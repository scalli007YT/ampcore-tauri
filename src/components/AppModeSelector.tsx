import { Card, Center, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { FolderCog, Radio } from "lucide-react";

interface AppModeSelectorProps {
  onSelectLiveControl: () => void;
  onSelectProjectDesign: () => void;
}

function ModeCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Card withBorder padding="lg" onClick={onClick} style={{ cursor: "pointer", flex: 1 }}>
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon variant="light" color="gray" size={48} radius="xl">
          {icon}
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Stack>
    </Card>
  );
}

export function AppModeSelector({ onSelectLiveControl, onSelectProjectDesign }: AppModeSelectorProps) {
  return (
    <Center style={{ height: "100%" }}>
      <Stack w={520} gap="xl">
        <Stack gap={4}>
          <Title order={2} ta="center">
            Welcome to AmpCore
          </Title>
          <Text c="dimmed" ta="center">
            Choose how you'd like to start
          </Text>
        </Stack>

        <Group align="stretch" gap="md" wrap="nowrap">
          <ModeCard
            icon={<Radio size={24} />}
            title="Live Control"
            description="Connect to and control amps on the network in real time."
            onClick={onSelectLiveControl}
          />
          <ModeCard
            icon={<FolderCog size={24} />}
            title="Project Design"
            description="Plan projects, amp assignments, and speaker configurations offline."
            onClick={onSelectProjectDesign}
          />
        </Group>
      </Stack>
    </Center>
  );
}
