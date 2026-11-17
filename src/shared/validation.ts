import * as cssTree from 'css-tree';
import { parse } from 'acorn';
import type { GeneratedChange, Settings } from './types';

export function validateSettings(input: unknown): Settings {
  const value = input as Partial<Settings> | null;
  if (!value || !['openrouter', 'hackclub'].includes(value.provider ?? '') ||
    typeof value.apiKey !== 'string' || !value.apiKey.trim() || value.apiKey.length > 1024 || /[\r\n]/.test(value.apiKey) ||
    typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200) {
    throw new Error('Choose a provider, enter an API key, and select a model.');
  }
  return { provider: value.provider!, apiKey: value.apiKey.trim(), model: value.model.trim() };
}

export function validateChange(input: unknown): GeneratedChange {
  if (!input || typeof input !== 'object') throw new Error('The model returned an invalid change. Try a different model.');
  const value = input as Record<string, unknown>;
  for (const field of ['summary', 'css', 'js']) {
    if (typeof value[field] !== 'string') throw new Error(`The model did not return valid ${field}. Try again.`);
  }
  const { summary, css, js } = value as unknown as GeneratedChange;
  if (!summary.trim() || summary.length > 1200 || css.length > 80_000 || js.length > 60_000) {
    throw new Error('The generated change is too large or missing its summary. Try a smaller request.');
  }
  const tree = cssTree.parse(css, { parseCustomProperty: true, onParseError: () => { throw new Error('The model returned invalid CSS. Try again.'); } });
  cssTree.walk(tree, node => {
    if (node.type === 'Raw') throw new Error('The model returned CSS that could not be validated. Try again.');
    if (node.type === 'Url' || (node.type === 'Atrule' && ['import', 'namespace', 'document', '-moz-document'].includes(cssTree.ident.decode(node.name).toLowerCase())) ||
      (node.type === 'Function' && ['url', 'src', 'image', 'image-set', '-webkit-image-set', 'expression', 'paint'].includes(cssTree.ident.decode(node.name).toLowerCase()))) {
      throw new Error('External resources are not allowed in generated CSS. Ask for a change using local styles.');
    }
  });
  if (js.trim()) {
    try { parse(`(async () => {\n${js}\n})()`, { ecmaVersion: 'latest', sourceType: 'script' }); }
    catch { throw new Error('The model returned invalid JavaScript. Try again.'); }
  }
  return { summary: summary.trim(), css: css.trim(), js: js.trim() };
}

export function parseChange(text: string): GeneratedChange {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(cleaned); }
  catch { throw new Error('The model did not return a complete change. Try again or choose a different model.'); }
  return validateChange(value);
}
