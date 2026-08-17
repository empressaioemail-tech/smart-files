/* G-68 Smart Files browser. G-72 embed chrome (WDLL items 2-4).
   Write path still goes through api() → /api/files BFF.
   No Google OAuth. Persona select lives in the demo fixture panel only.
   Embed: ?embed=1|true, iframe, or dashboards referrer sets html[data-embed=1]. */

const PERSONAS = [
  { orgId: "acme", userId: "joe", label: "Joe / Acme" },
  { orgId: "acme", userId: "jane", label: "Jane / Acme" },
  { orgId: "empressa", userId: "nick", label: "Nick / Empressa" },
];

const FIXTURE_GRANTS = [
  { id: "ds", who: "Development services", permission: "Edit", grantedBy: "S. Carrillo", when: "2026-08-12 09:04", fixture: true },
  { id: "pe", who: "Plans examiners", permission: "View", grantedBy: "S. Carrillo", when: "2026-08-12 09:05", fixture: true },
  { id: "fin", who: "Finance", permission: "None", grantedBy: "S. Carrillo", when: "2026-08-14 11:02", revoked: true, fixture: true },
];

const $ = (id) => document.getElementById(id);
const errEl = $("err");

function showErr(msg) {
  errEl.hidden = !msg;
  errEl.textContent = msg || "";
}

function persona() {
  const [orgId, userId] = $("persona").value.split("/");
  return { orgId, userId };
}

function embedParam() {
  return new URL(location.href).searchParams.get("embed");
}

function isEmbedded() {
  const q = embedParam();
  if (q === "1" || q === "true") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const ref = document.referrer || "";
  return /smartcity-dashboards|dashboards/i.test(ref);
}

function applyEmbedChrome() {
  if (isEmbedded()) document.documentElement.dataset.embed = "1";
  else delete document.documentElement.dataset.embed;
}

function api(path, opts = {}) {
  const u = new URL("/api/files", location.origin);
  u.searchParams.set("path", path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) u.searchParams.set(k, v);
  }
  return fetch(u, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (res) => {
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: "not_json", preview: text.slice(0, 180) };
    }
    if (!res.ok) {
      throw new Error(json.message || json.error || `HTTP ${res.status}`);
    }
    return json;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

let selectedFolder = null;
let selectedFile = null;
let folders = [];
let files = [];
let place = "my-files";
let listMode = "list";
let recents = [];
const linksByFolder = new Map();
const revoked = new Set();

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function kindOf(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf") || n.endsWith(".dwg") || n.endsWith(".dxf")) return "Sheet";
  if (n.endsWith(".docx") || n.endsWith(".doc") || n.endsWith(".txt")) return "Document";
  if (n.endsWith(".zip")) return "Archive";
  return "File";
}

function fmtWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function accessLabel(policy) {
  const p = String(policy || "tenant-private");
  if (p === "tenant-private") return "Tenant private";
  return p;
}

function personaLabel() {
  const p = PERSONAS.find((x) => `${x.orgId}/${x.userId}` === $("persona").value);
  return p?.label || "Staff";
}

function grantsFor(folder) {
  if (!folder) return [];
  const live = linksByFolder.get(folder.folderId) || [];
  return [
    ...FIXTURE_GRANTS.map((g) => ({
      ...g,
      revoked: revoked.has(`${folder.folderId}:${g.id}`) || g.revoked,
    })),
    ...live,
  ];
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setPlace(next, opts = {}) {
  place = next;
  if (!opts.keepFolder && next !== "people") {
    if (next !== "my-files") selectedFolder = null;
    selectedFile = null;
    files = [];
  }
  document.querySelectorAll(".shell-nav [data-place]").forEach((b) => {
    b.classList.toggle("on", b.dataset.place === next);
  });
  $("browser-view").hidden = next === "bring" || next === "people";
  $("bring-view").hidden = next !== "bring";
  $("people-view").hidden = next !== "people";
  $("create-folder").hidden = next === "bring" || next === "people";
  const titles = {
    search: "Search",
    recents: "Recents",
    "my-files": selectedFolder ? selectedFolder.label : "My files",
    "shared-with-me": "Shared with me",
    "shared-by-me": "Shared by me",
    bring: "Bring files",
    people: "People and access",
  };
  $("page-title").textContent = titles[next] || "Files";
  if (next === "people" && selectedFolder) {
    $("crumb").innerHTML = `<b>My files</b> <span>/</span> ${escapeHtml(selectedFolder.label)} <span>/</span> People and access`;
    $("people-folder").textContent = selectedFolder.label;
  } else if (selectedFolder && next === "my-files") {
    $("crumb").innerHTML = `<b>My files</b> <span>/</span> ${escapeHtml(selectedFolder.label)}`;
  } else {
    $("crumb").innerHTML = `<b>${escapeHtml(titles[next] || "Files")}</b>`;
  }
  if (next !== "bring" && next !== "people") renderList();
  renderAccess();
}

function visibleFolders() {
  const q = ($("q").value || "").trim().toLowerCase();
  let list = folders;
  if (place === "recents") {
    list = recents.map((id) => folders.find((f) => f.folderId === id)).filter(Boolean);
  } else if (place === "shared-with-me") {
    list = [];
  } else if (place === "shared-by-me") {
    list = folders.filter((f) => (linksByFolder.get(f.folderId) || []).length);
  } else if (place === "search") {
    list = folders.filter((f) => !q || f.label.toLowerCase().includes(q));
  }
  if (q && place !== "search") list = list.filter((f) => f.label.toLowerCase().includes(q));
  return list;
}

function renderNavFolders() {
  const host = $("folders");
  host.innerHTML = "";
  for (const f of folders) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "navitem" + (selectedFolder?.folderId === f.folderId ? " on" : "");
    b.textContent = f.label;
    b.addEventListener("click", () => openFolder(f));
    host.append(b);
  }
  $("count-mine").textContent = String(folders.length);
  $("count-with").textContent = "0";
  $("count-by").textContent = String(
    folders.filter((f) => (linksByFolder.get(f.folderId) || []).length).length,
  );
}

