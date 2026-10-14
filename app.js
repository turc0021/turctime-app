// Turc Time Training — v1 web app (static; Supabase backend)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = Object.assign({ COACH_NAME: "Coach Turc", SESSION_PRICE: 50, DEFAULT_SLOT_MINUTES: 60, TIMEZONE_LABEL: "" }, window.TURC_CONFIG || {});
const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");
const $modal = document.getElementById("modal");
const $modalCard = document.getElementById("modalCard");

// ---------- utils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content; };
function toast(msg, ms = 2600) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms); }
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtWhen = (d) => `${fmtDay(d)} · ${fmtTime(d)}`;
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; } // Monday
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function openModal(html) { $modalCard.innerHTML = html; $modal.classList.remove("hidden"); }
function closeModal() { $modal.classList.add("hidden"); $modalCard.innerHTML = ""; }
$modal.addEventListener("click", (e) => { if (e.target === $modal) closeModal(); });
function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }

// ---------- boot ----------
const configured = CFG.SUPABASE_URL && !/YOUR-PROJECT/.test(CFG.SUPABASE_URL) && CFG.SUPABASE_ANON_KEY && !/YOUR-ANON/.test(CFG.SUPABASE_ANON_KEY);
let sb = null;
const S = { session: null, me: null, tab: null, channel: null };

if (!configured) {
  $app.innerHTML = `<div class="card"><h2>Setup needed</h2><p class="muted">Add your Supabase URL and anon key to <code>config.js</code>.</p></div>`;
} else {
  sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } });
  sb.auth.onAuthStateChange((_evt, session) => { const changed = (session?.user?.id) !== (S.session?.user?.id); S.session = session; if (changed) start(); });
  sb.auth.getSession().then(({ data }) => { S.session = data.session; start(); });
}
document.getElementById("btnSignOut").onclick = async () => { await sb.auth.signOut(); location.hash = ""; };

async function start() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  const signOut = document.getElementById("btnSignOut");
  if (!S.session) { signOut.classList.add("hidden"); $tabs.classList.add("hidden"); return renderLogin(); }
  signOut.classList.remove("hidden");
  const { data, error } = await sb.rpc("whoami");
  if (error) { $app.innerHTML = `<div class="card">Couldn't load your account: ${esc(errMsg(error))}</div>`; return; }
  S.me = data;
  if (S.me.is_admin) return startAdmin();
  if (!S.me.family_ids.length) {
    $tabs.classList.add("hidden");
    $app.innerHTML = `<div class="card"><h2>Almost there</h2><p><b>${esc(S.me.email)}</b> isn't on ${esc(CFG.COACH_NAME)}'s roster yet.</p><p class="muted">Text ${esc(CFG.COACH_NAME)} and ask him to add this email to your family, then tap the link again.</p></div>`;
    return;
  }
  startFamily();
}

function renderLogin() {
  const sent = sessionStorage.getItem("tt_sent");
  $app.innerHTML = `
  <div class="card" style="margin-top:24px">
    <h2>Sign in</h2>
    <p class="muted">Enter the email ${esc(CFG.COACH_NAME)} has on file. We'll email you a one-tap sign-in link — no password.</p>
    <form id="loginForm"><label for="em">Email</label><input id="em" type="email" required autocomplete="email" placeholder="you@example.com">
    <button class="btn red block" style="margin-top:12px" type="submit">Email me a sign-in link</button></form>
    ${sent ? `<p class="small muted" style="margin-top:12px">Link sent to ${esc(sent)}. Check your inbox (and spam).</p>` : ""}
  </div>`;
  document.getElementById("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("em").value.trim();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    btn.disabled = false;
    if (error) return toast(errMsg(error));
    sessionStorage.setItem("tt_sent", email); toast("Check your email for the link"); renderLogin();
  };
}

