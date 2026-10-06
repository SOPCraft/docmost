import { Button } from "@mantine/core";
import { IconBook2 } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { useAsideTriggerProps } from "@/hooks/use-toggle-aside";

export default function HandbookButton({pageId}:{pageId:string;readOnly?:boolean}){
  const userId=useAtomValue(currentUserAtom)?.user?.id;
  const trigger=useAsideTriggerProps("pi");
  if(!userId||!pageId)return null;
  return <Button
    {...trigger}
    data-testid="handbook-trigger"
    aria-label="SOP手册"
    variant="light"
    color="blue"
    size="compact-sm"
    leftSection={<IconBook2 size={16}/>}
    styles={{root:{fontWeight:600,borderRadius:8,paddingInline:9}}}
  >SOP手册</Button>;
}
