<!-- ══════════════════════════════════════════════════════════════════════
  PART 1 of 2 — HTML card
  PASTE LOCATION: admin.html, inside the Calls & Texts panel, directly
  AFTER the closing </div> of the "🔗 Twilio Webhook URLs" card (the line
  right after <p id="ntf-twilio-status" ...></p> and its closing </div>)
  and BEFORE the "🔒 Secrets" card.
═══════════════════════════════════════════════════════════════════════ -->

<div style="margin-bottom:1rem;padding:0.85rem 1rem;background:var(--smoke);border-radius:2px;border:1px solid var(--border);">
  <div style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:0.4rem;">🎛️ Twilio Control</div>
  <p style="color:var(--muted);font-size:0.72rem;margin:0 0 0.7rem;line-height:1.5;">
    Full messaging &amp; voice control without opening the Twilio Console. Locked behind your admin
    passcode (the <strong style="color:var(--rice);">ADMIN_API_TOKEN</strong> you set in Vercel) —
    it's saved in this browser only, never published to the site.
  </p>

  <div class="field-group">
    <label class="field-label">Admin passcode</label>
    <div style="display:flex;gap:8px;">
      <input class="field-input" type="password" id="tw-admin-token" placeholder="Paste your ADMIN_API_TOKEN" style="flex:1;" />
      <button type="button" class="btn btn-sm" onclick="twSaveToken()" style="border:1px solid var(--border);background:transparent;color:var(--rice);">💾 Save</button>
    </div>
  </div>

  <div style="margin-top:0.6rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <button type="button" class="btn btn-sm" onclick="twRecentMessages()" style="border:1px solid var(--border);background:transparent;color:var(--rice);">💬 Recent Texts + Delivery Status</button>
    <button type="button" class="btn btn-sm" onclick="twRecentCalls()" style="border:1px solid var(--border);background:transparent;color:var(--rice);">📞 Recent Calls</button>
  </div>

  <div class="field-group" style="margin-top:0.9rem;">
    <label class="field-label">Send a text from the business number</label>
    <input class="field-input" id="tw-sms-to" placeholder="To — e.g. 6025551234" style="margin-bottom:0.5rem;" />
    <textarea class="field-input" id="tw-sms-body" rows="2" placeholder="Message… (plain text, no emoji = 1 segment)"></textarea>
    <div style="margin-top:0.5rem;">
      <button type="button" class="btn btn-sm" id="tw-sms-send-btn" onclick="twSendSms()" style="border:1px solid var(--border);background:transparent;color:var(--rice);">📤 Send SMS</button>
    </div>
  </div>

  <p id="tw-admin-status" style="font-size:0.74rem;color:var(--muted);margin:0.6rem 0 0;"></p>
  <div id="tw-admin-output" style="margin-top:0.6rem;font-family:monospace;font-size:0.72rem;line-height:1.7;color:var(--rice);max-height:260px;overflow-y:auto;"></div>
</div>


<!-- ══════════════════════════════════════════════════════════════════════
  PART 2 of 2 — JavaScript
  PASTE LOCATION: admin.html, inside the existing <script> block, directly
  ABOVE the line:  async function loadTwilioConfig() {
═══════════════════════════════════════════════════════════════════════ -->

<script>
/* ─── Twilio Control panel ──────────────────────────────────────────── */

function twToken() { return localStorage.getItem('lw_admin_token') || ''; }

function twSaveToken() {
  const v = document.getElementById('tw-admin-token').value.trim();
  const s = document.getElementById('tw-admin-status');
  if (!v) { s.style.color = 'var(--wok)'; s.textContent = 'Paste the passcode first.'; return; }
  localStorage.setItem('lw_admin_token', v);
  s.style.color = 'var(--gold)';
  s.textContent = '✅ Passcode saved in this browser.';
}

// One helper for every action. Returns parsed JSON or throws.
async function twAdmin(action, params = {}) {
  const r = await fetch('/api/twilio-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': twToken() },
    body: JSON.stringify({ action, ...params }),
  });
  if (r.status === 401) throw new Error('Wrong or missing passcode — paste your ADMIN_API_TOKEN above and hit Save.');
  return r.json();
}

function twOut(html) { document.getElementById('tw-admin-output').innerHTML = html; }
function twStatus(msg, bad) {
  const s = document.getElementById('tw-admin-status');
  s.style.color = bad ? 'var(--wok)' : 'var(--muted)';
  s.textContent = msg;
}

async function twRecentMessages() {
  twStatus('Loading recent texts…');
  twOut('');
  try {
    const d = await twAdmin('messages_recent');
    if (!d.ok) return twStatus(d.reason || 'Failed.', true);
    if (!d.messages.length) return twStatus('No messages yet.');
    twStatus(`Last ${d.messages.length} texts — status is the carrier's final word.`);
    twOut(d.messages.map(m => {
      const when = new Date(m.date).toLocaleString();
      const good = m.status === 'delivered';
      const icon = good ? '✅' : (m.status === 'undelivered' || m.status === 'failed') ? '❌' : '⏳';
      const err  = m.errorCode ? ` <span style="color:var(--wok);">err ${m.errorCode}</span>` : '';
      return `${icon} ${when} · ${m.direction} · ${m.from} → ${m.to} · <strong>${m.status}</strong>${err} · ${m.segments} seg<br><span style="color:var(--muted);">${m.body}</span>`;
    }).join('<hr style="border:none;border-top:1px solid var(--border);margin:6px 0;">'));
  } catch (e) { twStatus(e.message, true); }
}

async function twRecentCalls() {
  twStatus('Loading recent calls…');
  twOut('');
  try {
    const d = await twAdmin('calls_recent');
    if (!d.ok) return twStatus(d.reason || 'Failed.', true);
    if (!d.calls.length) return twStatus('No calls yet.');
    twStatus(`Last ${d.calls.length} calls.`);
    twOut(d.calls.map(c => {
      const when = new Date(c.date).toLocaleString();
      return `📞 ${when} · ${c.direction} · ${c.from} → ${c.to} · <strong>${c.status}</strong> · ${c.duration || 0}s`;
    }).join('<hr style="border:none;border-top:1px solid var(--border);margin:6px 0;">'));
  } catch (e) { twStatus(e.message, true); }
}

async function twSendSms() {
  const btn  = document.getElementById('tw-sms-send-btn');
  const to   = document.getElementById('tw-sms-to').value.trim();
  const body = document.getElementById('tw-sms-body').value.trim();
  if (!to || !body) return twStatus('Fill in both the number and the message.', true);
  btn.disabled = true;
  twStatus('Sending…');
  try {
    const d = await twAdmin('sms_send', { to, body });
    if (d.ok) { twStatus(`✅ Queued (${d.status}) — click "Recent Texts" in ~5s to confirm delivery.`); document.getElementById('tw-sms-body').value = ''; }
    else twStatus(d.reason || 'Send failed.', true);
  } catch (e) { twStatus(e.message, true); }
  finally { btn.disabled = false; }
}
</script>
