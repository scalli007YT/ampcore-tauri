import { Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
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
    <Card withBorder padding="lg" onClick={onClick} className="cursor-pointer" style={{ flex: "1 1 200px" }}>
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
    /* Centered while it fits, scrollable once a short window makes it
     * taller than the viewport — a plain `Center` would clip both ends. */
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col items-center justify-center p-4">
        <Stack w="100%" maw={520} gap="xl">
          <Stack gap={4}>
            <Title order={2} ta="center">
              Welcome to AmpCore
            </Title>
            <Text c="dimmed" ta="center">
              Choose how you'd like to start
            </Text>
          </Stack>

          {/* Two cards side by side while there's room; below ~420px they
           * stack rather than squeezing to two illegible columns. */}
          <Group align="stretch" gap="md" wrap="wrap">
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
      </div>
    </div>
  );
}
