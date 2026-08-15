const PERSONAS = [
  { orgId: "acme", userId: "joe", label: "Joe / Acme" },
  { orgId: "acme", userId: "jane", label: "Jane / Acme" },
  { orgId: "empressa", userId: "nick", label: "Nick / Empressa" },
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

async function loadFolders() {
  const { orgId } = persona();
  const data = await api("/api/smart-files/folders", {
    query: { scopeType: "tenant", scopeId: orgId },
  });
  const ul = $("folders");
  ul.innerHTML = "";
  if (!data.folders?.length) {
    ul.innerHTML = "<li class='meta'>No rooms in this org yet.</li>";
    return;
  }
  for (const f of data.folders) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "ghost";
    b.type = "button";
    b.textContent = f.label;
    b.addEventListener("click", () => openFolder(f));
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${f.folderId} · ${f.createdBy || "unknown"}`;
    li.append(b, meta);
    ul.append(li);
  }
}

async function openFolder(folder) {
  selectedFolder = folder;
  $("room-title").textContent = folder.label;
  $("share").hidden = false;
  $("upload").hidden = false;
  $("share-out").hidden = true;
  const data = await api(`/api/smart-files/folders/${encodeURIComponent(folder.folderId)}/files`);
  renderFiles($("files"), data.files || []);
}

function renderFiles(ul, files) {
  ul.innerHTML = "";
  if (!files.length) {
    ul.innerHTML = "<li class='meta'>No files in this room.</li>";
    return;
  }
  for (const f of files) {
    const li = document.createElement("li");
    li.innerHTML = `<div>${f.title}</div><div class="meta">${f.entityId} · ${f.accessPolicy}</div>`;
    ul.append(li);
  }
}

async function loadShare(token) {
  $("app").hidden = true;
  document.querySelector("header").hidden = true;
  $("share-view").hidden = false;
  const data = await api(`/api/smart-files/share/${encodeURIComponent(token)}`);
  $("share-title").textContent = data.folder?.label || "Shared room";
  renderFiles($("share-files"), data.files || []);
}

function boot() {
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
    $("room-title").textContent = "Select a room";
    $("share").hidden = true;
    $("upload").hidden = true;
    $("files").innerHTML = "";
    loadFolders().catch((e) => showErr(e.message));
  });
  $("refresh").addEventListener("click", () => loadFolders().catch((e) => showErr(e.message)));
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
  $("share").addEventListener("click", async () => {
    if (!selectedFolder) return;
    showErr("");
    const data = await api(
      `/api/smart-files/folders/${encodeURIComponent(selectedFolder.folderId)}/share`,
      { method: "POST", body: persona() },
    );
    const url = `${location.origin}/#share=${data.token}`;
    $("share-out").hidden = false;
    $("share-out").textContent = url;
    try {
      await navigator.clipboard.writeText(url);
      $("share-out").textContent = `${url} (copied)`;
    } catch {
      /* clipboard may be blocked */
    }
  });
  loadFolders().catch((e) => showErr(e.message));
}

boot();
