import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Processor } from '../../src/images/client';
import type { PrepareOutcome } from '../../src/images/transform';
import type { Decision, Settings, TransformResult, UploadRequirements } from '../../src/models';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { PageUi } from '../../src/ui/injected';
import type { UploadAdapter } from '../../src/upload/adapter';
import { installInterceptor } from '../../src/upload/interceptor';
import { ProcessingError } from '../../src/utils/errors';
import { fileOf, heicBytes, jpegBytes, pngBytes } from './helpers/images';

// happy-dom cannot set input.files, so the tests keep each input's selection here.
const selections = new WeakMap<HTMLInputElement, File[]>();
function track(input: HTMLInputElement): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    get: () => selections.get(input) ?? [],
  });
}
const adapter: UploadAdapter = {
  matches: (target): target is HTMLInputElement =>
    target instanceof HTMLInputElement && target.type === 'file' && !target.disabled,
  replace: (input, files) => void selections.set(input, [...files]),
  resume: (input, types, mark) => {
    for (const type of types) {
      const event = new Event(type, { bubbles: true, composed: type === 'input' });
      mark(event);
      input.dispatchEvent(event);
    }
  },
  redrop: (target, files, _position, mark) => {
    const event = dropEvent(files);
    mark(event);
    target.dispatchEvent(event);
  },
};

/** happy-dom has no DataTransfer; a drop event only needs its file list here. */
function dropEvent(files: readonly File[], types = ['Files']): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types } });
  return event;
}
function dropFiles(target: Element, files: File[]): Event {
  const event = dropEvent(files);
  target.dispatchEvent(event);
  return event;
}

