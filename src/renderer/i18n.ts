import enUS from './locales/en-US.json';

// 所有翻译外置到 ./locales/*.json，每个文件一个语言。新增一个 lang 文件即被自动识别，
// 无需改代码。'_label' 是该语言在选择器中显示的名字，不作为内容 key。
type LocaleData = Record<string, string>;

// 类型基准取 en-US：保证 t(key) 的 key 受静态检查。
export type TranslationKey = Exclude<keyof typeof enUS, '_label'>;

// 语言代码是动态的（取决于存在哪些 lang 文件），所以是 string。
export type Language = string;

export interface LanguageOption {
  code: string;
  label: string;
}

// 构建期把 locales/*.json 全部内联进来（eager），运行时不读磁盘。
const modules = import.meta.glob<LocaleData>('./locales/*.json', { eager: true, import: 'default' });

const catalog: Record<string, LocaleData> = {};
for (const filePath in modules) {
  const code = filePath.replace(/^.*\/(.+)\.json$/, '$1');
  catalog[code] = modules[filePath];
}

const FALLBACK: Language = catalog['en-US'] ? 'en-US' : Object.keys(catalog)[0];

// 选择器里可选的语言，按代码排序，显示各自的 _label。
export const availableLanguages: LanguageOption[] = Object.keys(catalog)
  .sort()
  .map((code) => ({ code, label: catalog[code]['_label'] || code }));

export function detectLanguage(): Language {
  const saved = localStorage.getItem('sbc-language');
  if (saved && catalog[saved]) return saved;
  const nav = navigator.language.toLowerCase();
  const exact = Object.keys(catalog).find((code) => code.toLowerCase() === nav);
  if (exact) return exact;
  const prefix = Object.keys(catalog).find((code) => nav.startsWith(code.split('-')[0].toLowerCase()));
  return prefix ?? FALLBACK;
}

export function saveLanguage(language: Language): void {
  localStorage.setItem('sbc-language', language);
}

export function translate(language: Language, key: TranslationKey): string {
  const dict = catalog[language] ?? catalog[FALLBACK];
  return dict[key] ?? catalog[FALLBACK]?.[key] ?? String(key);
}
