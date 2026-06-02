// 更新公告解析。约定 release 用二级标题分双语段：「## 简体中文」与「## English」。
//
// 注意 electron-updater 的 GitHub provider：只有当 latest.yml 自带 releaseNotes 时才用它，
// 否则回退去拉 releases.atom，而 atom 里 GitHub 已把 Markdown 渲染成 HTML（<h2>/<ul>/<li>）。
// 为了不管收到 Markdown 还是 HTML 都能正确分段+显示，这里先把 HTML 归一化回 Markdown 风格。

// 把 GitHub 渲染的 HTML 公告归一化成 Markdown 风格（标题 ##、列表 -）。
// 输入已经是 Markdown（不含标签）时原样返回。
export function normalizeReleaseNotes(raw: string): string {
  if (!/<[a-z][^>]*>/i.test(raw)) return raw; // 没有 HTML 标签：本就是 Markdown
  let text = raw;
  text = text.replace(/<h[1-6][^>]*>/gi, '\n## ').replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  text = text.replace(/<\/(p|ul|ol|div)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ''); // 剥掉剩余行内标签（strong/em/a…）
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3?9;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 按界面语言取对应区块。中文界面取中文段、其它取英文段；无标记则回退显示全文。
export function pickReleaseNotes(notes: string, language: string): string {
  const normalized = normalizeReleaseNotes(notes);
  const section = (header: RegExp): string | undefined => header.exec(normalized)?.[1]?.trim();
  const zh = section(/##\s*(?:简体中文|中文)\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i);
  const en = section(/##\s*English\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i);
  const preferZh = language.toLowerCase().startsWith('zh');
  return (preferZh ? zh ?? en : en ?? zh) ?? normalized.trim();
}