/** What a person's selection looks like to the page: new files, then input and change. */
function choose(input: HTMLInputElement, files: File[]): void {
  selections.set(input, files);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const converted = (name: string): TransformResult => ({
  file: new File([new Uint8Array(10)], name, { type: 'image/jpeg' }),
  changes: ['converted'],
  originalSize: 100,
  finalSize: 10,
  originalWidth: 10,
  originalHeight: 10,
  finalWidth: 10,
  finalHeight: 10,
  originalFormat: 'heic',
  finalFormat: 'jpeg',
  qualityKept: 99,
  resizedToFit: false,
  sizeLimited: false,
});

const heic = (name = 'IMG_1.HEIC') => fileOf(heicBytes(), name, 'image/heic');
const jpeg = (name = 'photo.jpg', width = 800, height = 600) =>
  fileOf(jpegBytes({ width, height }), name, 'image/jpeg');

let settings: Settings;
let hostnames: string[];
let prepare: ReturnType<typeof vi.fn<Processor['prepare']>>;
let transform: ReturnType<typeof vi.fn<Processor['transform']>>;
let ui: {
  processing: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  failure: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
};
let onFixed: ReturnType<typeof vi.fn<(results: TransformResult[]) => void>>;
let onProblem: ReturnType<
  typeof vi.fn<(code: string, files: readonly File[], requirements: UploadRequirements) => void>
>;
let warm: ReturnType<typeof vi.fn<() => void>>;
let dispose: () => void;
let seen: { event: string; names: string[] }[];

function page(markup: string): HTMLInputElement {
  document.body.innerHTML = markup;
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  track(input);
  for (const type of ['input', 'change']) {
    input.addEventListener(type, () =>
      seen.push({ event: type, names: (selections.get(input) ?? []).map((file) => file.name) }),
    );
  }
  return input;
}
const changes = () => seen.filter((entry) => entry.event === 'change').map((entry) => entry.names);

beforeEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  hostnames = ['example.com'];
  seen = [];
  prepare = vi.fn<Processor['prepare']>(async (file) => ({
    kind: 'fixed',
    result: converted(file.name.replace(/\.\w+$/, '.jpg')),
  }));
  transform = vi.fn<Processor['transform']>(async (file) =>
    converted(file.name.replace(/\.\w+$/, '.jpg')),
  );
  ui = {
    processing: vi.fn(() => () => {}),
    success: vi.fn(),
    failure: vi.fn(),
    confirm: vi.fn(async () => ({})),
  };
  onFixed = vi.fn<(results: TransformResult[]) => void>();
  onProblem =
    vi.fn<(code: string, files: readonly File[], requirements: UploadRequirements) => void>();
  warm = vi.fn<() => void>();
  dispose = installInterceptor({
    warm,
    settings: () => settings,
    hostnames: () => hostnames,
    processor: { prepare, transform },
    ui: ui as unknown as PageUi,
    onFixed,
    onProblem,
    adapter,
  });
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

describe('compatible files', () => {
  it('reach the page synchronously, with no processing at all (acceptance 3)', () => {
    const input = page(
      '<p id="h">JPG/PNG · max 2MB</p><input type="file" accept=".jpg,.png" aria-describedby="h">',
    );
    choose(input, [jpeg()]);
    expect(seen).toEqual([
      { event: 'input', names: ['photo.jpg'] },
      { event: 'change', names: ['photo.jpg'] },
    ]);
    expect(prepare).not.toHaveBeenCalled();
    expect(ui.success).not.toHaveBeenCalled();
  });
  it('are confirmed from the header alone on fields with size rules', async () => {
    const input = page(
      '<p id="h">Maximum 1920 × 1920 pixels</p><input type="file" accept="image/jpeg" aria-describedby="h">',
    );
    choose(input, [jpeg('small.jpg', 800, 600)]);
    expect(seen).toEqual([]);
    await vi.waitFor(() => expect(changes()).toEqual([['small.jpg']]));
    expect(prepare).not.toHaveBeenCalled();
    expect(ui.failure).not.toHaveBeenCalled();
  });
  it('are never touched on non-image fields or while paused', () => {
    const pdf = page('<input type="file" accept="application/pdf">');
    choose(pdf, [heic()]);
    expect(changes()).toEqual([['IMG_1.HEIC']]);
    seen = [];
    hostnames = ['example.com', 'paused.example'];
    settings = { ...settings, disabledSites: ['paused.example'] };
    const jpg = page('<input type="file" accept="image/jpeg">');
    choose(jpg, [heic()]);
    expect(changes()).toEqual([['IMG_1.HEIC']]);
    settings = { ...settings, enabled: false, disabledSites: [] };
    choose(jpg, [heic('b.heic')]);
    expect(changes()).toEqual([['IMG_1.HEIC'], ['b.heic']]);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('fixing a file', () => {
  it('holds both events until the replacement is ready, then delivers only the replacement', async () => {
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    expect(seen).toEqual([]);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      { event: 'input', names: ['IMG_1.jpg'] },
      { event: 'change', names: ['IMG_1.jpg'] },
    ]);
    expect(ui.success).toHaveBeenCalledTimes(1);
    expect(onFixed).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![1]).toMatchObject({ acceptedMimeTypes: ['image/jpeg'] });
  });
  it('respects "show success notifications" without skipping the fix', async () => {
    settings = { ...settings, showNotifications: false };
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
    expect(ui.success).not.toHaveBeenCalled();
    expect(onFixed).toHaveBeenCalled();
  });
  it('keeps the order of several files and only replaces the ones that need it', async () => {
    const input = page('<input type="file" accept="image/jpeg" multiple>');
    choose(input, [heic('a.heic'), jpeg('b.jpg'), heic('c.heic')]);
    await vi.waitFor(() => expect(changes()).toEqual([['a.jpg', 'b.jpg', 'c.jpg']]));
    expect(prepare).toHaveBeenCalledTimes(2);
  });
  it('shows "Preparing image…" only when the work is slow', async () => {
    const slow = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(slow.promise);
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await new Promise((done) => setTimeout(done, 450));
    expect(ui.processing).toHaveBeenCalledTimes(1);
    slow.resolve({ kind: 'fixed', result: converted('IMG_1.jpg') });
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
  });
  it('holds a form submission until the prepared file is in place', async () => {
    const slow = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(slow.promise);
    const input = page(
      '<form><input type="file" name="image" accept="image/jpeg"><button>Send</button></form>',
    );
    const form = input.form!;
    const submitted: string[][] = [];
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted.push((selections.get(input) ?? []).map((file) => file.name));
    });
    choose(input, [heic()]);
    form.requestSubmit();
    expect(submitted).toEqual([]);
    slow.resolve({ kind: 'fixed', result: converted('IMG_1.jpg') });
    await vi.waitFor(() => expect(submitted).toEqual([['IMG_1.jpg']]));
  });
  it('works for inputs inside a shadow root, whose change event never reaches window', async () => {
    document.body.innerHTML = '<x-upload></x-upload>';
    const root = document.querySelector('x-upload')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input type="file" accept="image/jpeg">';
    const input = root.querySelector('input')!;
    track(input);
    const received: string[][] = [];
    input.addEventListener('change', () =>
      received.push((selections.get(input) ?? []).map((file) => file.name)),
    );
    choose(input, [heic()]);
    expect(received).toEqual([]);
    await vi.waitFor(() => expect(received).toEqual([['IMG_1.jpg']]));
  });
});