function setTabs(list, onPick) {
  $tabs.classList.remove("hidden");
  $tabs.innerHTML = list.map(([id, label]) => `<button type="button" data-t="${id}" class="${S.tab === id ? "active" : ""}">${label}<span class="badge hidden" id="badge-${id}"></span></button>`).join("");
  $tabs.querySelectorAll("button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.t; location.hash = S.tab; setTabs(list, onPick); onPick(S.tab); }));
}
function setBadge(id, n) { const b = document.getElementById("badge-" + id); if (!b) return; b.textContent = n; b.classList.toggle("hidden", !n); }

// =====================================================================
// FAMILY
// =====================================================================
const F = { families: [], players: [] };
async function startFamily() {
  const [fam, pl] = await Promise.all([sb.from("families").select("id,parent1,parent2,phone,email,email2,tags"), sb.from("players").select("id,family_id,name,age,position,school").order("name")]);
  F.families = fam.data || []; F.players = pl.data || [];
  const tabs = [["book", "Book"], ["mine", "My sessions"], ["msgs", "Messages"], ["players", "Players"]];
  S.tab = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : "book";
  const go = (t) => ({ book: famBook, mine: famMine, msgs: famMsgs, players: famPlayers }[t])();
  setTabs(tabs, go); go(S.tab);
  S.channel = sb.channel("fam")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => { if (S.tab === "msgs") famMsgs(); else if (p.new.sender === "coach") { F.unread = (F.unread || 0) + 1; setBadge("msgs", F.unread); toast(`New message from ${CFG.COACH_NAME}`); } })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "slots" }, () => { if (S.tab === "book") famBook(true); })
    .subscribe();
}

async function famBook(quiet) {
  if (!quiet) $app.innerHTML = `<div class="center muted">Loading open times…</div>`;
  const now = new Date();
  const { data: slots, error } = await sb.from("slots").select("*").gte("starts_at", now.toISOString()).lte("starts_at", addDays(now, 28).toISOString()).order("starts_at");
  if (error) return ($app.innerHTML = `<div class="card">${esc(errMsg(error))}</div>`);
  const open = slots.filter((s) => s.booked_count < s.capacity);
  const byDay = {}; open.forEach((s) => (byDay[dayKey(s.starts_at)] ||= []).push(s));
  const days = Object.keys(byDay).sort();
  $app.innerHTML = `<h2>Book a session</h2><p class="muted small">$${CFG.SESSION_PRICE} per session${CFG.TIMEZONE_LABEL ? ` · times in ${esc(CFG.TIMEZONE_LABEL)}` : ""}.</p>` +
    (days.length ? days.map((k) => `<div class="card"><h3 style="margin-top:0">${fmtDay(byDay[k][0].starts_at)}</h3>${byDay[k].map((s) => `<div class="slot"><span>${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)}${s.location ? ` <span class="muted small">· ${esc(s.location)}</span>` : ""}</span><button class="btn red sm" data-slot="${s.id}">Book</button></div>`).join("")}</div>`).join("")
      : `<div class="card center muted">No open times right now. ${esc(CFG.COACH_NAME)} posts the week's times on Sunday night.</div>`);
  $app.querySelectorAll("[data-slot]").forEach((b) => (b.onclick = () => famConfirmBook(slots.find((s) => s.id === b.dataset.slot))));
}

function famConfirmBook(slot) {
  if (!F.players.length) return toast("No players on your family yet — message Coach.");
  openModal(`<h2>Confirm session</h2><p><b>${fmtWhen(slot.starts_at)}</b> – ${fmtTime(slot.ends_at)}</p>
    <label for="pp">Player</label><select id="pp">${F.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
    <p class="muted small">$${CFG.SESSION_PRICE}, paid to ${esc(CFG.COACH_NAME)} at the session.</p>
    <div class="row" style="margin-top:12px"><button class="btn red" id="ok">Book it</button><button class="btn outline" id="cx">Back</button></div>`);
  document.getElementById("cx").onclick = closeModal;
  document.getElementById("ok").onclick = async (e) => {
    e.target.disabled = true;
    const { error } = await sb.rpc("book_slot", { p_slot: slot.id, p_player: document.getElementById("pp").value });
    closeModal();
    if (error) { toast(errMsg(error)); return famBook(true); }
    toast("Booked! See you there."); famBook(true);
  };
}

async function famMine() {
  $app.innerHTML = `<div class="center muted">Loading…</div>`;
  const { data, error } = await sb.from("bookings").select("id,status,player_id,slot:slots(starts_at,ends_at,location)").eq("status", "booked");
  if (error) return ($app.innerHTML = `<div class="card">${esc(errMsg(error))}</div>`);
  const now = Date.now();
  const rows = (data || []).filter((b) => b.slot).sort((a, b) => new Date(a.slot.starts_at) - new Date(b.slot.starts_at));
  const up = rows.filter((b) => new Date(b.slot.starts_at) > now), past = rows.filter((b) => new Date(b.slot.starts_at) <= now).reverse().slice(0, 10);
  const pname = (id) => F.players.find((p) => p.id === id)?.name || "";
  const item = (b, cancel) => `<div class="slot"><span><b>${fmtWhen(b.slot.starts_at)}</b><br><span class="muted small">${esc(pname(b.player_id))}${b.slot.location ? " · " + esc(b.slot.location) : ""}</span></span>${cancel ? `<button class="btn outline sm" data-cancel="${b.id}">Cancel</button>` : ""}</div>`;
  $app.innerHTML = `<h2>My sessions</h2><div class="card"><h3 style="margin-top:0">Upcoming</h3>${up.length ? up.map((b) => item(b, true)).join("") : `<p class="muted">Nothing booked yet.</p>`}</div>` +
    (past.length ? `<div class="card"><h3 style="margin-top:0">Recent</h3>${past.map((b) => item(b, false)).join("")}</div>` : "");
  $app.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Cancel this session?")) return;
    const { error } = await sb.rpc("cancel_booking", { p_booking: b.dataset.cancel });
    toast(error ? errMsg(error) : "Cancelled"); famMine();
  }));
}