function rowHtml(kind, name, version, who, revised, refs, selected) {
  return `<tr class="${selected ? "r-info" : ""}" aria-selected="${selected ? "true" : "false"}">
    <td class="rail"><i></i></td>
    <td class="subj">${escapeHtml(name)}</td>
    <td>${escapeHtml(kind)}</td>
    <td class="id">${escapeHtml(version)}</td>
    <td>${escapeHtml(who)}</td>
    <td class="id">${escapeHtml(revised)}</td>
    <td class="num">${escapeHtml(String(refs))}</td>
  </tr>`;
}

function resetEmptyCopy() {
  const empty = $("empty-state");
  empty.querySelector(".st-k").textContent = "No rooms";
  empty.querySelector("h5").textContent = "No file rooms for this tenant yet.";
  empty.querySelector("p").textContent =
    "Files are private to the tenant that owns them. Nothing has been created here, and nothing has been shared with it.";
  empty.querySelector(".basis").innerHTML =
    "Basis: 0 rooms owned, 0 rooms shared to this tenant<br />Contact: create the first folder, or bring files from a link";
}

function renderList() {
  const tbody = $("file-rows");
  const grid = $("grid");
  const empty = $("empty-state");
  const table = $("file-table");
  tbody.innerHTML = "";
  grid.innerHTML = "";

  if (selectedFolder && place === "my-files") {
    empty.hidden = true;
    table.hidden = listMode !== "list";
    grid.hidden = listMode !== "grid";
    $("list-meta").textContent = `${files.length} files`;
    if (!files.length && listMode === "list") {
      tbody.innerHTML = `<tr><td colspan="7"><span class="t-caption">No files in this folder.</span></td></tr>`;
    }
    files.forEach((f) => {
      const selected = selectedFile?.entityId === f.entityId;
      const who = accessLabel(f.accessPolicy);
      if (listMode === "list") {
        tbody.insertAdjacentHTML(
          "beforeend",
          rowHtml(
            kindOf(f.title),
            f.title,
            `v${f.currentVersion || 1}`,
            who,
            fmtWhen(f.updatedAt || f.createdAt),
            f.referencedByCount ?? 0,
            selected,
          ),
        );
        tbody.lastElementChild.addEventListener("click", () => {
          selectedFile = f;
          renderList();
          renderAccess();
        });
      } else {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "file-tile";
        tile.setAttribute("aria-selected", selected ? "true" : "false");
        tile.innerHTML = `<b>${escapeHtml(f.title)}</b><span>${kindOf(f.title)} · v${f.currentVersion || 1}</span>`;
        tile.addEventListener("click", () => {
          selectedFile = f;
          renderList();
          renderAccess();
        });
        grid.append(tile);
      }
    });
    return;
  }

  const list = visibleFolders();
  $("list-meta").textContent = `${list.length} folders`;
  resetEmptyCopy();
  if (place === "shared-with-me") {
    empty.querySelector(".st-k").textContent = "Nothing shared";
    empty.querySelector("h5").textContent = "Nothing has been shared with this tenant.";
    empty.querySelector("p").textContent =
      "Shared with me lists folders someone named you on. No inbound shares are on this fixture.";
    empty.querySelector(".basis").innerHTML =
      "Basis: 0 rooms shared to this tenant<br />Next: request access, or open My files";
  } else if (place === "shared-by-me" && !list.length) {
    empty.querySelector(".st-k").textContent = "No links yet";
    empty.querySelector("h5").textContent = "You have not shared a folder yet.";
    empty.querySelector("p").textContent =
      "Share a folder to mint a view-only link. That grant becomes a row here with a name and a time.";
    empty.querySelector(".basis").innerHTML =
      "Basis: 0 share links minted in this session<br />Next: open a folder and share";
  }
  const showEmpty =
    (place === "my-files" && !folders.length) ||
    place === "shared-with-me" ||
    (place === "shared-by-me" && !list.length) ||
    (place === "recents" && !list.length) ||
    (place === "search" && !list.length);
  empty.hidden = !showEmpty;
  table.hidden = showEmpty || listMode !== "list";
  grid.hidden = showEmpty || listMode !== "grid";
  list.forEach((f) => {
    const selected = selectedFolder?.folderId === f.folderId;
    const who = accessLabel(f.accessPolicy);
    if (listMode === "list") {
      tbody.insertAdjacentHTML(
        "beforeend",
        rowHtml("Folder", f.label, "—", who, fmtWhen(f.createdAt), 0, selected),
      );
      tbody.lastElementChild.addEventListener("click", () => openFolder(f));
    } else {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "file-tile";
      tile.innerHTML = `<b>${escapeHtml(f.label)}</b><span>Folder · ${who}</span>`;
      tile.addEventListener("click", () => openFolder(f));
      grid.append(tile);
    }
  });
}

