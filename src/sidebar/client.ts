import { api } from '../shared/browser';
import type { Reply, Request } from '../shared/types';

export async function send<T>(request: Request): Promise<T> {
  const reply = await api.runtime.sendMessage(request) as Reply<T> | undefined;
  if (!reply) throw new Error('The extension background is restarting. Try again.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