async function famMsgs() {
  F.unread = 0; setBadge("msgs", 0);
  const famId = S.me.family_ids[0];
  const { data, error } = await sb.from("messages").select("*").in("family_id", S.me.family_ids).order("created_at").limit(300);
  if (error) return ($app.innerHTML = `<div class="card">${esc(errMsg(error))}</div>`);
  renderThread(data, "family", async (body) => sb.from("messages").insert({ family_id: famId, sender: "family", sender_email: S.me.email, body }), `Messages with ${CFG.COACH_NAME}`);
}

function famPlayers() {
  const f = F.families[0] || {};
  $app.innerHTML = `<h2>Your family</h2><div class="card"><b>${esc(f.parent1)}</b>${f.parent2 ? " &amp; " + esc(f.parent2) : ""}<div class="muted small">${esc(f.phone || "")} ${esc(f.email || "")}</div></div>` +
    F.players.map((p) => `<div class="card"><b>${esc(p.name)}</b><div class="muted small">${[p.age && "Age " + p.age, p.position, p.school].filter(Boolean).map(esc).join(" · ")}</div></div>`).join("") +
    `<p class="muted small">Need a change? Send ${esc(CFG.COACH_NAME)} a message.</p>`;
}

// shared thread renderer
function renderThread(msgs, mySide, send, title, header = "") {
  const draft = document.getElementById("body")?.value || "";
  $app.innerHTML = `${header}<h2>${esc(title)}</h2><div class="card"><div class="thread" id="thread">${msgs.length ? msgs.map((m) => `<div class="msg ${m.sender === mySide ? "me" : "them"}">${esc(m.body)}<time>${fmtWhen(m.created_at)}${m.broadcast_id ? " · group message" : ""}</time></div>`).join("") : `<p class="muted center">No messages yet. Say hi!</p>`}</div>
  <form class="composer" id="composer"><textarea id="body" placeholder="Type a message…" required maxlength="4000"></textarea><button class="btn red" type="submit">Send</button></form></div>`;
  document.getElementById("body").value = draft;
  const th = document.getElementById("thread"); th.scrollTop = th.scrollHeight;
  document.getElementById("composer").onsubmit = async (e) => {
    e.preventDefault(); const ta = document.getElementById("body"); const body = ta.value.trim(); if (!body) return;
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { error } = await send(body); btn.disabled = false;
    if (error) return toast(errMsg(error));
    ta.value = "";
  };
}

// =====================================================================
// ADMIN
// =====================================================================
const A = { families: [], players: [], week: startOfWeek(new Date()), openFamily: null };
async function loadRoster() {
  const [f, p] = await Promise.all([sb.from("families").select("*").order("parent1"), sb.from("players").select("*").order("name")]);
  if (f.error) throw f.error; if (p.error) throw p.error;
  A.families = f.data; A.players = p.data;
}
const famName = (id) => { const f = A.families.find((x) => x.id === id); return f ? f.parent1 : "?"; };
const famPlayers_ = (id) => A.players.filter((p) => p.family_id === id);

async function startAdmin() {
  try { await loadRoster(); } catch (e) { $app.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  const tabs = [["roster", "Roster"], ["avail", "Availability"], ["bookings", "Bookings"], ["inbox", "Inbox"], ["broadcast", "Broadcast"]];
  S.tab = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : "bookings";
  const go = (t) => { A.openFamily = null; ({ roster: admRoster, avail: admAvail, bookings: admBookings, inbox: admInbox, broadcast: admBroadcast }[t])(); };
  setTabs(tabs, go); go(S.tab); refreshUnread();
  S.channel = sb.channel("adm")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      if (p.new.sender === "family") toast(`New message from ${famName(p.new.family_id)}`);
      if (S.tab === "inbox") { A.openFamily ? admThread(A.openFamily, true) : admInbox(); } refreshUnread();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () => { if (S.tab === "avail") admAvail(true); if (S.tab === "bookings") admBookings(true); })
    .subscribe();
}
async function refreshUnread() {
  const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("sender", "family").is("read_at", null);
  setBadge("inbox", count || 0);
}

