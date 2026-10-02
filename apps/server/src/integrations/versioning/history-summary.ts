import { diffChars } from 'diff';
import { isDeepStrictEqual } from 'node:util';

export interface HistorySummary {
  label: string;
  details: string[];
  added: number | null;
  deleted: number | null;
  limited: boolean;
  metadataChanged: boolean;
  structureChanged: boolean;
}
export interface SummaryPage {
  title?: string | null;
  content?: unknown;
  icon?: unknown;
  coverPhoto?: unknown;
  position?: unknown;
  parentPageId?: unknown;
  deletedAt?: unknown;
}
const excerpt = (text: string) => {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.slice(0, 100).join('') + (chars.length > 100 ? '…' : '');
};
export function historyText(content: unknown): string {
  const chunks: string[] = [];
  let length = 0;
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 100 || length > 24000)
      return;
    if (node.type === 'text' && typeof node.text === 'string') {
      chunks.push(node.text.slice(0, 24001 - length));
      length += node.text.length;
    } else if (Array.isArray(node.content))
      node.content.forEach((child) => visit(child, depth + 1));
    if (
      [
        'paragraph',
        'heading',
        'tableCell',
        'tableHeader',
        'codeBlock',
        'hardBreak',
      ].includes(node.type)
    ) {
      chunks.push('\n');
      length++;
    }
  };
  visit(content, 0);
  return chunks.join('').replace(/\n+$/, '');
}
export function summarizeHistory(
  current: SummaryPage,
  previous: SummaryPage | null,
  limited = false,
): HistorySummary {
  const labels: string[] = [],
    details: string[] = [];
  if (!previous) labels.push('首次保存');
  const old = previous || {};
  if (previous && current.title !== old.title) {
    labels.push('修改标题');
    details.push(
      `标题：「${excerpt(old.title || '未命名文档')}」→「${excerpt(current.title || '未命名文档')}」`,
    );
  }
  if (previous && !!current.deletedAt !== !!old.deletedAt)
    labels.push(current.deletedAt ? '移入回收站' : '从回收站恢复');
  if (
    previous &&
    (!isDeepStrictEqual(current.position, old.position) ||
      current.parentPageId !== old.parentPageId)
  )
    labels.push('调整位置');
  if (
    previous &&
    (!isDeepStrictEqual(current.icon, old.icon) ||
      !isDeepStrictEqual(current.coverPhoto, old.coverPhoto))
  )
    labels.push('修改图标或封面');
  const metadataChanged = labels.length > (previous ? 0 : 1);
  const before = historyText(old.content),
    after = historyText(current.content);
  const structureChanged = !isDeepStrictEqual(current.content, old.content);
  const bounded = limited || before.length + after.length > 24000;
  const changes = bounded
    ? undefined
    : diffChars(before, after, { maxEditLength: 2000, timeout: 15 });
  let added: number | null = 0,
    deleted: number | null = 0;
  if (!changes) {
    labels.push('内容较长，查看详情');
    details.push('摘要已限制长度；以所选版本的完整正文为准。');
    added = deleted = null;
  } else {
    for (const change of changes) {
      if (change.added) added += Array.from(change.value).length;
      if (change.removed) deleted += Array.from(change.value).length;
      if (
        (change.added || change.removed) &&
        excerpt(change.value) &&
        details.length < 5
      )
        details.push(
          `${change.added ? '新增' : '删除'}：「${excerpt(change.value)}」`,
        );
    }
    if (added || deleted)
      labels.push(
        [added ? `新增 ${added} 字` : '', deleted ? `删除 ${deleted} 字` : '']
          .filter(Boolean)
          .join('，'),
      );
    else if (structureChanged && previous) {
      labels.push('样式或结构调整');
      details.push('正文文字未变，格式、表格结构或资料引用发生变化。');
    }
  }
  if (!labels.length) {
    labels.push('协同状态更新');
    details.push('本次未检测到正文、标题或位置的可见变化。');
  }
  return {
    label: labels.join(' · '),
    details,
    added,
    deleted,
    limited: !changes,
    metadataChanged,
    structureChanged,
  };
}
