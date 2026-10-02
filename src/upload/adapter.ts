/**
 * How a kind of upload control is recognised, filled and resumed. Only standard
 * <input type="file"> exists today; site-specific adapters can be added beside it
 * without touching the interceptor.
 */
export interface UploadAdapter {
  matches(target: EventTarget | null | undefined): target is HTMLInputElement;
  /** Puts these files into the control, or throws and leaves it unchanged. */
  replace(input: HTMLInputElement, files: File[]): void;
  /** Re-delivers the held events so the site continues as after a normal selection. */
  resume(input: HTMLInputElement, types: readonly string[], mark: (event: Event) => void): void;
  /** Re-delivers a held drop, carrying these files, where the person dropped them. */
  redrop(
    target: Element,
    files: readonly File[],
    init: DropPosition,
    mark: (event: Event) => void,
  ): void;
}

/** Where and how the original drop happened, so the replayed one looks the same. */
export type DropPosition = Pick<
  MouseEventInit,
  'clientX' | 'clientY' | 'screenX' | 'screenY' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

export function dropPosition(event: DragEvent): DropPosition {
  const { clientX, clientY, screenX, screenY, altKey, ctrlKey, metaKey, shiftKey } = event;
  return { clientX, clientY, screenX, screenY, altKey, ctrlKey, metaKey, shiftKey };
}

export const nativeInputAdapter: UploadAdapter = {
  matches: (target): target is HTMLInputElement =>
    target instanceof HTMLInputElement && target.type === 'file' && !target.disabled,

  replace(input, files) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    const applied = input.files;
    if (
      !applied ||
      applied.length !== files.length ||
      files.some((file, i) => applied[i] !== file && applied[i]?.name !== file.name)
    ) {
      throw new Error('replacement-failed');
    }
  },

  resume(input, types, mark) {
    for (const type of types) {
      // Same shape as the browser's own events: input is composed, change is not.
      const event = new Event(type, { bubbles: true, composed: type === 'input' });
      mark(event);
      input.dispatchEvent(event);
    }
  },

  redrop(target, files, init, mark) {
    const dataTransfer = new DataTransfer();
    for (const file of files) dataTransfer.items.add(file);
    const event = new DragEvent('drop', {
      ...init,
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    });
    mark(event);
    target.dispatchEvent(event);
  },
};

export function filesOf(input: HTMLInputElement): File[] {
  return Array.from(input.files ?? []);
}

export function sameFiles(left: readonly File[], right: readonly File[]): boolean {
  return left.length === right.length && left.every((file, i) => file === right[i]);
}