function renderAccess() {
  const rail = $("access-rail");
  const target = selectedFile || selectedFolder;
  const show = Boolean(target) && place !== "bring" && place !== "people";
  rail.hidden = !show;
  $("share").hidden = !selectedFolder || place === "bring" || place === "people";
  $("upload-btn").hidden = !selectedFolder || place === "bring" || place === "people";
  if (!show) return;
  const rows = $("access-rows");
  const grants = selectedFolder ? grantsFor(selectedFolder).filter((g) => !g.revoked) : [];
  rows.innerHTML = `
    <div class="srcreg">
      <i class="rail"></i>
      <span class="nm"><b>Tenant private</b><span>Default until someone is named</span></span>
      <span class="pill p-restricted"><span class="gl">●</span> Default</span>
      <span></span>
    </div>`;
  for (const g of grants) {
    const pill = g.kind === "link" || g.permission === "View" ? "p-info" : "p-ok";
    const mark = g.permission === "View" || g.kind === "link" ? "●" : "✓";
    const who = g.kind === "link" ? "Share link" : g.who;
    const meta =
      g.kind === "link"
        ? `Created by ${g.grantedBy} · ${g.when}`
        : `Granted by ${g.grantedBy} · ${g.when}`;
    rows.insertAdjacentHTML(
      "beforeend",
      `<div class="srcreg ok">
        <i class="rail"></i>
        <span class="nm"><b>${escapeHtml(who)}</b><span>${escapeHtml(meta)}</span></span>
        <span class="pill ${pill}"><span class="gl">${mark}</span> ${escapeHtml(g.permission)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-revoke="${escapeHtml(g.id || g.token || "")}">Revoke</button>
      </div>`,
    );
  }
  rows.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!selectedFolder) return;
      revoked.add(`${selectedFolder.folderId}:${btn.dataset.revoke}`);
      const live = linksByFolder.get(selectedFolder.folderId) || [];
      linksByFolder.set(
        selectedFolder.folderId,
        live.filter((g) => g.token !== btn.dataset.revoke && g.id !== btn.dataset.revoke),
      );
      renderAccess();
      renderPeople();
    });
  });
}

