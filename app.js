const STORAGE_KEY = "promptLibrary.prompts.v1";

/** @typedef {{ id: string, title: string, content: string, createdAt: number }} Prompt */

const els = {
  form: document.getElementById("promptForm"),
  title: document.getElementById("promptTitle"),
  content: document.getElementById("promptContent"),
  cards: document.getElementById("cards"),
  countText: document.getElementById("countText"),
};

function safeTrim(value) {
  return String(value ?? "").trim();
}

function getPrompts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function setPrompts(prompts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

function wordsPreview(text, maxWords = 18) {
  const words = safeTrim(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const preview = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? `${preview}…` : preview;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render() {
  const prompts = getPrompts();
  const count = prompts.length;
  els.countText.textContent = count === 1 ? "1 prompt" : `${count} prompts`;

  if (count === 0) {
    els.cards.innerHTML =
      '<div class="empty">No prompts yet. Save one above to get started.</div>';
    return;
  }

  // newest first
  const sorted = [...prompts].sort((a, b) => b.createdAt - a.createdAt);

  els.cards.innerHTML = sorted
    .map((p) => {
      const title = escapeHtml(p.title);
      const preview = escapeHtml(wordsPreview(p.content));
      return `
        <article class="card" data-id="${escapeHtml(p.id)}">
          <div class="card-top">
            <h3 class="card-title">${title}</h3>
            <div class="card-actions">
              <button class="icon-btn icon-btn-danger" type="button" data-action="delete" aria-label="Delete prompt">
                Delete
              </button>
            </div>
          </div>
          <p class="preview">${preview}</p>
        </article>
      `;
    })
    .join("");
}

function addPrompt(title, content) {
  /** @type {Prompt} */
  const prompt = {
    id:
      (globalThis.crypto && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`),
    title,
    content,
    createdAt: Date.now(),
  };

  const prompts = getPrompts();
  prompts.push(prompt);
  setPrompts(prompts);
}

function deletePrompt(id) {
  const prompts = getPrompts();
  const next = prompts.filter((p) => p.id !== id);
  setPrompts(next);
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = safeTrim(els.title.value);
  const content = safeTrim(els.content.value);
  if (!title || !content) return;

  addPrompt(title, content);
  els.form.reset();
  els.title.focus();
  render();
});

els.cards.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  if (action !== "delete") return;

  const card = btn.closest("[data-id]");
  const id = card?.getAttribute("data-id");
  if (!id) return;

  deletePrompt(id);
  render();
});

render();


