import { summarizeHistory, historyText } from './history-summary';
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const page = (text: string) => ({ title: '操作手册', content: doc(text) });
describe('deterministic history summaries', () => {
  it('describes the first save without an invented previous version', () =>
    expect(summarizeHistory(page('检查字幕'), null).label).toContain(
      '首次保存',
    ));
  it('quotes added Chinese text', () =>
    expect(
      summarizeHistory(page('检查字幕和数字'), page('检查字幕')).details,
    ).toContain('新增：「和数字」'));
  it('quotes removed text rather than current text', () =>
    expect(
      summarizeHistory(page('检查字幕'), page('检查字幕和数字')).details,
    ).toContain('删除：「和数字」'));
  it('reports replacement additions and deletions', () => {
    const s = summarizeHistory(page('检查人名'), page('检查数字'));
    expect(s.added).toBe(2);
    expect(s.deleted).toBe(2);
  });
  it('reports title-only edits', () => {
    const s = summarizeHistory(
      { ...page('正文'), title: '新标题' },
      page('正文'),
    );
    expect(s.label).toBe('修改标题');
    expect(s.details[0]).toContain('新标题');
    expect(s.added).toBe(0);
  });
  it('reports formatting-only changes even when text is identical', () => {
    const current = page('标准');
    (current.content.content[0].content[0] as any).marks = [{ type: 'bold' }];
    expect(summarizeHistory(current, page('标准')).label).toContain(
      '样式或结构调整',
    );
  });
  it('reports position changes', () =>
    expect(
      summarizeHistory(
        { ...page('正文'), position: 'b0' },
        { ...page('正文'), position: 'a0' },
      ).label,
    ).toContain('调整位置'));
  it('reports icon changes', () =>
    expect(
      summarizeHistory({ ...page('正文'), icon: '新' }, page('正文')).label,
    ).toContain('图标'));
  it('reports deletion and restoration explicitly', () => {
    expect(
      summarizeHistory({ ...page('文'), deletedAt: '2026-10-02' }, page('文'))
        .label,
    ).toContain('回收站');
    expect(
      summarizeHistory(page('文'), { ...page('文'), deletedAt: '2026-10-02' })
        .label,
    ).toContain('恢复');
  });
  it('does not infer reasons for unchanged visible content', () =>
    expect(summarizeHistory(page('文'), page('文')).label).toBe(
      '协同状态更新',
    ));
  it('does not fetch media or include secret-shaped resource URLs', () => {
    const p = {
      content: {
        type: 'image',
        attrs: { src: 'https://private.invalid/token' },
      },
    };
    expect(JSON.stringify(summarizeHistory(p, null))).not.toContain(
      'private.invalid',
    );
  });
  it('extracts text inside tables and layout containers', () =>
    expect(
      historyText({
        type: 'table',
        content: [{ type: 'tableCell', content: [doc('必须复核')] }],
      }),
    ).toContain('必须复核'));
  it('bounds long input and marks abbreviated summaries', () => {
    const s = summarizeHistory(
      page('甲'.repeat(40000)),
      page('乙'.repeat(40000)),
    );
    expect(s.limited).toBe(true);
    expect(s.added).toBeNull();
  });
  it('respects database size limits without calling missing body unchanged', () =>
    expect(
      summarizeHistory({ title: 'a' }, { title: 'a' }, true).label,
    ).toContain('内容较长'));
  it('does not mutate source content', () => {
    const p = page('原文');
    const old = JSON.stringify(p);
    summarizeHistory(p, null);
    expect(JSON.stringify(p)).toBe(old);
  });
  it('counts Unicode codepoints rather than UTF16 halves', () =>
    expect(summarizeHistory(page('😀'), page('')).added).toBe(1));
});
