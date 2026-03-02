export type ActionPayload = {
  actionKey: string;
  id: string;
  actionElement: HTMLElement;
};

export function readActionPayload(event: Event): ActionPayload | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;
  const actionElement = target.closest('[data-action]') as HTMLElement | null;
  if (!actionElement) return null;

  const actionKey = actionElement.dataset.action || '';
  if (!actionKey) return null;

  return {
    actionKey,
    id: actionElement.dataset.id || '',
    actionElement,
  };
}
