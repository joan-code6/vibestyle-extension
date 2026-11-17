import { describe, expect, it } from 'vitest';
import { parseChange, validateChange, validateSettings } from '../src/shared/validation';
import { hostnameFromUrl, scriptId, siteMatches } from '../src/shared/site';

describe('generated changes', () => {
  it('accepts complete CSS/JavaScript results and fenced JSON', () => {
    const change = { summary: 'A wider article.', css: 'main { max-width: 85ch !important; --space: 2rem; }', js: '' };
    expect(parseChange('```json\n' + JSON.stringify(change) + '\n```')).toEqual(change);
    expect(validateChange({ ...change, js: 'document.querySelector("aside")?.remove();' }).js).toContain('remove');
  });

  it.each([
    '@import "https://example.org/leak";',
    '@\\69mport "https://example.org/leak";',
    'body { background: url(https://example.org/leak) }',
    'body { --image: url(https://example.org/leak); background: var(--image) }',
    'body { background: image-set("https://example.org/leak" 1x) }',
    'body { background: \\69mage-set("https://example.org/leak" 1x) }',
  ])('rejects external resources, including escaped CSS: %s', css => {
    expect(() => validateChange({ summary: 'Changed', css, js: '' })).toThrow();
  });

  it('rejects malformed, incomplete, and oversized model output', () => {
    expect(() => parseChange('{"css":"body{}"')).toThrow('complete change');
    expect(() => validateChange({ summary: 'Hi', css: 2, js: '' })).toThrow('css');
    expect(() => validateChange({ summary: 'Hi', css: '', js: 'if (' })).toThrow('JavaScript');
    expect(() => validateChange({ summary: 'Hi', css: ' '.repeat(80_001), js: '' })).toThrow('large');
  });

  it('rejects unknown providers and header injection', () => {
    expect(() => validateSettings({ provider: 'other', model: 'abc', apiKey: 'key' })).toThrow();
    expect(() => validateSettings({ provider: 'openrouter', model: 'abc', apiKey: 'key\r\nfoo' })).toThrow();
    expect(validateSettings({ provider: 'hackclub', model: ' abc ', apiKey: ' key ' }).model).toBe('abc');
  });
});

describe('site scope', () => {
  it('supports only normal web pages and exact hostnames', () => {
    expect(hostnameFromUrl('https://www.example.com/private?token=secret')).toBe('www.example.com');
    expect(hostnameFromUrl('about:addons')).toBeNull();
    expect(hostnameFromUrl('chrome://settings')).toBeNull();
    expect(hostnameFromUrl('file:///local.html')).toBeNull();
    expect(siteMatches('example.com')).toEqual(['http://example.com/*', 'https://example.com/*']);
    expect(() => siteMatches('example.com/path')).toThrow();
    expect(scriptId('a-b.com')).not.toBe(scriptId('a.b.com'));
  });
});