function renderPeople() {
  const tbody = $("people-rows");
  tbody.innerHTML = "";
  if (!selectedFolder) {
    tbody.innerHTML = `<tr><td colspan="6"><span class="t-caption">Select a folder first.</span></td></tr>`;
    return;
  }
  for (const g of grantsFor(selectedFolder)) {
    const pill = g.revoked ? "p-quiet" : g.kind === "link" || g.permission === "View" ? "p-info" : "p-ok";
    const perm = g.revoked ? "None" : g.permission;
    const who = g.kind === "link" ? "Share link" : g.who;
    const action = g.revoked ? "Restore" : "Revoke";
    tbody.insertAdjacentHTML(
      "beforeend",
      `<tr class="${g.kind === "link" && !g.revoked ? "r-info" : ""}">
        <td class="rail"><i></i></td>
        <td class="subj">${escapeHtml(who)}${g.revoked ? " · revoked" : ""}</td>
        <td><span class="pill ${pill}"><span class="gl">${g.revoked ? "–" : "●"}</span> ${escapeHtml(perm)}</span></td>
        <td>${escapeHtml(g.grantedBy)}</td>
        <td class="id">${escapeHtml(g.when)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm">${action}</button></td>
      </tr>`,
    );
    tbody.lastElementChild.querySelector("button").addEventListener("click", () => {
      const key = `${selectedFolder.folderId}:${g.id || g.token}`;
      if (g.revoked) revoked.delete(key);
      else revoked.add(key);
      renderPeople();
      renderAccess();
    });
  }
}

function renderShareDialog() {
  $("share-dialog-title").textContent = selectedFolder
    ? `Share “${selectedFolder.label}”`
    : "Share";
  const host = $("share-people");
  host.innerHTML = "";
  const grants = selectedFolder
    ? grantsFor(selectedFolder).filter((g) => !g.revoked && g.kind !== "link")
    : [];
  if (!grants.length) {
    host.innerHTML =
      `<div class="row between"><span class="t-caption">Tenant private until someone is named</span><span class="pill p-restricted"><span class="gl">●</span> Default</span></div>`;
  }
  for (const g of grants) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="row between"><span class="t-caption">${escapeHtml(g.who)}</span><span class="pill p-ok"><span class="gl">✓</span> ${escapeHtml(g.permission)}</span></div>`,
    );
  }
}

function openShareDialog() {
  if (!selectedFolder) {
    toast("Select a folder to share.");
    return;
  }
  $("share-out").hidden = true;
  renderShareDialog();
  $("share-dialog").hidden = false;
}

function closeShareDialog() {
  $("share-dialog").hidden = true;
}

async function mintShare() {
  if (!selectedFolder) return null;
  showErr("");
  const data = await api(
    `/api/smart-files/folders/${encodeURIComponent(selectedFolder.folderId)}/share`,
    { method: "POST", body: persona() },
  );
  const url = `${location.origin}/#share=${data.token}`;
  const row = {
    id: data.token,
    token: data.token,
    url,
    kind: "link",
    who: "Share link",
    permission: "View",
    grantedBy: personaLabel(),
    when: fmtWhen(new Date().toISOString()),
  };
  const live = linksByFolder.get(selectedFolder.folderId) || [];
  linksByFolder.set(selectedFolder.folderId, [...live, row]);
  $("share-out").hidden = false;
  $("share-out").textContent = url;
  renderAccess();
  renderNavFolders();
  return row;
}

async function loadFolders() {
  const { orgId } = persona();
  const data = await api("/api/smart-files/folders", {
    query: { scopeType: "tenant", scopeId: orgId },
  });
  folders = data.folders || [];
  renderNavFolders();
  if (place !== "bring" && place !== "people") renderList();
}

async function openFolder(folder) {
  selectedFolder = folder;
  selectedFile = null;
  recents = [folder.folderId, ...recents.filter((id) => id !== folder.folderId)].slice(0, 12);
  $("share").hidden = false;
  $("upload-btn").hidden = false;
  const data = await api(`/api/smart-files/folders/${encodeURIComponent(folder.folderId)}/files`);
  files = data.files || [];
  setPlace("my-files", { keepFolder: true });
  renderNavFolders();
  renderList();
  renderAccess();
}

function renderFiles(ul, list) {
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = "<li class='meta'>No files in this room.</li>";
    return;
  }
  for (const f of list) {
    const li = document.createElement("li");
    li.innerHTML = `<div>${escapeHtml(f.title)}</div><div class="meta">${escapeHtml(f.entityId)} · ${escapeHtml(accessLabel(f.accessPolicy))}</div>`;
    ul.append(li);
  }
}

async function loadShare(token) {
  $("app").hidden = true;
  $("fixture-panel").hidden = true;
  $("share-dialog").hidden = true;
  $("share-view").hidden = false;
  document.documentElement.dataset.theme = "light";
  try {
    const data = await api(`/api/smart-files/share/${encodeURIComponent(token)}`);
    $("share-request").hidden = true;
    $("share-title").textContent = data.folder?.label || "Shared room";
    $("share-who").textContent = "Shared as a read-only copy. This is not a staff session.";
    renderFiles($("share-files"), data.files || []);
  } catch (e) {
    $("share-title").textContent = "Request access";
    $("share-files").innerHTML = "";
    $("share-request").hidden = false;
    $("share-who").textContent = e.message || "This link cannot be read.";
  }
}

