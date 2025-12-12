const STORAGE_KEY = "promptLibrary.prompts.v1";
const NOTES_STORAGE_KEY = "promptLibrary.notes.v1";

/** @typedef {{ id: string, title: string, content: string, createdAt: number, rating: number }} Prompt */
/** @typedef {{ id: string, content: string, createdAt: number, lastEdited: number }} Note */

// Undo state for recently deleted notes
let undoState = { noteId: null, promptId: null, note: null, timeoutId: null };

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

// Notes storage functions
function getAllNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function setAllNotes(notesData) {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notesData));
  } catch (e) {
    console.error("Failed to save notes:", e);
  }
}

function getNotesForPrompt(promptId) {
  const allNotes = getAllNotes();
  return allNotes[promptId] || [];
}

function addNote(promptId, content) {
  const allNotes = getAllNotes();
  if (!allNotes[promptId]) {
    allNotes[promptId] = [];
  }
  
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    content: safeTrim(content),
    createdAt: Date.now(),
    lastEdited: Date.now(),
  };
  
  allNotes[promptId].push(note);
  setAllNotes(allNotes);
  return note;
}

function updateNote(promptId, noteId, content) {
  const allNotes = getAllNotes();
  const notes = allNotes[promptId];
  if (!notes) return;
  
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.content = safeTrim(content);
  note.lastEdited = Date.now();
  setAllNotes(allNotes);
}

function deleteNote(promptId, noteId) {
  const allNotes = getAllNotes();
  const notes = allNotes[promptId];
  if (!notes) return null;
  
  const index = notes.findIndex(n => n.id === noteId);
  if (index === -1) return null;
  
  const deletedNote = notes[index];
  notes.splice(index, 1);
  setAllNotes(allNotes);
  return deletedNote;
}

// Debounce utility for auto-save
function debounce(fn, delay) {
  let timeoutId = null;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
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
      const rating = p.rating || 0;
      const ratingText = rating > 0 ? `${rating}.0/5.0` : "Unrated";
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
          <div class="card-bottom">
            ${renderStars(rating, p.id)}
            <span class="rating-text">${ratingText}</span>
          </div>
          ${renderNotes(p.id)}
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
    rating: 0,
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

function updatePromptRating(promptId, rating) {
  const prompts = getPrompts();
  const prompt = prompts.find((p) => p.id === promptId);
  if (!prompt) return;

  prompt.rating = Math.max(0, Math.min(5, rating));
  setPrompts(prompts);
}

function renderStars(rating, promptId) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating;
    stars.push(`
      <button 
        class="star-btn" 
        data-star="${i}" 
        data-prompt-id="${escapeHtml(promptId)}"
        aria-label="Rate ${i} star${i > 1 ? "s" : ""}"
        type="button"
      >
        ${filled ? "★" : "☆"}
      </button>
    `);
  }
  return `<div class="rating-stars">${stars.join("")}</div>`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function renderNotes(promptId) {
  const notes = getNotesForPrompt(promptId);
  const hasNotes = notes.length > 0;
  
  const notesHtml = notes.map(note => {
    const charCount = note.content.length;
    const timestamp = formatTimestamp(note.lastEdited);
    return `
      <div class="note-item" data-note-id="${escapeHtml(note.id)}">
        <textarea 
          class="note-textarea" 
          maxlength="500" 
          placeholder="Write your note here..."
          data-prompt-id="${escapeHtml(promptId)}"
          data-note-id="${escapeHtml(note.id)}"
        >${escapeHtml(note.content)}</textarea>
        <div class="note-footer">
          <span class="note-timestamp">Last edited: ${timestamp}</span>
          <span class="note-char-count ${charCount >= 475 ? 'char-limit-warning' : ''}">${charCount}/500</span>
          <button 
            class="note-delete-btn" 
            type="button"
            data-action="delete-note"
            data-prompt-id="${escapeHtml(promptId)}"
            data-note-id="${escapeHtml(note.id)}"
            aria-label="Delete note"
          >Delete</button>
        </div>
        <div class="note-saving-indicator" style="display: none;">Saving...</div>
      </div>
    `;
  }).join("");
  
  const emptyState = !hasNotes ? `
    <div class="notes-empty">No notes yet. Click 'Add Note' to get started.</div>
  ` : "";
  
  return `
    <div class="notes-section">
      <div class="notes-header">
        <button 
          class="notes-toggle-btn" 
          type="button"
          data-action="toggle-notes"
          data-prompt-id="${escapeHtml(promptId)}"
          aria-label="Toggle notes"
        >
          <span class="notes-toggle-icon">▼</span> Notes (${notes.length})
        </button>
        <button 
          class="btn-add-note" 
          type="button"
          data-action="add-note"
          data-prompt-id="${escapeHtml(promptId)}"
          aria-label="Add note"
        >+ Add Note</button>
      </div>
      <div class="notes-content" data-prompt-id="${escapeHtml(promptId)}">
        ${emptyState}
        ${notesHtml}
      </div>
    </div>
  `;
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
  // Handle star rating clicks
  const starBtn = e.target.closest("button.star-btn");
  if (starBtn) {
    const promptId = starBtn.getAttribute("data-prompt-id");
    const starValue = parseInt(starBtn.getAttribute("data-star"), 10);
    if (promptId && !isNaN(starValue)) {
      updatePromptRating(promptId, starValue);
      render();
    }
    return;
  }

  // Handle action buttons
  const btn = e.target.closest("button[data-action]");
  if (btn) {
    const action = btn.getAttribute("data-action");
    
    // Handle delete prompt
    if (action === "delete") {
      const card = btn.closest("[data-id]");
      const id = card?.getAttribute("data-id");
      if (!id) return;
      deletePrompt(id);
      render();
      return;
    }
    
    // Handle toggle notes
    if (action === "toggle-notes") {
      const promptId = btn.getAttribute("data-prompt-id");
      const notesSection = btn.closest(".notes-section");
      if (notesSection) {
        notesSection.classList.toggle("collapsed");
      }
      return;
    }
    
    // Handle add note
    if (action === "add-note") {
      const promptId = btn.getAttribute("data-prompt-id");
      if (!promptId) return;
      addNote(promptId, "");
      render();
      // Focus on the newly added textarea
      setTimeout(() => {
        const card = document.querySelector(`[data-id="${promptId}"]`);
        const textareas = card?.querySelectorAll(".note-textarea");
        if (textareas && textareas.length > 0) {
          textareas[textareas.length - 1].focus();
        }
      }, 50);
      return;
    }
    
    // Handle delete note
    if (action === "delete-note") {
      const promptId = btn.getAttribute("data-prompt-id");
      const noteId = btn.getAttribute("data-note-id");
      if (!promptId || !noteId) return;
      
      const deletedNote = deleteNote(promptId, noteId);
      if (deletedNote) {
        showUndoNotification(promptId, noteId, deletedNote);
      }
      render();
      return;
    }
  }
});