// ---- Roster ----
function admRoster() {
  const q = (A.rq || "").toLowerCase();
  const list = A.families.filter((f) => !q || [f.parent1, f.parent2, f.email, f.phone, ...(f.tags || []), ...famPlayers_(f.id).map((p) => p.name)].join(" ").toLowerCase().includes(q));
  $app.innerHTML = `<div class="row spread"><h2>Roster <span class="muted small">${A.families.length} families · ${A.players.length} players</span></h2>
    <div class="row"><button class="btn red sm" id="add">+ Family</button><button class="btn outline sm" id="imp">Import CSV</button><input type="file" id="file" accept=".csv,text/csv" class="hidden"></div></div>
    <input id="q" placeholder="Search name, player, tag…" value="${esc(A.rq || "")}" style="margin-bottom:10px">
    ${list.map((f) => `<div class="card list-item" data-f="${f.id}"><div class="row spread"><b>${esc(f.parent1)}${f.parent2 ? " &amp; " + esc(f.parent2) : ""}</b><span class="muted small">${esc(f.phone || "")}</span></div>
      <div class="small">${famPlayers_(f.id).map((p) => esc(p.name)).join(", ") || '<span class="muted">No players</span>'}</div>
      <div>${(f.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}${f.email ? "" : '<span class="tag" style="border-color:var(--red);color:var(--red)">no login email</span>'}</div></div>`).join("") || `<p class="muted center">No families yet. Add one or import your roster CSV.</p>`}`;
  const qi = document.getElementById("q"); qi.oninput = () => { A.rq = qi.value; const pos = qi.selectionStart; admRoster(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos); };
  document.getElementById("add").onclick = () => editFamily(null);
  document.getElementById("imp").onclick = () => document.getElementById("file").click();
  document.getElementById("file").onchange = async (e) => { const file = e.target.files[0]; if (file) await importCsv(await file.text()); };
  $app.querySelectorAll("[data-f]").forEach((c) => (c.onclick = () => editFamily(A.families.find((f) => f.id === c.dataset.f))));
}

function editFamily(f) {
  const players = f ? famPlayers_(f.id).map((p) => ({ ...p })) : [{ name: "" }];
  const prow = (p, i) => `<div class="player-row" data-i="${i}"><div class="two"><div><label>Player name</label><input data-k="name" value="${esc(p.name)}"></div><div><label>Age</label><input data-k="age" value="${esc(p.age)}"></div></div>
    <div class="two"><div><label>Position</label><input data-k="position" value="${esc(p.position)}"></div><div><label>School / team</label><input data-k="school" value="${esc(p.school)}"></div></div>
    <label>Coach notes (private)</label><input data-k="notes" value="${esc(p.notes)}">${p.id ? `<label class="small"><input type="checkbox" data-k="_del" style="width:auto"> Remove player</label>` : ""}</div>`;
  openModal(`<h2>${f ? "Edit family" : "New family"}</h2><form id="ff">
    <div class="two"><div><label>Parent / guardian 1 *</label><input name="parent1" required value="${esc(f?.parent1)}"></div><div><label>Parent / guardian 2</label><input name="parent2" value="${esc(f?.parent2)}"></div></div>
    <div class="two"><div><label>Phone</label><input name="phone" type="tel" value="${esc(f?.phone)}"></div><div><label>Tags (comma)</label><input name="tags" value="${esc((f?.tags || []).join(", "))}" placeholder="12U, hitting"></div></div>
    <div class="two"><div><label>Login email (guardian 1)</label><input name="email" type="email" value="${esc(f?.email)}"></div><div><label>Login email (guardian 2)</label><input name="email2" type="email" value="${esc(f?.email2)}"></div></div>
    <label>Family notes (private)</label><textarea name="notes" rows="2">${esc(f?.notes)}</textarea>
    <h3>Players</h3><div id="plist">${players.map(prow).join("")}</div><button type="button" class="btn outline sm" id="addp" style="margin-top:8px">+ Add player</button>
    <div class="row spread" style="margin-top:16px"><div class="row"><button class="btn red" type="submit">Save</button><button class="btn outline" type="button" id="cx">Cancel</button></div>
    ${f ? `<button class="btn outline sm" type="button" id="del" style="color:var(--red);border-color:var(--red)">Delete family</button>` : ""}</div></form>`);
  document.getElementById("cx").onclick = closeModal;
  document.getElementById("addp").onclick = () => { players.push({ name: "" }); document.getElementById("plist").append(h(prow({ name: "" }, players.length - 1))); };
  if (f) document.getElementById("del").onclick = async () => {
    if (!confirm(`Delete ${f.parent1}'s family, players, bookings and messages? This can't be undone.`)) return;
    const { error } = await sb.from("families").delete().eq("id", f.id); if (error) return toast(errMsg(error));
    closeModal(); await loadRoster(); admRoster(); toast("Deleted");
  };
  document.getElementById("ff").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const rec = { parent1: fd.get("parent1").trim(), parent2: fd.get("parent2").trim() || null, phone: fd.get("phone").trim() || null, email: fd.get("email").trim().toLowerCase() || null, email2: fd.get("email2").trim().toLowerCase() || null, notes: fd.get("notes").trim() || null, tags: fd.get("tags").split(",").map((t) => t.trim()).filter(Boolean) };
    let famId = f?.id;
    const r = famId ? await sb.from("families").update(rec).eq("id", famId) : await sb.from("families").insert(rec).select("id").single();
    if (r.error) return toast(errMsg(r.error)); if (!famId) famId = r.data.id;
    for (const row of document.querySelectorAll("#plist .player-row")) {
      const p = players[+row.dataset.i]; const val = (k) => row.querySelector(`[data-k="${k}"]`)?.value.trim() || null;
      const del = row.querySelector('[data-k="_del"]')?.checked;
      const pr = { family_id: famId, name: val("name"), age: val("age"), position: val("position"), school: val("school"), notes: val("notes") };
      let res;
      if (p.id && del) res = await sb.from("players").delete().eq("id", p.id);
      else if (p.id) res = await sb.from("players").update(pr).eq("id", p.id);
      else if (pr.name) res = await sb.from("players").insert(pr);
      if (res?.error) return toast(errMsg(res.error));
    }
    closeModal(); await loadRoster(); admRoster(); toast("Saved");
  };
}