function refuseOAuth() {
  toast("Connected Drive starts Not connected on this demo. No account connection is faked. Paste a share link.");
}

function boot() {
  applyEmbedChrome();
  const sel = $("persona");
  for (const p of PERSONAS) {
    const o = document.createElement("option");
    o.value = `${p.orgId}/${p.userId}`;
    o.textContent = p.label;
    sel.append(o);
  }
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const share = hash.get("share");
  if (share) {
    loadShare(share).catch((e) => showErr(e.message));
    return;
  }
  sel.addEventListener("change", () => {
    selectedFolder = null;
    selectedFile = null;
    files = [];
    setPlace("my-files");
    loadFolders().catch((e) => showErr(e.message));
  });
  document.querySelectorAll("[data-place]").forEach((el) => {
    el.addEventListener("click", () => setPlace(el.dataset.place));
  });
  $("refresh").addEventListener("click", () => loadFolders().catch((e) => showErr(e.message)));
  $("q").addEventListener("input", () => {
    if (place === "bring" || place === "people") return;
    if (place !== "search" && $("q").value) setPlace("search");
    else renderList();
  });
  $("view-list").addEventListener("click", () => {
    listMode = "list";
    $("view-list").classList.add("on");
    $("view-grid").classList.remove("on");
    renderList();
  });
  $("view-grid").addEventListener("click", () => {
    listMode = "grid";
    $("view-grid").classList.add("on");
    $("view-list").classList.remove("on");
    renderList();
  });
  $("create-folder").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    showErr("");
    const label = new FormData(ev.target).get("label");
    const created = await api("/api/smart-files/folders", {
      method: "POST",
      body: { ...persona(), label },
    });
    ev.target.reset();
    await loadFolders();
    await openFolder(created.folder);
  });
  $("empty-create").addEventListener("click", () => {
    $("create-folder").querySelector("input").focus();
  });
  $("empty-request").addEventListener("click", () => {
    toast("Request access is a named next step. Ask the folder owner to share a view-only link.");
  });
  const pickFile = () => {
    if (!selectedFolder) {
      toast("Open a folder before uploading.");
      return;
    }
    $("upload").file.click();
  };
  $("upload-btn").addEventListener("click", pickFile);
  $("upload-quiet").addEventListener("click", pickFile);
  $("upload").addEventListener("change", () => {
    if ($("upload").file.files[0]) $("upload").requestSubmit();
  });
  $("upload").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selectedFolder) return;
    showErr("");
    const file = ev.target.file.files[0];
    if (!file) return;
    const bytesBase64 = await fileToBase64(file);
    await api(`/api/smart-files/folders/${encodeURIComponent(selectedFolder.folderId)}/files`, {
      method: "POST",
      body: {
        ...persona(),
        title: file.name,
        contentType: file.type || "application/octet-stream",
        bytesBase64,
      },
    });
    ev.target.reset();
    await openFolder(selectedFolder);
  });
  $("share").addEventListener("click", openShareDialog);
  $("share-rail").addEventListener("click", openShareDialog);
  $("share-close").addEventListener("click", closeShareDialog);
  $("share-scrim").addEventListener("click", closeShareDialog);
  $("share-done").addEventListener("click", closeShareDialog);
  $("share-copy").addEventListener("click", async () => {
    try {
      const row = await mintShare();
      if (!row) return;
      try {
        await navigator.clipboard.writeText(row.url);
        $("share-out").textContent = `${row.url} (copied)`;
      } catch {
        /* clipboard may be blocked */
      }
      toast("Share link minted. Recipient sees this folder only, read-only.");
    } catch (e) {
      showErr(e.message);
    }
  });
  $("share-add").addEventListener("click", () => {
    toast("Named people are recorded as widenings. On this demo, mint a view-only link.");
  });
  $("open-people").addEventListener("click", () => {
    if (!selectedFolder) {
      toast("Select a folder first.");
      return;
    }
    setPlace("people", { keepFolder: true });
    renderPeople();
  });
  $("people-back").addEventListener("click", () => setPlace("my-files", { keepFolder: true }));
  document.querySelectorAll(".drive-connect").forEach((b) => b.addEventListener("click", refuseOAuth));
  $("bring-go").addEventListener("click", () => {
    const link = $("bring-link").value.trim();
    if (!link) {
      toast("Paste a share link. Checking, converted, partial, and failed states are fixture chrome on this page.");
      return;
    }
    toast("Bring files is chrome on this card. The designed states are already on this page. No Drive sync runs.");
  });
  loadFolders().catch((e) => showErr(e.message));
}

boot();
