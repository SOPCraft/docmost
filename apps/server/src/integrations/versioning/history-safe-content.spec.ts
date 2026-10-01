import { safeHistoryContent } from './history-safe-content';
const text = (value: string) => ({ type: 'text', text: value });
const doc = (...content: any[]) => ({ type: 'doc', content });
describe('historical body projection', () => {
  it('keeps Chinese text and table structure', () => {
    const input = doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 2, rowspan: 1, colwidth: [120, 130] },
              content: [
                { type: 'paragraph', content: [text('检查人名与数字')] },
              ],
            },
          ],
        },
      ],
    });
    const result: any = safeHistoryContent(input);
    expect(result.content[0].type).toBe('table');
    expect(result.content[0].content[0].content[0].attrs.colspan).toBe(2);
    expect(JSON.stringify(result)).toContain('检查人名与数字');
  });
  it('does not drop text from a static callout or columns container', () => {
    const input = doc({
      type: 'columns',
      content: [
        {
          type: 'column',
          content: [
            {
              type: 'callout',
              content: [{ type: 'paragraph', content: [text('必须先审核')] }],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(safeHistoryContent(input))).toContain('必须先审核');
  });
  it.each([
    'image',
    'video',
    'audio',
    'embed',
    'transclusionReference',
    'baseEmbed',
    'mention',
  ])('blocks live resource node %s', (type) => {
    const rendered = JSON.stringify(
      safeHistoryContent(
        doc({
          type,
          attrs: { src: 'https://private.invalid/live', sourcePageId: 'live' },
        }),
      ),
    );
    expect(rendered).not.toContain('private.invalid');
    expect(rendered).not.toContain('sourcePageId');
    expect(rendered).toContain('未纳入');
  });
  it('removes link and comment marks but keeps their text', () => {
    const input = doc({
      type: 'paragraph',
      content: [
        {
          ...text('标准条款'),
          marks: [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
            { type: 'comment', attrs: { commentId: 'live' } },
            { type: 'bold' },
          ],
        },
      ],
    });
    const rendered = JSON.stringify(safeHistoryContent(input));
    expect(rendered).toContain('标准条款');
    expect(rendered).toContain('bold');
    expect(rendered).not.toContain('javascript');
    expect(rendered).not.toContain('commentId');
  });
  it('keeps an inline placeholder inline', () =>
    expect(
      (
        safeHistoryContent(
          doc({ type: 'paragraph', content: [{ type: 'mention' }] }),
        ) as any
      ).content[0].content[0].type,
    ).toBe('text'));
  it('normalizes an empty document to a valid editable-schema body', () =>
    expect(safeHistoryContent(null)).toEqual(doc({ type: 'paragraph' })));
  it('does not mutate the source snapshot', () => {
    const input = doc({ type: 'image', attrs: { src: 'current' } });
    const saved = JSON.stringify(input);
    safeHistoryContent(input);
    expect(JSON.stringify(input)).toBe(saved);
  });
});