// CSV (compatible with the Turc Time roster prototype export)
export function parseCsv(text) {
  const rows = []; let i = 0, field = "", row = [], inQ = false; text = text.replace(/^\uFEFF/, "");
  while (i < text.length) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export function csvToFamilies(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error("CSV is empty");
  const head = rows[0].map((x) => x.trim().toLowerCase()); const ix = (n) => head.indexOf(n);
  for (const n of ["parent1", "player_name"]) if (ix(n) < 0) throw new Error("CSV needs columns parent1 and player_name");
  const fams = {};
  for (const cols of rows.slice(1)) {
    const g = (n) => (ix(n) >= 0 ? (cols[ix(n)] || "").trim() : "");
    if (!g("parent1")) continue;
    const key = g("family_id") || `csv:${g("parent1").toLowerCase()}|${g("phone").replace(/\D/g, "")}`;
    fams[key] ||= { legacy_id: key, parent1: g("parent1"), parent2: g("parent2") || null, phone: g("phone") || null, email: g("email").toLowerCase() || null, notes: g("family_notes") || null, tags: g("tags").split(/[;,]/).map((t) => t.trim()).filter(Boolean), players: [] };
    if (g("player_name")) fams[key].players.push({ legacy_id: g("player_id") || `${key}#${g("player_name").toLowerCase()}`, name: g("player_name"), age: g("age") || null, position: g("position") || null, school: g("school") || null, notes: g("player_notes") || null });
  }
  return Object.values(fams);
}
async function importCsv(text) {
  let fams; try { fams = csvToFamilies(text); } catch (e) { return toast(e.message); }
  const np = fams.reduce((n, f) => n + f.players.length, 0);
  if (!confirm(`Import ${fams.length} families and ${np} players? Existing ones from a previous import are updated, not duplicated.`)) return;
  const { data, error } = await sb.from("families").upsert(fams.map(({ players, ...f }) => f), { onConflict: "legacy_id" }).select("id,legacy_id");
  if (error) return toast(errMsg(error));
  const idBy = Object.fromEntries(data.map((r) => [r.legacy_id, r.id]));
  const pl = fams.flatMap((f) => f.players.map((p) => ({ ...p, family_id: idBy[f.legacy_id] })));
  if (pl.length) { const r = await sb.from("players").upsert(pl, { onConflict: "legacy_id" }); if (r.error) return toast(errMsg(r.error)); }
  await loadRoster(); admRoster(); toast(`Imported ${fams.length} families`);
}

// ---- Availability ----
const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 6am – 9pm starts
async function weekSlots(weekStart) {
  const { data, error } = await sb.from("slots").select("*").gte("starts_at", weekStart.toISOString()).lt("starts_at", addDays(weekStart, 7).toISOString()).order("starts_at");
  if (error) throw error; return data;
}
async function admAvail(quiet) {
  if (!quiet) $app.innerHTML = `<div class="center muted">Loading…</div>`;
  let slots; try { slots = await weekSlots(A.week); } catch (e) { return toast(errMsg(e)); }
  const days = Array.from({ length: 7 }, (_, i) => addDays(A.week, i));
  const cellSlots = (d, hr) => slots.filter((s) => { const t = new Date(s.starts_at); return dayKey(t) === dayKey(d) && t.getHours() === hr; });
  const now = new Date();
  const openN = slots.filter((s) => s.booked_count < s.capacity).length;
  $app.innerHTML = `<h2>Weekly availability</h2>
  <div class="row spread" style="margin-bottom:8px"><div class="row"><button class="btn outline sm" id="prev">‹</button><b>${fmtDay(A.week)} – ${fmtDay(addDays(A.week, 6))}</b><button class="btn outline sm" id="next">›</button></div>
  <button class="btn red sm" id="copy">Copy last week</button></div>
  <p class="small muted">Tap an hour to open a ${CFG.DEFAULT_SLOT_MINUTES}-min slot; tap again to remove. ${slots.length} slots · ${openN} open.
  <span class="legend"><span style="background:#dbeafe"></span>open<span style="background:var(--red)"></span>booked</span></p>
  <div class="grid-wrap"><table class="grid"><thead><tr><th></th>${days.map((d) => `<th>${d.toLocaleDateString(undefined, { weekday: "short" })}<br>${d.getMonth() + 1}/${d.getDate()}</th>`).join("")}</tr></thead><tbody>
  ${HOURS.map((hr) => `<tr><td class="hr">${fmtTime(new Date(2000, 0, 1, hr))}</td>${days.map((d, di) => {
    const cs = cellSlots(d, hr); const at = new Date(d); at.setHours(hr, 0, 0, 0); const past = at < now;
    const booked = cs.some((s) => s.booked_count > 0);
    const cls = booked ? "booked" : cs.length ? "open" : past ? "past" : "";
    const label = cs.length ? cs.map((s) => (s.booked_count ? "●" : fmtTime(s.starts_at).replace(/\s?[AP]M/i, ""))).join(" ") : "";
    return `<td class="cell ${cls}" data-d="${di}" data-h="${hr}">${label}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>
  <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Add a custom slot</h3><form id="cust" class="two">
   <div><label>Date</label><input type="date" name="d" required value="${dayKey(days[0] < now ? now : days[0])}"></div><div><label>Start</label><input type="time" name="t" required value="16:30"></div>
   <div><label>Minutes</label><input type="number" name="m" min="15" step="15" value="${CFG.DEFAULT_SLOT_MINUTES}"></div><div><label>Location (optional)</label><input name="loc"></div>
   <button class="btn red" type="submit" style="grid-column:1/-1">Add slot</button></form></div>`;
  document.getElementById("prev").onclick = () => { A.week = addDays(A.week, -7); admAvail(); };
  document.getElementById("next").onclick = () => { A.week = addDays(A.week, 7); admAvail(); };
  document.getElementById("copy").onclick = () => copyLastWeek(slots);
  document.getElementById("cust").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const st = new Date(`${fd.get("d")}T${fd.get("t")}`); const en = new Date(st.getTime() + (+fd.get("m") || 60) * 60000);
    const { error } = await sb.from("slots").insert({ starts_at: st.toISOString(), ends_at: en.toISOString(), location: fd.get("loc").trim() || null });
    toast(error ? errMsg(error) : "Slot added"); admAvail(true);
  };
  $app.querySelectorAll("td.cell").forEach((td) => (td.onclick = async () => {
    const d = days[+td.dataset.d], hr = +td.dataset.h; const cs = cellSlots(d, hr);
    if (cs.some((s) => s.booked_count > 0)) return showSlotBookings(cs.find((s) => s.booked_count > 0));
    if (cs.length) { const { error } = await sb.from("slots").delete().in("id", cs.map((s) => s.id)); if (error) toast(errMsg(error)); return admAvail(true); }
    const st = new Date(d); st.setHours(hr, 0, 0, 0); if (st < now) return toast("That time has passed");
    const { error } = await sb.from("slots").insert({ starts_at: st.toISOString(), ends_at: new Date(st.getTime() + CFG.DEFAULT_SLOT_MINUTES * 60000).toISOString() });
    if (error) toast(errMsg(error)); admAvail(true);
  }));
}
export function shiftSlotsForward(prevSlots, existing, now = new Date()) {
  const have = new Set(existing.map((s) => new Date(s.starts_at).getTime()));
  return prevSlots.map((s) => {
    const st = addDays(new Date(s.starts_at), 7), en = addDays(new Date(s.ends_at), 7); // addDays keeps wall-clock time across DST
    return { starts_at: st.toISOString(), ends_at: en.toISOString(), capacity: s.capacity, location: s.location };
  }).filter((s) => new Date(s.starts_at) > now && !have.has(new Date(s.starts_at).getTime()));
}
async function copyLastWeek(current) {
  let prev; try { prev = await weekSlots(addDays(A.week, -7)); } catch (e) { return toast(errMsg(e)); }
  const rows = shiftSlotsForward(prev, current);
  if (!rows.length) return toast(prev.length ? "Nothing new to copy" : "Last week has no slots");
  const { error } = await sb.from("slots").insert(rows);
  toast(error ? errMsg(error) : `Copied ${rows.length} slots`); admAvail(true);
}
async function showSlotBookings(slot) {
  const { data } = await sb.from("bookings").select("id,player_id,family_id").eq("slot_id", slot.id).eq("status", "booked");
  const pn = (id) => A.players.find((p) => p.id === id)?.name || "?";
  openModal(`<h2>${fmtWhen(slot.starts_at)}</h2>${(data || []).map((b) => `<div class="slot"><span><b>${esc(pn(b.player_id))}</b><br><span class="small muted">${esc(famName(b.family_id))}</span></span><button class="btn outline sm" data-c="${b.id}">Cancel booking</button></div>`).join("")}
   <button class="btn outline" id="cx" style="margin-top:12px">Close</button>`);
  document.getElementById("cx").onclick = closeModal;
  $modalCard.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => { if (!confirm("Cancel this booking?")) return; const { error } = await sb.rpc("cancel_booking", { p_booking: b.dataset.c }); toast(error ? errMsg(error) : "Cancelled"); closeModal(); admAvail(true); }));
}

// ---- Bookings ----
async function admBookings(quiet) {
  if (!quiet) $app.innerHTML = `<div class="center muted">Loading…</div>`;
  const past = !!A.showPast; const now = new Date().toISOString();
  let q = sb.from("bookings").select("id,status,player_id,family_id,price_cents,slot:slots!inner(starts_at,ends_at,location)").eq("status", "booked");
  q = past ? q.lt("slot.starts_at", now).gte("slot.starts_at", addDays(new Date(), -60).toISOString()) : q.gte("slot.starts_at", now);
  const { data, error } = await q; if (error) return ($app.innerHTML = `<div class="card">${esc(errMsg(error))}</div>`);
  const rows = data.sort((a, b) => new Date(a.slot.starts_at) - new Date(b.slot.starts_at)); if (past) rows.reverse();
  const byDay = {}; rows.forEach((b) => (byDay[dayKey(b.slot.starts_at)] ||= []).push(b));
  const pn = (id) => A.players.find((p) => p.id === id)?.name || "?";
  const total = rows.reduce((n, b) => n + b.price_cents, 0) / 100;
  $app.innerHTML = `<div class="row spread"><h2>${past ? "Past 60 days" : "Upcoming sessions"}</h2><button class="btn outline sm" id="tog">${past ? "Show upcoming" : "Show past"}</button></div>
  <p class="muted small">${rows.length} sessions · $${total.toFixed(0)}</p>
  ${Object.keys(byDay).map((k) => `<div class="card"><h3 style="margin-top:0">${fmtDay(byDay[k][0].slot.starts_at)}</h3>${byDay[k].map((b) => `<div class="slot"><span><b>${fmtTime(b.slot.starts_at)}</b> ${esc(pn(b.player_id))}<br><span class="small muted">${esc(famName(b.family_id))}${b.slot.location ? " · " + esc(b.slot.location) : ""}</span></span>
   <span class="row"><button class="btn outline sm" data-msg="${b.family_id}">Message</button>${past ? "" : `<button class="btn outline sm" data-c="${b.id}">Cancel</button>`}</span></div>`).join("")}</div>`).join("") || `<p class="muted center">No sessions.</p>`}`;
  document.getElementById("tog").onclick = () => { A.showPast = !past; admBookings(); };
  $app.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => { if (!confirm("Cancel this booking? Let the family know in Messages.")) return; const { error } = await sb.rpc("cancel_booking", { p_booking: b.dataset.c }); toast(error ? errMsg(error) : "Cancelled"); admBookings(true); }));
  $app.querySelectorAll("[data-msg]").forEach((b) => (b.onclick = () => { S.tab = "inbox"; $tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.t === "inbox")); admThread(b.dataset.msg); }));
}

