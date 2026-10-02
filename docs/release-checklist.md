# Release checklist

Everything to do before a version goes to the Chrome Web Store and Edge Add-ons, in
order. Tick each box in the release's pull request or issue.

## 1. Decisions that must be made once, before the first release

- [x] **Contact email.** mokshbuilds@gmail.com, in [privacy-policy.md](privacy-policy.md)
      (section 1) and Settings → Problems. Also use it for the store's developer and
      support fields. Problem reports are sent there.
- [x] **Privacy policy URL.** https://github.com/shmoksh/just-upload/blob/main/docs/privacy-policy.md
      (the repository is public). Paste it into both stores.
- [x] **License.** Proprietary, all rights reserved ([LICENSE](../LICENSE), and
      `"license": "UNLICENSED"` in package.json). Third-party components keep their own
      licenses.
- [ ] **HEIC decoder (LGPL-3.0).** Get a legal review of the packaging described in
      [heic-licensing.md](heic-licensing.md).

## 2. Version and notes

- [ ] Update `version` in package.json (it becomes the extension's version).
- [ ] Add the version's changes to [CHANGELOG.md](../CHANGELOG.md), in plain words.
- [ ] If anything stored or sent changed, update [PRIVACY.md](../PRIVACY.md),
      [privacy-policy.md](privacy-policy.md) (with a new date) and
      [PERMISSIONS.md](PERMISSIONS.md).

## 3. Automated checks

- [ ] `pnpm test:all`: lint, typecheck, unit tests and the end-to-end tests against the
      built extension.
- [ ] `JUST_UPLOAD_STRESS=1 pnpm exec playwright test tests/e2e/large.spec.ts`: writes a
      4.6 GB BigTIFF and checks it becomes a JPG under 2 MB (about 30 seconds of
      processing; needs 5 GB of free disk).
- [ ] `pnpm real-sites`: chooses images on real public websites (MDN, TinyPNG, FilePond,
      imgbb, jQuery File Upload, Uppy, Dropzone) with every upload blocked, and checks
      what each site received. A failure means a site changed or Just Upload regressed:
      look at it before releasing. A site that doesn't load is reported, not failed.

## 4. By hand, signed in, with real photos

Use your own accounts and a real iPhone photo (HEIC), a large camera JPG (over 10 MB)
and a PNG screenshot. On each site, choose the image with the site's button, then try
dragging it in. **Stop before posting or sending**: the point is what the site accepts,
not publishing anything.

| Site                                  | Try                                   | Expect                                                     |
| ------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Gmail (attach, and inline image)      | HEIC, large JPG                       | Attaches normally; HEIC untouched unless a rule asks       |
| LinkedIn (profile photo, post)        | HEIC, large JPG, PNG                  | Profile photo accepted; crop question only if square asked |
| WhatsApp Web (photo)                  | HEIC, large JPG                       | Accepted; no errors in the chat                            |
| X / Twitter (post image)              | HEIC, 10 MB+ JPG                      | Accepted under X's size limit                              |
| A job portal (Workday, Greenhouse…)   | HEIC as a photo or document           | Converted if the field says JPG/PNG; otherwise untouched   |
| A government portal (passport, visa…) | Photo on a "JPG, max 240 KB, 600×600" | Asks to crop, made smaller, accepted by the portal's check |
| Google Drive / Dropbox upload         | Anything                              | Untouched: these take any file                             |
| A site with an `image/*` field        | HEIC                                  | Untouched (known limitation)                               |

For each row, note anything odd: a site that refused the prepared image, a question
that made no sense, a slow preparation, or a page that stopped working. Settings →
Problems shows any failures with a report to copy.

## 5. Store packages

- [ ] `pnpm zip` and `pnpm zip:edge`, or push a `v<version>` tag so the release workflow
      builds them and attaches the decoder sources.
- [ ] Load `.output/chrome-mv3` once more with **Load unpacked** in a fresh profile and
      choose a WebP or HEIC on the local test page (`pnpm test:site`): it should say
      "Ready to upload".
- [ ] If the interface changed, refresh the screenshots (`pnpm screenshots`).

## 6. Store listing

- [ ] Description and short description from [store-listing.md](store-listing.md).
- [ ] Permission justifications from
      [store-permissions-justification.md](store-permissions-justification.md).
- [ ] Privacy practices: no data collected; remote code: no.
- [ ] Screenshots from `docs/store/screenshots/` and the small promo tile
      `docs/store/promo-440x280.png` (the store requires it).
- [ ] Submit, then check the published version installs and works from the store.
