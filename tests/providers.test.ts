import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChange, listModels, readCompletion } from '../src/providers';

afterEach(() => vi.unstubAllGlobals());

describe('provider requests', () => {
  it('uses the selected endpoint, authenticates, and filters non-text models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [
      { id: 'image-only', architecture: { output_modalities: ['image'] } },
      { id: 'text-model', name: 'Text', architecture: { output_modalities: ['text'] } },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('hackclub', 'key')).toEqual([{ id: 'text-model', name: 'Text' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.hackclub.com/proxy/v1/models');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer key');
  });

  it('preserves prior code and passes page content as data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Wider.', css: 'main { width: 90% }', js: '' }) } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await generateChange({ provider: 'openrouter', apiKey: 'secret-key', model: 'test/model' }, { elements: [] }, null, 'Make it wider');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[0].role).toBe('system');
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ request: 'Make it wider', pageSnapshot: { elements: [] } });
    expect(request.stream).toBe(true);
  });

  it('never reflects provider errors that might include secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bearer private-key: private page', { status: 401 })));
    await expect(listModels('openrouter', 'private-key')).rejects.toThrow('API key was rejected');
    await expect(listModels('openrouter', 'private-key')).rejects.not.toThrow('private-key');
  });

  it('includes the initial screenshot as image input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Done', css: '', js: '' }) } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await generateChange({ provider: 'openrouter', apiKey: 'key', model: 'vision' }, {}, null, 'Change it', 'data:image/jpeg;base64,fixture');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,fixture' } });
  });

  it('reads SSE split across arbitrary byte boundaries', async () => {
    const wire = ': keepalive\r\ndata: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }) + '\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: { content: 'world ✓' } }] }) + '\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(wire);
    const body = new ReadableStream({ start(controller) {
      for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
      controller.close();
    } });
    expect(await readCompletion(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))).toBe('Hello world ✓');
  });

  it('rejects truncated streams and provider-side streaming errors', async () => {
    const response = (value: unknown) => new Response('data: ' + JSON.stringify(value) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    await expect(readCompletion(response({ choices: [{ finish_reason: 'length', delta: { content: 'partial' } }] }))).rejects.toThrow('output space');
    await expect(readCompletion(response({ error: { message: 'private-key' } }))).rejects.toThrow('could not complete');
  });
});
