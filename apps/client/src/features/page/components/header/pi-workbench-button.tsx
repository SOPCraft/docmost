import { ActionIcon, Tooltip } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import { useAtomValue } from 'jotai';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom';
import { useAsideTriggerProps } from '@/hooks/use-toggle-aside';

export default function PiWorkbenchButton() {
  const userId = useAtomValue(currentUserAtom)?.user?.id;
  const trigger = useAsideTriggerProps('pi');
  if (!userId) return null;
  return (
    <Tooltip label="智能体对话" openDelay={250}>
      <ActionIcon {...trigger} aria-label="智能体对话" data-testid="pi-workbench-trigger" variant="subtle" color="gray">
        <IconSparkles size={20} />
      </ActionIcon>
    </Tooltip>
  );
}