// ---- Inbox ----
async function admInbox() {
  A.openFamily = null;
  const { data, error } = await sb.from("messages").select("family_id,sender,body,created_at,read_at,broadcast_id").order("created_at", { ascending: false }).limit(1000);
  if (error) return ($app.innerHTML = `<div class="card">${esc(errMsg(error))}</div>`);
  const last = {}, unread = {};
  data.forEach((m) => { if (!last[m.family_id] && !m.broadcast_id) last[m.family_id] = m; if (m.sender === "family" && !m.read_at) unread[m.family_id] = (unread[m.family_id] || 0) + 1; });
  const fams = [...A.families].sort((a, b) => (last[b.id]?.created_at || "").localeCompare(last[a.id]?.created_at || "") || a.parent1.localeCompare(b.parent1));
  $app.innerHTML = `<h2>Inbox</h2>` + fams.map((f) => { const m = last[f.id]; return `<div class="card list-item" data-f="${f.id}"><div class="row spread"><span class="${unread[f.id] ? "unread" : ""}">${esc(f.parent1)} <span class="muted small">${famPlayers_(f.id).map((p) => esc(p.name)).join(", ")}</span></span>${unread[f.id] ? `<span class="badge">${unread[f.id]}</span>` : `<span class="muted small">${m ? fmtDay(m.created_at) : ""}</span>`}</div>
    <div class="small muted">${m ? (m.sender === "coach" ? "You: " : "") + esc(m.body.slice(0, 80)) : "No messages"}</div></div>`; }).join("");
  $app.querySelectorAll("[data-f]").forEach((c) => (c.onclick = () => admThread(c.dataset.f)));
}
async function admThread(famId) {
  A.openFamily = famId;
  const { data, error } = await sb.from("messages").select("*").eq("family_id", famId).order("created_at").limit(300);
  if (error) return toast(errMsg(error));
  const unread = data.filter((m) => m.sender === "family" && !m.read_at).map((m) => m.id);
  if (unread.length) { await sb.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread); refreshUnread(); }
  const f = A.families.find((x) => x.id === famId) || {};
  renderThread(data, "coach", (body) => sb.from("messages").insert({ family_id: famId, sender: "coach", sender_email: S.me.email, body }),
    `${f.parent1 || "Family"}`, `<button class="btn outline sm" id="back" style="margin-bottom:8px">‹ Inbox</button>${f.phone ? ` <a class="btn outline sm" href="sms:${esc(f.phone)}">Text ${esc(f.phone)}</a>` : ""}`);
  document.getElementById("back").onclick = admInbox;
}

