import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconSettings2 } from '@tabler/icons-react';

type Props = {
  canManageModels: boolean;
  sessionAvailable: boolean;
  busy: boolean;
  posting: boolean;
  onModels: () => void;
  onCommand: (type: string) => void;
  onFiles: () => void;
  onAdvanced: () => void;
};

export default function PiWorkbenchActions(props: Props) {
  const unavailable = !props.sessionAvailable || props.posting;
  return <Menu position="bottom-end" width={244} shadow="md">
    <Menu.Target>
      <Tooltip label="设置与工具" openDelay={250}>
        <ActionIcon variant="subtle" color="gray" aria-label="设置与工具" data-testid="pi-settings-tools">
          <IconSettings2 size={17} />
        </ActionIcon>
      </Tooltip>
    </Menu.Target>
    <Menu.Dropdown>
      {props.canManageModels && <>
        <Menu.Label>模型服务</Menu.Label>
        <Menu.Item onClick={props.onModels}>模型设置</Menu.Item>
        <Menu.Divider />
      </>}
      <Menu.Label>当前会话</Menu.Label>
      <Menu.Item disabled={unavailable} onClick={() => props.onCommand('clone')}>克隆当前会话分支</Menu.Item>
      <Menu.Item disabled={unavailable || props.busy} onClick={() => props.onCommand('compact')}>整理长对话上下文</Menu.Item>
      <Menu.Item disabled={unavailable} onClick={() => props.onCommand('clear_queue')}>清空追加队列</Menu.Item>
      <Menu.Item disabled={unavailable} onClick={() => props.onCommand('get_session_stats')}>查看真实用量统计</Menu.Item>
      <Menu.Item disabled={unavailable} onClick={() => props.onCommand('export_html')}>导出对话网页</Menu.Item>
      <Menu.Item disabled={unavailable} onClick={props.onFiles}>查看生成文件</Menu.Item>
      <Menu.Divider />
      <Menu.Label>高级工具</Menu.Label>
      <Menu.Item onClick={props.onAdvanced}>完整原生控制</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
}
