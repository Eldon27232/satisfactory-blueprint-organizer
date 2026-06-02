import { describe, expect, it } from 'vitest';
import { normalizeReleaseNotes, pickReleaseNotes } from '../src/shared/releaseNotes';

// GitHub 把 release body(Markdown) 渲染成 HTML 后由 electron-updater 的 atom 回退路径喂给客户端，
// 形如下面这段。客户端必须能把它正确分段并显示。
const HTML_NOTES = '<h2>简体中文</h2>\n<ul>\n<li>新增 <strong>Linux 版本（AppImage）</strong>：自动识别存档路径。</li>\n<li>安装包体积大幅缩小。</li>\n</ul>\n<h2>English</h2>\n<ul>\n<li>New <strong>Linux build (AppImage)</strong>: auto-detect saves.</li>\n</ul>';

const MARKDOWN_NOTES = '## 简体中文\n- 新增 Linux 版本（AppImage）。\n- 安装包体积大幅缩小。\n## English\n- New Linux build (AppImage).';

describe('normalizeReleaseNotes', () => {
  it('converts GitHub-rendered HTML back to markdown-ish text', () => {
    const out = normalizeReleaseNotes(HTML_NOTES);
    expect(out).toContain('## 简体中文');
    expect(out).toContain('## English');
    expect(out).toContain('- 新增 Linux 版本（AppImage）：自动识别存档路径。');
    expect(out).not.toMatch(/<[a-z]/i); // 不留任何 HTML 标签
  });

  it('leaves plain markdown unchanged', () => {
    expect(normalizeReleaseNotes(MARKDOWN_NOTES)).toBe(MARKDOWN_NOTES);
  });
});

describe('pickReleaseNotes', () => {
  it('picks the Chinese section for zh UI from HTML notes', () => {
    const zh = pickReleaseNotes(HTML_NOTES, 'zh-CN');
    expect(zh).toContain('- 新增 Linux 版本（AppImage）：自动识别存档路径。');
    expect(zh).not.toContain('English');
    expect(zh).not.toContain('New Linux build');
  });

  it('picks the English section for en UI from HTML notes', () => {
    const en = pickReleaseNotes(HTML_NOTES, 'en-US');
    expect(en).toContain('- New Linux build (AppImage): auto-detect saves.');
    expect(en).not.toContain('简体中文');
  });

  it('picks the Chinese section for zh UI from markdown notes', () => {
    const zh = pickReleaseNotes(MARKDOWN_NOTES, 'zh-CN');
    expect(zh).toContain('- 新增 Linux 版本（AppImage）。');
    expect(zh).not.toContain('English');
  });

  it('falls back to the full text when there are no language headers', () => {
    expect(pickReleaseNotes('just a note', 'zh-CN')).toBe('just a note');
  });
});
