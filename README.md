# Claude Tab Group Popout

A tiny Chrome extension that automatically moves any tab group whose title contains **"Claude"** (case-insensitive) into its own window.

This is handy if you use tools that create a "Claude" tab group in your browser — such as the [Claude in Chrome](https://claude.ai/chrome) extension — and you'd rather have those tabs living in a dedicated window instead of crowding your main one.

## What it does

- Watches for tab groups being **created**, **renamed**, or **moved**.
- When a group's title matches `claude` (anywhere in the title, any casing), it waits a few seconds for whatever created the group to finish adding tabs, then moves the entire group into a new window.
- The new window is offset slightly from the source window and matches its size. By default it opens **without stealing focus**, so your current work isn't interrupted.
- On install and on browser startup, it sweeps all existing tab groups and pops out any that match.
- If the group is already alone in its own window, it does nothing.

It handles the fiddly edge cases for you: retries while a tab drag is in progress (Chrome blocks tab edits mid-drag), guards against re-entrant move events, and cleans up the temporary window if a move fails.

## Installation

The extension isn't in the Chrome Web Store, so you load it unpacked:

1. **Download the code**

   ```bash
   git clone https://github.com/intrepidws/claude-tab-group-popout-chrome-extension.git
   ```

   Or download the repo as a ZIP and extract it somewhere permanent (Chrome loads the extension from this folder, so don't delete it later).

2. **Open Chrome's extensions page**

   Navigate to `chrome://extensions` (or **Menu → Extensions → Manage Extensions**).

3. **Enable Developer mode**

   Toggle the **Developer mode** switch in the top-right corner.

4. **Load the extension**

   Click **Load unpacked** and select the folder containing `manifest.json`.

That's it — no options page, no toolbar icon. As soon as it's loaded, any existing tab group named "Claude" will pop out into its own window, and future ones will follow automatically.

Requires Chrome 89 or later. The only permission it uses is `tabGroups`.

## Configuration

There's no settings UI; behavior is controlled by constants at the top of [`background.js`](background.js):

| Constant | Default | Purpose |
| --- | --- | --- |
| `MATCH_PATTERN` | `/claude/i` | Regex a group title must match to be popped out. Change this to target different group names. |
| `FOCUS_NEW_WINDOW` | `false` | Whether the new window grabs focus when it opens. |
| `WINDOW_OFFSET` | `40` | Pixel offset of the new window from the source window. |
| `SETTLE_MS` | `3000` | How long to wait after a group appears before moving it, so its creator can finish adding tabs. |
| `LISTEN_FOR_MOVES` | `true` | Also pop the group back out if it gets moved into a shared window. Set to `false` if another extension keeps fighting over group placement. |

After editing, go back to `chrome://extensions` and click the reload (↻) button on the extension's card to apply your changes.

## How it works

Chrome has no API to create a window that already contains a tab group, so the extension:

1. Creates a new empty window (which comes with a placeholder tab).
2. Moves the tab group into it with `chrome.tabGroups.move()`.
3. Closes the placeholder tab, leaving just the group.

Everything runs in a Manifest V3 background service worker — no content scripts, and no access to page content.

## Troubleshooting

- **A group didn't pop out.** The move is deliberately delayed by a few seconds (`SETTLE_MS`), so give it a moment. Also check that the group actually has a title containing "claude" — untitled groups are ignored.
- **The group keeps bouncing between windows.** Another extension may be managing the same group. Try setting `LISTEN_FOR_MOVES` to `false`.
- **Errors or warnings.** On `chrome://extensions`, click **service worker** on the extension's card to open its console. Failures are logged with the `[Claude Tab Group Popout]` prefix.