describe('asking first', () => {
  const decision: Decision = {
    action: 'USER_CONFIRMATION',
    issues: ['wrong-aspect-ratio'],
    outputFormat: 'jpeg',
    consents: ['crop'],
  };
  const confirm = (): PrepareOutcome => ({
    kind: 'confirm',
    decision,
    info: {
      format: 'jpeg',
      width: 900,
      height: 1200,
      bytes: 100,
      transparent: false,
      animated: false,
    },
    preview: new Blob(),
  });

  it('transforms with the approved crop', async () => {
    prepare.mockResolvedValueOnce(confirm());
    ui.confirm.mockResolvedValueOnce({ crop: { x: 0, y: 150, width: 900, height: 900 } });
    const input = page(
      '<p id="h">Square photo</p><input type="file" accept="image/jpeg" aria-describedby="h">',
    );
    choose(input, [jpeg('me.jpg', 900, 1200)]);
    await vi.waitFor(() => expect(changes()).toEqual([['me.jpg']]));
    expect(transform).toHaveBeenCalledTimes(1);
    expect(transform.mock.calls[0]![2]).toMatchObject({
      outputFormat: 'jpeg',
      crop: { x: 0, y: 150, width: 900, height: 900 },
    });
    expect(ui.confirm.mock.calls[0]![0]).toMatchObject({ removeOnDecline: false });
  });
  it('hands the original to the site when the person declines', async () => {
    prepare.mockResolvedValueOnce(confirm());
    ui.confirm.mockResolvedValueOnce(null);
    const input = page(
      '<p id="h">Square photo</p><input type="file" accept="image/jpeg" aria-describedby="h">',
    );
    const original = jpeg('me.jpg', 900, 1200);
    choose(input, [original]);
    await vi.waitFor(() => expect(changes()).toHaveLength(1));
    expect(selections.get(input)).toEqual([original]);
    expect(transform).not.toHaveBeenCalled();
    expect(ui.failure).not.toHaveBeenCalled();
  });
});

