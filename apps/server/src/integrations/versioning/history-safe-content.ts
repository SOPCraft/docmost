const containers = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'hardBreak',
  'horizontalRule',
]);
const safeMarks = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'subscript',
  'superscript',
]);
const dynamicNodes = new Set([
  'image',
  'video',
  'audio',
  'pdf',
  'attachment',
  'embed',
  'youtube',
  'drawio',
  'excalidraw',
  'transclusionReference',
  'baseEmbed',
  'subpages',
  'mention',
]);
const inlineContainers = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'detailsSummary',
]);
const placeholder = '【此资料未纳入当前历史范围，请查看原版本说明】';

/** Preserve static text, including unknown layout containers; never fetch live references. */
export function safeHistoryContent(input: unknown): Record<string, unknown> {
  const blockify = (children: any[]): any[] => {
    const result: any[] = [];
    let inline: any[] = [];
    const flush = () => {
      if (inline.length) {
        result.push({ type: 'paragraph', content: inline });
        inline = [];
      }
    };
    for (const child of children) {
      if (['text', 'hardBreak'].includes(child.type)) inline.push(child);
      else {
        flush();
        result.push(child);
      }
    }
    flush();
    return result.length ? result : [{ type: 'paragraph' }];
  };
  const walk = (value: any, depth: number, inline = false): any => {
    if (depth > 100 || !value || typeof value !== 'object')
      throw new Error('Invalid historical document');
    if (value.type === 'text')
      return {
        type: 'text',
        text: String(value.text || ''),
        ...(Array.isArray(value.marks)
          ? {
              marks: value.marks
                .filter((m) => m && safeMarks.has(m.type))
                .map((m) => ({ type: m.type })),
            }
          : {}),
      };
    if (!containers.has(value.type)) {
      if (
        !dynamicNodes.has(value.type) &&
        Array.isArray(value.content) &&
        !inline
      ) {
        return {
          type: 'blockquote',
          content: blockify(
            value.content.map((child) => walk(child, depth + 1)),
          ),
        };
      }
      const text = { type: 'text', text: placeholder };
      return inline ? text : { type: 'paragraph', content: [text] };
    }
    const attrs: Record<string, unknown> = {};
    for (const key of ['level', 'colspan', 'rowspan', 'start'])
      if (
        Number.isInteger(value.attrs?.[key]) &&
        value.attrs[key] > 0 &&
        value.attrs[key] < 10000
      )
        attrs[key] = value.attrs[key];
    if (value.type === 'taskItem')
      attrs.checked = value.attrs?.checked === true;
    if (Array.isArray(value.attrs?.colwidth))
      attrs.colwidth = value.attrs.colwidth.map((x) =>
        Number.isFinite(x) && x > 0 && x < 10000 ? x : null,
      );
    return {
      type: value.type,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(Array.isArray(value.content)
        ? {
            content: value.content.map((child) =>
              walk(child, depth + 1, inlineContainers.has(value.type)),
            ),
          }
        : {}),
    };
  };
  if (input === null) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const result = walk(input, 0);
  if (result.type !== 'doc')
    throw new Error('Historical document root must be doc');
  if (!result.content?.length) result.content = [{ type: 'paragraph' }];
  return result;
}