// ---- Broadcast ----
function admBroadcast() {
  const tags = [...new Set(A.families.flatMap((f) => f.tags || []))].sort((a, b) => a.localeCompare(b));
  const count = (t) => A.families.filter((f) => !t || (f.tags || []).some((x) => x.toLowerCase() === t.toLowerCase())).length;
  $app.innerHTML = `<h2>Broadcast</h2><div class="card"><form id="bf">
   <label>Send to</label><select name="tag"><option value="">Everyone (${count("")})</option>${tags.map((t) => `<option value="${esc(t)}">${esc(t)} (${count(t)})</option>`).join("")}</select>
   <label>Message</label><textarea name="body" rows="5" required maxlength="4000">Hi! Turc Time Training sessions for this week are open. Grab a time in the app. - ${esc(CFG.COACH_NAME)}</textarea>
   <p class="small muted">Shows up in each family's Messages thread in the app.</p>
   <button class="btn red block" type="submit">Send broadcast</button></form></div><div id="hist"></div>`;
  document.getElementById("bf").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const tag = fd.get("tag");
    if (!confirm(`Send to ${count(tag)} families?`)) return;
    const { data, error } = await sb.rpc("send_broadcast", { p_tag: tag, p_body: fd.get("body").trim() });
    toast(error ? errMsg(error) : `Sent to ${data} families`); if (!error) loadHist();
  };
  loadHist();
}
async function loadHist() {
  const { data } = await sb.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(10);
  const el = document.getElementById("hist"); if (!el || !data?.length) return;
  el.innerHTML = `<h3>Recent</h3>` + data.map((b) => `<div class="card small"><b>${esc(b.tag || "Everyone")}</b> · ${b.recipients} families · <span class="muted">${fmtWhen(b.created_at)}</span><div>${esc(b.body)}</div></div>`).join("");
}