describe('asking before visible quality loss', () => {
  const kept = (qualityKept: number, resizedToFit = false): PrepareOutcome => ({
    kind: 'fixed',
    result: { ...converted('IMG_1.jpg'), qualityKept, resizedToFit, sizeLimited: true },
  });

  it('shows how much quality a file keeps, and uses it once approved', async () => {
    prepare.mockResolvedValueOnce(kept(91));
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    expect(ui.confirm.mock.calls[0]![0]).toMatchObject({
      quality: 91,
      decision: { consents: ['quality'] },
      removeOnDecline: false,
    });
    // The prepared file is used as it is: nothing is prepared twice.
    expect(transform).not.toHaveBeenCalled();
    expect(onFixed).toHaveBeenCalledWith([expect.objectContaining({ qualityKept: 91 })]);
  });
  it('gives the site the original when the person declines', async () => {
    prepare.mockResolvedValueOnce(kept(91));
    ui.confirm.mockResolvedValueOnce(null);
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.HEIC']]));
    expect(onFixed).not.toHaveBeenCalled();
  });
  it('does not ask when the file looks the same', async () => {
    prepare.mockResolvedValueOnce(kept(98));
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
    expect(ui.confirm).not.toHaveBeenCalled();
  });
  it('checks quality after a change the person chose, too', async () => {
    prepare.mockResolvedValueOnce({
      kind: 'confirm',
      decision: {
        action: 'USER_CONFIRMATION',
        issues: ['wrong-aspect-ratio'],
        outputFormat: 'jpeg',
        consents: ['crop'],
      },
      info: {
        format: 'heic',
        width: 900,
        height: 1200,
        bytes: 100,
        transparent: false,
        animated: false,
      },
      preview: new Blob(),
    });
    transform.mockResolvedValueOnce({
      ...converted('IMG_1.jpg'),
      qualityKept: 90,
      sizeLimited: true,
    });
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
    expect(ui.confirm).toHaveBeenCalledTimes(2);
    expect(ui.confirm.mock.calls[1]![0]).toMatchObject({ quality: 90 });
  });
});

describe('failing open', () => {
  it('gives the site the original file and a calm message when preparation fails', async () => {
    prepare.mockRejectedValueOnce(new ProcessingError('damaged'));
    const input = page('<input type="file" accept="image/jpeg">');
    const original = heic();
    choose(input, [original]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.HEIC']]));
    expect(selections.get(input)).toEqual([original]);
    expect(ui.failure).toHaveBeenCalledWith('damaged', false);
  });
  it('keeps a technical note of the failure, with the rules it read', async () => {
    prepare.mockRejectedValueOnce(new ProcessingError('damaged'));
    const input = page(
      '<p id="h">Max 2 MB</p><input type="file" accept=".jpg" aria-describedby="h">',
    );
    const original = heic();
    choose(input, [original]);
    await vi.waitFor(() => expect(onProblem).toHaveBeenCalledTimes(1));
    const [code, files, requirements] = onProblem.mock.calls[0]!;
    expect([code, files]).toEqual(['damaged', [original]]);
    expect(requirements.maxBytes).toBe(2_000_000);
  });
  it('keeps no note when a file was fixed', async () => {
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(changes()).toEqual([['IMG_1.jpg']]));
    expect(onProblem).not.toHaveBeenCalled();
  });
  it('stays quiet for files it simply does not understand', async () => {
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [fileOf(new Uint8Array(64).fill(7), 'mystery.heic', 'image/heic')]);
    await vi.waitFor(() => expect(changes()).toEqual([['mystery.heic']]));
    expect(prepare).not.toHaveBeenCalled();
    expect(ui.failure).not.toHaveBeenCalled();
  });
  it('reports a damaged file found by the in-page check', async () => {
    const input = page(
      '<p id="h">Maximum 1920 × 1920 pixels</p><input type="file" accept="image/png" aria-describedby="h">',
    );
    choose(input, [fileOf(pngBytes({ truncated: true }), 'broken.png', 'image/png')]);
    await vi.waitFor(() => expect(changes()).toEqual([['broken.png']]));
    expect(ui.failure).toHaveBeenCalledWith('damaged', false);
  });
  it('explains when an image is too large to prepare safely', async () => {
    const input = page('<input type="file" accept="image/jpeg">');
    const huge = heic('huge.heic');
    Object.defineProperty(huge, 'size', { value: 6 * 1024 ** 3 });
    choose(input, [huge]);
    await vi.waitFor(() => expect(changes()).toEqual([['huge.heic']]));
    expect(ui.failure).toHaveBeenCalledWith('too-large-to-process', false);
  });
});