// Handle note textarea input with debounced auto-save
els.cards.addEventListener("input", (e) => {
  const textarea = e.target;
  if (!textarea.classList.contains("note-textarea")) return;
  
  const promptId = textarea.getAttribute("data-prompt-id");
  const noteId = textarea.getAttribute("data-note-id");
  const content = textarea.value;
  
  if (!promptId || !noteId) return;
  
  // Update character count
  const noteItem = textarea.closest(".note-item");
  const charCount = noteItem?.querySelector(".note-char-count");
  if (charCount) {
    const count = content.length;
    charCount.textContent = `${count}/500`;
    if (count >= 475) {
      charCount.classList.add("char-limit-warning");
    } else {
      charCount.classList.remove("char-limit-warning");
    }
  }
  
  // Show saving indicator
  const savingIndicator = noteItem?.querySelector(".note-saving-indicator");
  if (savingIndicator) {
    savingIndicator.style.display = "block";
  }
  
  // Debounced auto-save
  debouncedSaveNote(promptId, noteId, content, savingIndicator);
});

// Create debounced save function
const debouncedSaveNote = debounce((promptId, noteId, content, savingIndicator) => {
  updateNote(promptId, noteId, content);
  
  // Hide saving indicator after a short delay
  if (savingIndicator) {
    setTimeout(() => {
      savingIndicator.style.display = "none";
    }, 800);
  }
}, 500);

// Undo notification functions
function showUndoNotification(promptId, noteId, deletedNote) {
  // Clear existing undo timeout
  if (undoState.timeoutId) {
    clearTimeout(undoState.timeoutId);
    removeUndoNotification();
  }
  
  // Store undo state
  undoState = {
    promptId,
    noteId,
    note: deletedNote,
    timeoutId: null
  };
  
  // Create notification element
  const notification = document.createElement("div");
  notification.className = "undo-notification";
  notification.id = "undoNotification";
  notification.innerHTML = `
    <span>Note deleted</span>
    <button class="undo-btn" type="button">Undo</button>
  `;
  
  // Handle undo click
  notification.querySelector(".undo-btn").addEventListener("click", () => {
    if (undoState.note) {
      const allNotes = getAllNotes();
      if (!allNotes[undoState.promptId]) {
        allNotes[undoState.promptId] = [];
      }
      allNotes[undoState.promptId].push(undoState.note);
      setAllNotes(allNotes);
      render();
    }
    removeUndoNotification();
    if (undoState.timeoutId) {
      clearTimeout(undoState.timeoutId);
    }
    undoState = { noteId: null, promptId: null, note: null, timeoutId: null };
  });
  
  document.body.appendChild(notification);
  
  // Auto-remove after 10 seconds
  undoState.timeoutId = setTimeout(() => {
    removeUndoNotification();
    undoState = { noteId: null, promptId: null, note: null, timeoutId: null };
  }, 10000);
}

function removeUndoNotification() {
  const notification = document.getElementById("undoNotification");
  if (notification) {
    notification.remove();
  }
}

render();


