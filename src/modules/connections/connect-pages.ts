/**
 * The small HTML pages the browser shows during "Connect Trello" / "Add to Slack".
 * Kept out of the controller so the routes stay easy to read.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A minimal page with a title and some (already escaped) HTML. */
export function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;line-height:1.5;color:#1c1c1a}</style>
</head><body><h1 style="font-size:20px">Taskvane</h1>${bodyHtml}</body></html>`;
}

/** Success or failure message page. */
export function resultPage(ok: boolean, message: string): string {
  return page(ok ? 'Connected' : 'Taskvane', `<p>${ok ? '✅' : '❌'} ${message}</p>`);
}

/**
 * Trello sends the user back with the token in the URL fragment (#token=…), which only the browser can read.
 * This page reads it, posts it to /connect/trello/complete, shows the result, and removes the token from the address bar.
 */
export function trelloCallbackPage(state: string): string {
  const safeState = String(state ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return page(
    'Connecting Trello…',
    `<p id="msg">Connecting your Trello account…</p>
<script>
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const msg = document.getElementById('msg');
  if (!token) { msg.textContent = 'Trello did not return a token. Close this tab and try again.'; return; }
  const res = await fetch('/connect/trello/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: '${safeState}', token })
  });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.ok ? '✅ Trello connected as ' + body.account + '. You can close this tab.' : '❌ ' + (body.message || 'Could not connect Trello');
  history.replaceState(null, '', location.pathname);
})();
</script>`,
  );
}
