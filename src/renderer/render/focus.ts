export type FocusSnapshot = {
  refocusId: string;
  shouldRefocusInput: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
};

export function captureFocusSnapshot(): FocusSnapshot {
  const activeElement = document.activeElement as HTMLElement | null;
  const refocusId = activeElement?.id || '';
  const isInput = activeElement instanceof HTMLInputElement;
  const isTextArea = activeElement instanceof HTMLTextAreaElement;
  const shouldRefocusInput = isInput || isTextArea;

  return {
    refocusId,
    shouldRefocusInput,
    selectionStart: isInput ? activeElement.selectionStart : null,
    selectionEnd: isInput ? activeElement.selectionEnd : null,
  };
}

export function restoreFocusSnapshot(snapshot: FocusSnapshot): void {
  if (!snapshot.refocusId) return;

  const nextEl = document.getElementById(snapshot.refocusId) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!nextEl || nextEl === document.activeElement) return;

  nextEl.focus();
  if (
    snapshot.shouldRefocusInput &&
    nextEl instanceof HTMLInputElement &&
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null
  ) {
    nextEl.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}
