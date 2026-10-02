interface Receipt {
  field: string;
  via: string;
  files: { name: string; type: string; size: number }[];
}
declare global {
  interface Window {
    receipts: Receipt[];
  }
}
window.receipts = [];
const input = document.querySelector<HTMLInputElement>('#square')!;
input.addEventListener('change', () => {
  const files = Array.from(input.files ?? []).map(({ name, type, size }) => ({ name, type, size }));
  window.receipts.push({ field: 'square', via: 'change', files });
});
export {};
