import { createRoot } from 'react-dom/client';
import { useDropzone } from 'react-dropzone';
import * as FilePond from 'filepond';
import 'filepond/dist/filepond.min.css';
import Dropzone from 'dropzone';

interface Receipt {
  field: string;
  via: string;
  files: { name: string; type: string; size: number }[];
}
declare global {
  interface Window {
    receipts: Receipt[];
    receiptTimes: number[];
  }
}
window.receipts = [];
window.receiptTimes = [];
const log = document.querySelector<HTMLOListElement>('#log')!;

function record(field: string, via: string, files: readonly File[]): void {
  const receipt = {
    field,
    via,
    files: files.map(({ name, type, size }) => ({ name, type, size })),
  };
  window.receipts.push(receipt);
  window.receiptTimes.push(performance.timeOrigin + performance.now());
  const item = document.createElement('li');
  item.textContent = `${field} · ${via} · ${receipt.files.map((file) => `${file.name} (${file.type})`).join(', ')}`;
  log.prepend(item);
}

// React Dropzone, as its documentation shows it: accept and maxSize are enforced by the
// library itself, and the hidden input lives inside the drop area.
function ReactDropzone() {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
    maxSize: 2_000_000,
    onDrop: (accepted, rejected) => {
      if (accepted.length) record('react-dropzone', 'accepted', accepted);
      if (rejected.length)
        record(
          'react-dropzone',
          'rejected',
          rejected.map((entry) => entry.file),
        );
    },
  });
  return (
    <div {...getRootProps({ className: 'dropzone-box', id: 'react-dropzone' })}>
      <input {...getInputProps()} />
      <p>{isDragActive ? 'Drop it here' : 'Drag a photo here, or click to choose'}</p>
    </div>
  );
}
createRoot(document.querySelector('#react-dropzone-root')!).render(<ReactDropzone />);

// FilePond replaces the input with its own widget and hidden input.
const pond = FilePond.create(document.querySelector<HTMLInputElement>('#filepond')!, {
  allowMultiple: false,
  credits: false,
});
pond.on('addfile', (error, item) => {
  if (!error) record('filepond', 'accepted', [item.file as File]);
});

// Dropzone.js keeps its hidden input at the end of <body>, away from the drop area.
(Dropzone as unknown as { autoDiscover: boolean }).autoDiscover = false;
const zone = new Dropzone('#dropzone', {
  url: '/nowhere',
  autoProcessQueue: false,
  acceptedFiles: 'image/jpeg',
  maxFilesize: 2,
  dictDefaultMessage: 'JPG only · max 2 MB. Drop or click.',
});
zone.on('addedfile', (file) => {
  // Dropzone validates after adding; wait for its verdict.
  setTimeout(
    () => record('dropzone', file.accepted === false ? 'rejected' : 'accepted', [file]),
    0,
  );
});
