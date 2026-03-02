import { actions, type ActionContext } from './actions';
import { readActionPayload } from './payload';

function shouldWarnUnknownAction(): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  if (viteEnv?.DEV === true) return true;

  try {
    const profile = window.localStorage.getItem('profile_render');
    return profile === '1' || profile === 'true' || profile === 'on';
  } catch {
    return false;
  }
}

export async function dispatchAction(
  event: Event,
  createContext: (payload: { actionKey: string; id: string; actionElement: HTMLElement }) => ActionContext,
): Promise<boolean> {
  const payload = readActionPayload(event);
  if (!payload) return false;

  const handler = actions[payload.actionKey];
  if (!handler) {
    if (shouldWarnUnknownAction()) {
      // eslint-disable-next-line no-console
      console.warn(`[action-map] unknown action: ${payload.actionKey}`);
    }
    return false;
  }

  const ctx = createContext(payload);
  await handler(ctx);
  return true;
}