describe('races', () => {
  it('never lets an earlier selection replace a later one', async () => {
    const first = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(first.promise);
    const input = page('<input type="file" accept="image/jpeg">');
    choose(input, [heic('first.heic')]);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    const second = jpeg('second.jpg');
    choose(input, [second]);
    expect(changes()).toEqual([['second.jpg']]);
    first.resolve({ kind: 'fixed', result: converted('first.jpg') });
    await new Promise((done) => setTimeout(done, 50));
    expect(changes()).toEqual([['second.jpg']]);
    expect(selections.get(input)).toEqual([second]);
    expect(prepare.mock.calls[0]![2].aborted).toBe(true);
  });
  it('drops the work when the input is removed while preparing', async () => {
    const slow = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(slow.promise);
    const input = page('<div><input type="file" accept="image/jpeg"></div>');
    choose(input, [heic()]);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    input.remove();
    await vi.waitFor(() => expect(prepare.mock.calls[0]![2].aborted).toBe(true));
    slow.resolve({ kind: 'fixed', result: converted('IMG_1.jpg') });
    await new Promise((done) => setTimeout(done, 20));
    expect(seen).toEqual([]);
    expect(ui.failure).not.toHaveBeenCalled();
  });
});

describe('speed', () => {
  it('prepares two files at once but hands them over in the order chosen', async () => {
    const first = deferred<PrepareOutcome>();
    const second = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const input = page('<input type="file" accept="image/jpeg" multiple>');
    choose(input, [heic('a.heic'), heic('b.heic'), heic('c.heic')]);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    // The second finishes first; nothing is handed over until the first is ready too.
    second.resolve({ kind: 'fixed', result: converted('b.jpg') });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(3));
    expect(seen).toEqual([]);
    first.resolve({ kind: 'fixed', result: converted('a.jpg') });
    await vi.waitFor(() => expect(changes()).toEqual([['a.jpg', 'b.jpg', 'c.jpg']]));
  });
  it('gets processing ready when an image picker opens, but not for other files', () => {
    const image = page('<input type="file" accept="image/jpeg">');
    image.click();
    expect(warm).toHaveBeenCalledTimes(1);
    const pdf = page('<input type="file" accept="application/pdf">');
    pdf.click();
    expect(warm).toHaveBeenCalledTimes(1);
    settings = { ...settings, enabled: false };
    image.click();
    expect(warm).toHaveBeenCalledTimes(1);
  });
});

