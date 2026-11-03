# COTHI CBT — Deploying to a School

## Why copying only the `.exe` failed
`COTHI-Server.exe` / `COTHI-Student-Exam.exe` are **Electron apps** — the `.exe`
is only a launcher. It cannot run alone; it needs all the files beside it (the
Chromium `.dll` / `.pak` / `.bin` files **and** the `resources\app` folder that
holds your code, data and pages). So copying just the `.exe` always fails.

You have **two ways** to deploy. Use whichever you prefer.

---

## Option A — One-click installer (recommended, copy ONE file)

**On your build PC (one-time setup):**
1. Install **Inno Setup 6** (free): https://jrsoftware.org/isdl.php
2. In the `CBT` folder, right-click `build_installers.ps1` → **Run with PowerShell**.
   (If Windows blocks it: open PowerShell in the folder and run
   `powershell -ExecutionPolicy Bypass -File build_installers.ps1`.)

This produces two single files in `installer\dist\`:
- `COTHI-Server-Setup.exe`  → the teacher / admin PC
- `COTHI-Student-Setup.exe` → each student PC

**At each school:** copy the one `Setup.exe` you need, double-click it, done.
It installs everything, adds a desktop + Start-menu shortcut with the COTHI icon,
and can be removed later from "Add or remove programs". It installs **per-user**
(no admin password needed) into a writable location, so exams, submissions and
synced questions all save correctly.

---

## Option B — Copy the folder (no installer tool needed)

1. On your build PC, run `package_apps.ps1` (right-click → Run with PowerShell).
2. Copy the **entire folder** to the school PC:
   - `COTHI-Server-App\`  → teacher / admin PC
   - `COTHI-Student-App\` → each student PC
   (Copy the whole folder, not just the `.exe`.)
3. On the school PC, open the copied folder and double-click
   **`Create-Desktop-Shortcut.bat`** once — it puts a branded shortcut on the desktop.

Keep the app folder somewhere the user can write to (e.g. the Desktop or
`C:\COTHI`), **not** inside `C:\Program Files` — the server writes submissions and
settings into its own `data` folder and needs write access there.

---

## The `.exe` file icon in File Explorer
The window, taskbar and shortcut icons are already branded. To also brand the
raw `.exe` icon shown in File Explorer, drop `rcedit.exe`
(from https://github.com/electron/rcedit/releases, rename to `rcedit.exe`) into
the `CBT` folder before building — `package_apps.ps1` will apply the icon
automatically. Without it, everything else is still branded.

---

## Updating a school later (questions/branding)
When the school PC has internet, the admin console's **Refresh Cloud List** /
**Sync School** pulls the latest schools, candidates and questions from
`cbtbycothi.com.ng`. (Scheduled auto-refresh and results-PDF push are planned
enhancements.)
