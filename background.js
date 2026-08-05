/**
 * Claude Tab Group Popout
 *
 * Watches for tab groups whose title matches MATCH_PATTERN and moves the whole
 * group into its own window. Works for groups created by hand, by another
 * extension, or restored from a previous session.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MATCH_PATTERN = /claude/i;   // case-insensitive substring match
const FOCUS_NEW_WINDOW = false;     // set false if you don't want focus stolen
const WINDOW_OFFSET = 40;          // px offset from the source window
const SETTLE_MS = 3000;             // wait for other extensions to finish building
const LISTEN_FOR_MOVES = true;     // set false if another extension fights you

// ---------------------------------------------------------------------------
// Re-entrancy guard
//
// Moving a group fires onMoved (and sometimes onUpdated) again. The
// "already alone in its window" check below catches most of it, but this set
// prevents overlapping move attempts for the same group.
// ---------------------------------------------------------------------------

const inFlight = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chrome rejects tab/group mutations while a drag is in progress with
 * "Tabs cannot be edited right now (user may be dragging a tab)".
 * Since dragging a group out is one of the ways a user creates one, this is
 * a common failure. Retry briefly instead of giving up.
 */
async function withDragRetry(fn, attempts = 20, delayMs = 200) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const message = String(err && err.message);
      const isDragError =
        message.includes("dragging") || message.includes("cannot be edited");
      if (!isDragError || i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
}

/**
 * True if every tab in the group's window belongs to that group — i.e. the
 * group is already isolated and there is nothing to do.
 */
async function isAlreadyIsolated(group) {
  const [groupTabs, windowTabs] = await Promise.all([
    chrome.tabs.query({ groupId: group.id }),
    chrome.tabs.query({ windowId: group.windowId }),
  ]);
  if (groupTabs.length === 0) return true; // empty / vanishing group
  return groupTabs.length === windowTabs.length;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function popOutGroup(group) {
  if (await isAlreadyIsolated(group)) return;

  // There is no API to create a window that already contains a group, so:
  //   1. create an empty window (it comes with one placeholder tab)
  //   2. move the group into it
  //   3. close the placeholder
  // The placeholder must be closed last, otherwise the window closes with it.

  let source = null;
  try {
    source = await chrome.windows.get(group.windowId);
  } catch {
    /* source window may have gone away; fall back to default placement */
  }

  const createOptions = { focused: FOCUS_NEW_WINDOW, type: "normal" };
  if (source && source.state === "normal") {
    createOptions.left = (source.left ?? 0) + WINDOW_OFFSET;
    createOptions.top = (source.top ?? 0) + WINDOW_OFFSET;
    createOptions.width = source.width;
    createOptions.height = source.height;
  }

  const newWindow = await chrome.windows.create(createOptions);
  const placeholder = newWindow.tabs && newWindow.tabs[0];

  try {
    await withDragRetry(() =>
      chrome.tabGroups.move(group.id, { windowId: newWindow.id, index: -1 })
    );
  } catch (err) {
    // Move failed — don't leave a stray blank window lying around.
    await chrome.windows.remove(newWindow.id).catch(() => {});
    throw err;
  }

  if (placeholder) {
    await chrome.tabs.remove(placeholder.id).catch(() => {});
  }
}

async function handleGroup(group) {
  if (!group || !group.title || !MATCH_PATTERN.test(group.title)) return;
  if (inFlight.has(group.id)) return;

  inFlight.add(group.id);
  try {
    // Let whoever created this group finish adding tabs to it before we move.
    await sleep(SETTLE_MS);

    // The event handed us a snapshot. Re-read: in the meantime the group may
    // have changed windows, lost its title, or been dissolved entirely
    // (in which case chrome.tabGroups.get throws and we bail).
    const current = await chrome.tabGroups.get(group.id);
    if (!current.title || !MATCH_PATTERN.test(current.title)) return;

    await popOutGroup(current);
  } catch (err) {
    console.warn("[Claude Tab Group Popout] Could not pop out group:", err);
  } finally {
    inFlight.delete(group.id);
  }
}

/** Sweep every existing group — used on install and on browser startup. */
async function sweepExistingGroups() {
  const groups = await chrome.tabGroups.query({});
  for (const group of groups) {
    await handleGroup(group);
  }
}

// ---------------------------------------------------------------------------
// Listeners (must be registered at the top level so the service worker wakes)
// ---------------------------------------------------------------------------

// Fires when a group is created. The title is usually empty at this point,
// but a restored or programmatically created group may already have one.
chrome.tabGroups.onCreated.addListener(handleGroup);

// The one that matters: fires when a group is named or renamed, whether by
// you or by another extension calling chrome.tabGroups.update().
chrome.tabGroups.onUpdated.addListener(handleGroup);

// Catches a matching group being moved back into a shared window.
if (LISTEN_FOR_MOVES) {
  chrome.tabGroups.onMoved.addListener(handleGroup);
}

chrome.runtime.onInstalled.addListener(sweepExistingGroups);
chrome.runtime.onStartup.addListener(sweepExistingGroups);