describe('dropping files on an upload area', () => {
  function dropArea(markup: string) {
    document.body.innerHTML = markup;
    const area = document.querySelector('.area')!;
    const input = area.querySelector('input')!;
    track(input);
    const dropped: string[][] = [];
    area.addEventListener('drop', (event) => {
      event.preventDefault();
      dropped.push(Array.from((event as DragEvent).dataTransfer!.files).map((file) => file.name));
    });
    return { area, input, target: area.querySelector('p')!, dropped };
  }

  it('holds a drop, prepares the files, then replays it where they were dropped', async () => {
    const { target, dropped } = dropArea(
      '<div class="area"><p>Drop a JPG</p><input type="file" accept="image/jpeg" hidden></div>',
    );
    const event = dropFiles(target, [heic('a.heic'), jpeg('b.jpg')]);
    // The browser must not open the file, and the page must not see the original.
    expect(event.defaultPrevented).toBe(true);
    expect(dropped).toEqual([]);
    await vi.waitFor(() => expect(dropped).toEqual([['a.jpg', 'b.jpg']]));
    expect(ui.success).toHaveBeenCalled();
  });
  it('leaves compatible drops completely alone', () => {
    const { target, dropped } = dropArea(
      '<div class="area"><p>Drop a JPG</p><input type="file" accept="image/jpeg" hidden></div>',
    );
    // Delivered synchronously: the page's own handler ran before dropFiles returned.
    dropFiles(target, [jpeg('ok.jpg')]);
    expect(dropped).toEqual([['ok.jpg']]);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('replays the original files if preparation fails', async () => {
    prepare.mockRejectedValueOnce(new ProcessingError('damaged'));
    const { target, dropped } = dropArea(
      '<div class="area"><p>Drop</p><input type="file" accept="image/jpeg"></div>',
    );
    dropFiles(target, [heic('a.heic')]);
    await vi.waitFor(() => expect(dropped).toEqual([['a.heic']]));
    expect(ui.failure).toHaveBeenCalledWith('damaged', false);
  });
  it('does nothing when the area has no single upload field to read rules from', () => {
    document.body.innerHTML =
      '<div class="area"><p>Drop</p><input type="file" accept="image/jpeg"><input type="file" accept="image/png"></div>';
    const target = document.querySelector('p')!;
    expect(dropFiles(target, [heic()]).defaultPrevented).toBe(false);
    document.body.innerHTML = '<div class="area"><p>Drop anywhere</p></div>';
    expect(dropFiles(document.querySelector('p')!, [heic()]).defaultPrevented).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('finds the input Dropzone.js keeps at the end of the page, when it is the only one', async () => {
    document.body.innerHTML =
      '<form class="dropzone"><div class="dz-message"><span>Drop</span></div></form><input type="file" class="dz-hidden-input" accept="image/jpeg">';
    const target = document.querySelector('span')!;
    const dropped: string[][] = [];
    document
      .querySelector('form')!
      .addEventListener('drop', (event) =>
        dropped.push(Array.from((event as DragEvent).dataTransfer!.files).map((file) => file.name)),
      );
    expect(dropFiles(target, [heic('a.heic')]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(dropped).toEqual([['a.jpg']]));
    // With two Dropzone inputs on the page, there is no telling which applies.
    document.body.insertAdjacentHTML('beforeend', '<input type="file" class="dz-hidden-input">');
    expect(dropFiles(target, [heic('b.heic')]).defaultPrevented).toBe(false);
  });
  it('lets a newer drop replace one still being prepared', async () => {
    const slow = deferred<PrepareOutcome>();
    prepare.mockReturnValueOnce(slow.promise);
    const { target, dropped } = dropArea(
      '<div class="area"><p>Drop</p><input type="file" accept="image/jpeg"></div>',
    );
    dropFiles(target, [heic('first.heic')]);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    dropFiles(target, [heic('second.heic')]);
    await vi.waitFor(() => expect(dropped).toEqual([['second.jpg']]));
    slow.resolve({ kind: 'fixed', result: converted('first.jpg') });
    await new Promise((done) => setTimeout(done, 30));
    expect(dropped).toEqual([['second.jpg']]);
  });
  it('gets processing ready when files are dragged over the page', () => {
    const drag = new Event('dragenter', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: { types: ['Files'] } });
    document.body.dispatchEvent(drag);
    expect(warm).toHaveBeenCalledTimes(1);
  });
});

describe('widening the file picker', () => {
  it('offers convertible formats while the picker opens, then restores accept', async () => {
    const input = page('<input type="file" accept="image/jpeg,image/png">');
    let during = '';
    input.addEventListener('click', () => (during = input.getAttribute('accept')!));
    input.click();
    expect(during).toContain('.heic');
    await new Promise((done) => setTimeout(done, 0));
    expect(input.getAttribute('accept')).toBe('image/jpeg,image/png');
  });
  it('leaves the page’s own accept changes alone', async () => {
    const input = page('<input type="file" accept="image/jpeg">');
    input.addEventListener('click', () => input.setAttribute('accept', 'image/png'));
    input.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(input.getAttribute('accept')).toBe('image/png');
  });
  it('removes a file the site would never have accepted if it cannot be prepared', async () => {
    prepare.mockRejectedValueOnce(new ProcessingError('damaged'));
    const input = page('<input type="file" accept="image/jpeg">');
    const earlier = jpeg('earlier.jpg');
    selections.set(input, [earlier]);
    input.click();
    choose(input, [heic()]);
    await vi.waitFor(() => expect(ui.failure).toHaveBeenCalledWith('damaged', true));
    expect(seen).toEqual([]);
    expect(selections.get(input)).toEqual([earlier]);
  });
  it('does not widen multi-file inputs or when paused', () => {
    const input = page('<input type="file" accept="image/jpeg" multiple>');
    let during = '';
    input.addEventListener('click', () => (during = input.getAttribute('accept')!));
    input.click();
    expect(during).toBe('image/jpeg');
  });
});
