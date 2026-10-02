// A believable website: it previews what it receives and enforces its own rules, the way
// real sites do, so the difference Just Upload makes is visible.

const MB = 1_000_000;
const sizeText = (bytes: number) =>
  bytes < MB ? `${Math.round(bytes / 1000)} KB` : `${(bytes / MB).toFixed(1)} MB`;

function status(id: string, text: string, ok: boolean): void {
  const line = document.getElementById(`${id}-status`)!;
  line.textContent = text;
  line.className = `status ${ok ? 'ok' : 'bad'}`;
}

function preview(id: string, file: File | undefined): void {
  const box = document.getElementById(`${id}-preview`)!;
  box.style.backgroundImage = file ? `url("${URL.createObjectURL(file)}")` : '';
  box.classList.toggle('filled', Boolean(file));
}

async function dimensions(file: File): Promise<{ width: number; height: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}

function watch(id: string, check: (file: File) => Promise<string | undefined>): void {
  document.getElementById(id)!.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const problem = await check(file);
    if (problem) {
      preview(id, undefined);
      status(id, `“${file.name}” can't be used. ${problem}`, false);
    } else {
      preview(id, file);
      status(id, `✓ ${file.name} · ${sizeText(file.size)}`, true);
    }
  });
}

watch('photo', async (file) =>
  ['image/jpeg', 'image/png'].includes(file.type) && file.size <= 2 * MB
    ? undefined
    : 'Please choose a JPG or PNG under 2 MB.',
);
watch('square', async (file) => {
  const size = await dimensions(file);
  return size && size.width === 600 && size.height === 600
    ? undefined
    : 'Please choose a square image, 600 × 600 pixels.';
});
watch('logo', async (file) => (file.type === 'image/jpeg' ? undefined : 'Please choose a JPG.'));

// A drag-and-drop area of the kind many sites build themselves.
const drop = document.getElementById('portfolio')!;
const input = document.getElementById('portfolio-input') as HTMLInputElement;
const items = document.getElementById('portfolio-items')!;
function addPhotos(files: readonly File[]): void {
  const accepted = files.filter((file) => file.type === 'image/jpeg' && file.size <= 2 * MB);
  const rejected = files.filter((file) => !accepted.includes(file));
  for (const file of accepted) {
    const figure = document.createElement('figure');
    const image = document.createElement('div');
    image.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    figure.append(image, `${file.name} · ${sizeText(file.size)}`);
    items.append(figure);
  }
  document.getElementById('portfolio-label')!.hidden = items.childElementCount > 0;
  if (rejected.length) {
    status('portfolio', `“${rejected[0]!.name}” can't be used. Please add JPGs under 2 MB.`, false);
  } else if (accepted.length) {
    status('portfolio', `✓ ${accepted.length} photo${accepted.length > 1 ? 's' : ''} added`, true);
  }
}
drop.addEventListener('click', () => input.click());
input.addEventListener('change', () => addPhotos(Array.from(input.files ?? [])));
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('active');
});
drop.addEventListener('dragleave', () => drop.classList.remove('active'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('active');
  addPhotos(Array.from(event.dataTransfer?.files ?? []));
});
