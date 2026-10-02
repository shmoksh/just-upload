import { useRef } from 'react';
import { createRoot } from 'react-dom/client';

interface Receipt {
  field: string;
  via: string;
  files: { name: string; type: string; size: number }[];
}

declare global {
  interface Window {
    receipts: Receipt[];
    /** When each receipt was recorded (epoch ms), for latency measurements. */
    receiptTimes: number[];
  }
}

// End-to-end tests read window.receipts; people read the list on the page.
window.receipts = [];
window.receiptTimes = [];
const log = document.querySelector<HTMLOListElement>('#log')!;

function sizeLabel(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function record(field: string, via: string, files: ArrayLike<File> | null): void {
  const receipt: Receipt = {
    field,
    via,
    files: Array.from(files ?? []).map(({ name, type, size }) => ({ name, type, size })),
  };
  window.receipts.push(receipt);
  window.receiptTimes.push(performance.timeOrigin + performance.now());
  const item = document.createElement('li');
  const summary = receipt.files.length
    ? receipt.files
        .map((file) => `${file.name} (${file.type || 'no type'}, ${sizeLabel(file.size)})`)
        .join(', ')
    : 'no file';
  item.textContent = `${field} · ${via} · ${summary}`;
  log.prepend(item);
}

function listen(input: HTMLInputElement): void {
  input.addEventListener('input', () => record(input.id, 'input', input.files));
  input.addEventListener('change', () => record(input.id, 'change', input.files));
}

for (const input of document.querySelectorAll<HTMLInputElement>('main input[type="file"]')) {
  if (input.id !== 'form-image') listen(input);
}

// A typical React pattern: a styled button opens a hidden input and the change
// handler starts uploading immediately.
function ReactUpload() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()}>
        Upload photo
      </button>
      <input
        ref={input}
        id="react-image"
        type="file"
        accept="image/jpeg"
        hidden
        onChange={(event) => record('react-image', 'react-upload', event.currentTarget.files)}
      />
    </>
  );
}
createRoot(document.querySelector('#react-root')!).render(<ReactUpload />);

document.querySelector('#add-input')!.addEventListener('click', () => {
  if (document.querySelector('#dynamic')) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'dynamic';
  input.accept = '.jpg,.jpeg';
  input.setAttribute('aria-label', 'Choose a JPG image');
  document.querySelector('#dynamic-section')!.append(input);
  listen(input);
});

document.querySelector<HTMLFormElement>('#form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const file = new FormData(event.currentTarget as HTMLFormElement).get('image');
  record('form-image', 'submit', file instanceof File && file.size ? [file] : []);
});

document.querySelector('#clear')!.addEventListener('click', () => {
  window.receipts.length = 0;
  log.replaceChildren();
});
