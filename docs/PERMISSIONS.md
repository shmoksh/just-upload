# Permissions, in plain English

When you install Just Upload, Chrome shows one warning: **"Read and change your data on
all websites."** Here is what that means.

- **Why it's needed:** upload fields can be on any website, so Just Upload has to be
  ready before you choose a file. Asking site by site would mean a prompt every time you
  upload somewhere new.
- **What it looks at:** only the upload field you use and the short text beside it (like
  "JPG or PNG, max 2 MB"), and only after you choose or drop a file there. Never form
  values, passwords, cookies or the rest of the page.
- **What it changes:** one thing, the file in that upload field, when the website can't
  take yours as it is.
- **What it never does:** send anything anywhere. It has no servers and works offline.

It also keeps, on your device only, your settings, a count of fixed files and up to 20
short problem notes (no files, file names or websites). When you open its toolbar
button, it checks which site you're on so it can offer "pause on this site".

**You stay in control:** in `chrome://extensions` → Just Upload → _Site access_, choose
_On specific sites_ or _On click_.

Not requested: your tabs, history, downloads, clipboard, or any optional permissions.
