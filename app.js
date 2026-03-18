/** @typedef {{ id: string, title: string, content: string, createdAt: number, rating: number, metadata?: MetadataObject }} Prompt */
/** @typedef {{ id: string, content: string, createdAt: number, lastEdited: number }} Note */
/** @typedef {{ min: number, max: number, confidence: 'high' | 'medium' | 'low' }} TokenEstimate */
/** @typedef {{ model: string, createdAt: string, updatedAt: string, tokenEstimate: TokenEstimate }} MetadataObject */

// Undo state for recently deleted notes
let undoState = { noteId: null, promptId: null, note: null, timeoutId: null };

// In-memory state (synced with the database)
let state = { prompts: [], notes: {}, user: null, editingId: null };

const els = {
  form: document.getElementById("promptForm"),
  title: document.getElementById("promptTitle"),
  content: document.getElementById("promptContent"),
  modelName: document.getElementById("promptModel"),
  cards: document.getElementById("cards"),
  countText: document.getElementById("countText"),
};

function safeTrim(value) {
  return String(value ?? "").trim();
}

// ============================================================================
// API HELPER
// ============================================================================

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  return res.json();
}

// ============================================================================
// METADATA TRACKING SYSTEM
// ============================================================================

/**
 * Estimates token count for given text
 * @param {string} text - The text to estimate tokens for
 * @param {boolean} isCode - Whether the text is code
 * @returns {TokenEstimate} Token estimate with min, max, and confidence
 */
function estimateTokens(text, isCode = false) {
  if (typeof text !== 'string') {
    throw new Error('Text must be a string');
  }

  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  // Base calculation
  let minTokens = Math.round(0.75 * wordCount);
  let maxTokens = Math.round(0.25 * charCount);

  // Apply code multiplier
  if (isCode) {
    minTokens = Math.round(minTokens * 1.3);
    maxTokens = Math.round(maxTokens * 1.3);
  }

  // Determine confidence based on average token count
  const avgTokens = (minTokens + maxTokens) / 2;
  let confidence = 'high';
  if (avgTokens > 5000) {
    confidence = 'low';
  } else if (avgTokens >= 1000) {
    confidence = 'medium';
  }

  return {
    min: minTokens,
    max: maxTokens,
    confidence
  };
}

/**
 * Validates ISO 8601 date string
 * @param {string} dateString - The date string to validate
 * @returns {boolean} Whether the date string is valid
 */
function isValidISO8601(dateString) {
  if (typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && dateString === date.toISOString();
}

/**
 * Creates metadata object for a prompt
 * @param {string} modelName - Name of the model
 * @param {string} content - Content to estimate tokens from
 * @returns {MetadataObject} Metadata object with timestamps and token estimate
 */
function trackModel(modelName, content) {
  // Validate model name
  if (typeof modelName !== 'string' || modelName.trim().length === 0) {
    throw new Error('Model name must be a non-empty string');
  }

  if (modelName.length > 100) {
    throw new Error('Model name must not exceed 100 characters');
  }

  // Validate content
  if (typeof content !== 'string') {
    throw new Error('Content must be a string');
  }

  const now = new Date().toISOString();
  const tokenEstimate = estimateTokens(content, false);

  return {
    model: modelName.trim(),
    createdAt: now,
    updatedAt: now,
    tokenEstimate
  };
}

/**
 * Updates the updatedAt timestamp in metadata
 * @param {MetadataObject} metadata - Metadata object to update
 * @returns {MetadataObject} Updated metadata object
 */
function updateTimestamps(metadata) {
  // Validate metadata object
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Metadata must be an object');
  }

  if (!metadata.createdAt || !isValidISO8601(metadata.createdAt)) {
    throw new Error('Metadata must have a valid createdAt ISO 8601 timestamp');
  }

  const now = new Date().toISOString();
  const createdDate = new Date(metadata.createdAt);
  const updatedDate = new Date(now);

  // Validate updatedAt >= createdAt
  if (updatedDate < createdDate) {
    throw new Error('updatedAt must be greater than or equal to createdAt');
  }

  return {
    ...metadata,
    updatedAt: now
  };
}

// ============================================================================
// STATE ACCESSORS (sync reads from in-memory state)
// ============================================================================

function getPrompts() {
  return state.prompts;
}

function getAllNotes() {
  return state.notes;
}

function getNotesForPrompt(promptId) {
  return state.notes[promptId] || [];
}

// ============================================================================
// ASYNC MUTATIONS (update DB + in-memory state)
// ============================================================================

async function addPrompt(title, content, modelName) {
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

  if (modelName && modelName.trim().length > 0) {
    try {
      prompt.metadata = trackModel(modelName, content);
    } catch (error) {
      console.error('Error creating metadata:', error);
    }
  }

  await api('/api/prompts', 'POST', prompt);
  state.prompts.push(prompt);
}

async function deletePrompt(id) {
  await api(`/api/prompts/${id}`, 'DELETE');
  state.prompts = state.prompts.filter((p) => p.id !== id);
  delete state.notes[id];
}

async function updatePromptRating(promptId, rating) {
  const clamped = Math.max(0, Math.min(5, rating));
  await api(`/api/prompts/${promptId}/rating`, 'PATCH', { rating: clamped });
  const prompt = state.prompts.find((p) => p.id === promptId);
  if (prompt) prompt.rating = clamped;
}

async function addNote(promptId, content) {
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    content: safeTrim(content),
    createdAt: Date.now(),
    lastEdited: Date.now(),
  };

  await api('/api/notes', 'POST', { ...note, promptId });
  if (!state.notes[promptId]) state.notes[promptId] = [];
  state.notes[promptId].push(note);
  return note;
}

async function updateNote(promptId, noteId, content) {
  const lastEdited = Date.now();
  const trimmed = safeTrim(content);
  await api(`/api/notes/${noteId}`, 'PATCH', { content: trimmed, lastEdited });
  const notes = state.notes[promptId];
  if (notes) {
    const note = notes.find((n) => n.id === noteId);
    if (note) {
      note.content = trimmed;
      note.lastEdited = lastEdited;
    }
  }
}

async function deleteNote(promptId, noteId) {
  const notes = state.notes[promptId];
  if (!notes) return null;
  const index = notes.findIndex((n) => n.id === noteId);
  if (index === -1) return null;
  const deletedNote = notes[index];
  await api(`/api/notes/${noteId}`, 'DELETE');
  notes.splice(index, 1);
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

// ============================================================================
// RENDER
// ============================================================================

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
      if (state.editingId === p.id) return renderEditCard(p);

      const title = escapeHtml(p.title);
      const preview = escapeHtml(wordsPreview(p.content));
      const rating = p.rating || 0;
      const ratingText = rating > 0 ? `${rating}.0/5.0` : "Unrated";
      const metadataHtml = renderMetadata(p.metadata);
      return `
        <article class="card" data-id="${escapeHtml(p.id)}">
          <div class="card-top">
            <h3 class="card-title">${title}</h3>
            <div class="card-actions">
              <button class="icon-btn" type="button" data-action="edit" aria-label="Edit prompt">
                Edit
              </button>
              <button class="icon-btn icon-btn-danger" type="button" data-action="delete" aria-label="Delete prompt">
                Delete
              </button>
            </div>
          </div>
          <p class="preview">${preview}</p>
          ${metadataHtml}
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

function renderEditCard(p) {
  const modelValue = escapeHtml(p.metadata?.model || '');
  return `
    <article class="card card-editing" data-id="${escapeHtml(p.id)}">
      <div class="field">
        <label>Title</label>
        <input class="edit-field" data-field="title" value="${escapeHtml(p.title)}" maxlength="200" />
      </div>
      <div class="field">
        <label>Prompt</label>
        <textarea class="edit-field edit-content" data-field="content">${escapeHtml(p.content)}</textarea>
      </div>
      <div class="field">
        <label>Model (optional)</label>
        <input class="edit-field" data-field="model" value="${modelValue}" maxlength="100" />
      </div>
      <div class="edit-actions">
        <button class="btn btn-primary btn-edit-save" type="button" data-action="save-edit">Save</button>
        <button class="btn-edit-cancel" type="button" data-action="cancel-edit">Cancel</button>
      </div>
    </article>
  `;
}

async function saveEditedPrompt(id) {
  const card = els.cards.querySelector(`[data-id="${id}"]`);
  if (!card) return;

  const title = safeTrim(card.querySelector('[data-field="title"]').value);
  const content = safeTrim(card.querySelector('[data-field="content"]').value);
  const modelName = safeTrim(card.querySelector('[data-field="model"]').value);

  if (!title || !content) {
    showNotification('Title and prompt are required', 'error');
    return;
  }

  const prompt = state.prompts.find(p => p.id === id);
  if (!prompt) return;

  let metadata = null;
  if (modelName) {
    if (prompt.metadata) {
      metadata = {
        ...prompt.metadata,
        model: modelName,
        updatedAt: new Date().toISOString(),
        tokenEstimate: estimateTokens(content, false),
      };
    } else {
      metadata = trackModel(modelName, content);
    }
  }

  try {
    await api(`/api/prompts/${id}`, 'PATCH', { title, content, metadata });
    prompt.title = title;
    prompt.content = content;
    prompt.metadata = metadata || undefined;
    state.editingId = null;
    render();
  } catch (error) {
    console.error('Failed to save prompt:', error);
    showNotification('Failed to save changes', 'error');
  }
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

/**
 * Formats ISO 8601 timestamp to human-readable format
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Formatted date string
 */
function formatISOTimestamp(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  } catch (error) {
    return 'Invalid date';
  }
}

/**
 * Renders metadata section for a prompt card
 * @param {MetadataObject} metadata - Metadata object
 * @returns {string} HTML string for metadata display
 */
function renderMetadata(metadata) {
  if (!metadata) return '';

  const { model, createdAt, updatedAt, tokenEstimate } = metadata;
  const { min, max, confidence } = tokenEstimate;

  // Determine confidence color class
  const confidenceClass = {
    'high': 'confidence-high',
    'medium': 'confidence-medium',
    'low': 'confidence-low'
  }[confidence] || 'confidence-medium';

  const createdFormatted = formatISOTimestamp(createdAt);
  const updatedFormatted = formatISOTimestamp(updatedAt);
  const isUpdated = createdAt !== updatedAt;

  return `
    <div class="metadata-section">
      <div class="metadata-row">
        <span class="metadata-label">Model:</span>
        <span class="metadata-value">${escapeHtml(model)}</span>
      </div>
      <div class="metadata-row">
        <span class="metadata-label">Created:</span>
        <span class="metadata-value">${createdFormatted}</span>
      </div>
      ${isUpdated ? `
        <div class="metadata-row">
          <span class="metadata-label">Updated:</span>
          <span class="metadata-value">${updatedFormatted}</span>
        </div>
      ` : ''}
      <div class="metadata-row">
        <span class="metadata-label">Tokens:</span>
        <span class="metadata-value">
          ${min}–${max}
          <span class="confidence-badge ${confidenceClass}">${confidence}</span>
        </span>
      </div>
    </div>
  `;
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

// ============================================================================
// EVENT HANDLERS
// ============================================================================

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = safeTrim(els.title.value);
  const content = safeTrim(els.content.value);
  const modelName = safeTrim(els.modelName.value);
  if (!title || !content) return;

  try {
    await addPrompt(title, content, modelName);
    els.form.reset();
    els.title.focus();
    render();
  } catch (error) {
    console.error('Failed to save prompt:', error);
    showNotification('Failed to save prompt', 'error');
  }
});

els.cards.addEventListener("click", async (e) => {
  // Handle star rating clicks
  const starBtn = e.target.closest("button.star-btn");
  if (starBtn) {
    const promptId = starBtn.getAttribute("data-prompt-id");
    const starValue = parseInt(starBtn.getAttribute("data-star"), 10);
    if (promptId && !isNaN(starValue)) {
      try {
        await updatePromptRating(promptId, starValue);
        render();
      } catch (error) {
        console.error('Failed to update rating:', error);
        showNotification('Failed to update rating', 'error');
      }
    }
    return;
  }

  // Handle action buttons
  const btn = e.target.closest("button[data-action]");
  if (btn) {
    const action = btn.getAttribute("data-action");

    // Handle edit prompt
    if (action === "edit") {
      const card = btn.closest("[data-id]");
      const id = card?.getAttribute("data-id");
      if (!id) return;
      state.editingId = id;
      render();
      // Focus title field
      setTimeout(() => {
        els.cards.querySelector(`[data-id="${id}"] .edit-field`)?.focus();
      }, 0);
      return;
    }

    // Handle save edit
    if (action === "save-edit") {
      const card = btn.closest("[data-id]");
      const id = card?.getAttribute("data-id");
      if (!id) return;
      await saveEditedPrompt(id);
      return;
    }

    // Handle cancel edit
    if (action === "cancel-edit") {
      state.editingId = null;
      render();
      return;
    }

    // Handle delete prompt
    if (action === "delete") {
      const card = btn.closest("[data-id]");
      const id = card?.getAttribute("data-id");
      if (!id) return;
      try {
        await deletePrompt(id);
        render();
      } catch (error) {
        console.error('Failed to delete prompt:', error);
        showNotification('Failed to delete prompt', 'error');
      }
      return;
    }

    // Handle toggle notes
    if (action === "toggle-notes") {
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
      try {
        await addNote(promptId, "");
        render();
        setTimeout(() => {
          const card = document.querySelector(`[data-id="${promptId}"]`);
          const textareas = card?.querySelectorAll(".note-textarea");
          if (textareas && textareas.length > 0) {
            textareas[textareas.length - 1].focus();
          }
        }, 50);
      } catch (error) {
        console.error('Failed to add note:', error);
        showNotification('Failed to add note', 'error');
      }
      return;
    }

    // Handle delete note
    if (action === "delete-note") {
      const promptId = btn.getAttribute("data-prompt-id");
      const noteId = btn.getAttribute("data-note-id");
      if (!promptId || !noteId) return;

      try {
        const deletedNote = await deleteNote(promptId, noteId);
        if (deletedNote) {
          showUndoNotification(promptId, noteId, deletedNote);
        }
        render();
      } catch (error) {
        console.error('Failed to delete note:', error);
        showNotification('Failed to delete note', 'error');
      }
      return;
    }
  }
});

// Save edit on Ctrl/Cmd+Enter inside edit card
els.cards.addEventListener("keydown", async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    const card = e.target.closest(".card-editing");
    if (card) {
      e.preventDefault();
      const id = card.getAttribute("data-id");
      if (id) await saveEditedPrompt(id);
    }
  }
  if (e.key === "Escape") {
    if (e.target.closest(".card-editing")) {
      state.editingId = null;
      render();
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
const debouncedSaveNote = debounce(async (promptId, noteId, content, savingIndicator) => {
  try {
    await updateNote(promptId, noteId, content);
  } catch (error) {
    console.error('Failed to save note:', error);
  }
  if (savingIndicator) {
    setTimeout(() => {
      savingIndicator.style.display = "none";
    }, 800);
  }
}, 500);

// ============================================================================
// UNDO NOTIFICATION
// ============================================================================

function showUndoNotification(promptId, noteId, deletedNote) {
  if (undoState.timeoutId) {
    clearTimeout(undoState.timeoutId);
    removeUndoNotification();
  }

  undoState = {
    promptId,
    noteId,
    note: deletedNote,
    timeoutId: null
  };

  const notification = document.createElement("div");
  notification.className = "undo-notification";
  notification.id = "undoNotification";
  notification.innerHTML = `
    <span>Note deleted</span>
    <button class="undo-btn" type="button">Undo</button>
  `;

  notification.querySelector(".undo-btn").addEventListener("click", async () => {
    if (undoState.note) {
      try {
        await api('/api/notes', 'POST', { ...undoState.note, promptId: undoState.promptId });
        if (!state.notes[undoState.promptId]) state.notes[undoState.promptId] = [];
        state.notes[undoState.promptId].push(undoState.note);
        render();
      } catch (error) {
        console.error('Failed to restore note:', error);
        showNotification('Failed to restore note', 'error');
      }
    }
    removeUndoNotification();
    if (undoState.timeoutId) clearTimeout(undoState.timeoutId);
    undoState = { noteId: null, promptId: null, note: null, timeoutId: null };
  });

  document.body.appendChild(notification);

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

// ============================================================================
// EXPORT/IMPORT SYSTEM
// ============================================================================

const EXPORT_VERSION = "1.0.0";

/**
 * Calculates statistics for the exported data
 * @param {Prompt[]} prompts - Array of prompts
 * @returns {Object} Statistics object
 */
function calculateExportStatistics(prompts) {
  const totalPrompts = prompts.length;

  const ratedPrompts = prompts.filter(p => p.rating > 0);
  const averageRating = ratedPrompts.length > 0
    ? ratedPrompts.reduce((sum, p) => sum + p.rating, 0) / ratedPrompts.length
    : 0;

  const modelCounts = {};
  prompts.forEach(p => {
    if (p.metadata?.model) {
      modelCounts[p.metadata.model] = (modelCounts[p.metadata.model] || 0) + 1;
    }
  });

  const mostUsedModel = Object.entries(modelCounts).length > 0
    ? Object.entries(modelCounts).reduce((a, b) => a[1] > b[1] ? a : b)[0]
    : null;

  let totalMinTokens = 0;
  let totalMaxTokens = 0;
  prompts.forEach(p => {
    if (p.metadata?.tokenEstimate) {
      totalMinTokens += p.metadata.tokenEstimate.min;
      totalMaxTokens += p.metadata.tokenEstimate.max;
    }
  });

  return {
    totalPrompts,
    averageRating: Math.round(averageRating * 10) / 10,
    mostUsedModel,
    totalMinTokens,
    totalMaxTokens,
    ratedPromptsCount: ratedPrompts.length
  };
}

/**
 * Validates data integrity before export
 * @param {Prompt[]} prompts - Array of prompts
 * @param {Object} notes - Notes object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateExportData(prompts, notes) {
  const errors = [];

  if (!Array.isArray(prompts)) {
    errors.push('Prompts data is not an array');
    return { valid: false, errors };
  }

  prompts.forEach((prompt, index) => {
    if (!prompt.id) errors.push(`Prompt at index ${index} is missing an ID`);
    if (!prompt.title) errors.push(`Prompt at index ${index} is missing a title`);
    if (!prompt.content) errors.push(`Prompt at index ${index} is missing content`);
    if (typeof prompt.createdAt !== 'number') errors.push(`Prompt at index ${index} has invalid createdAt timestamp`);
  });

  if (typeof notes !== 'object' || notes === null) {
    errors.push('Notes data is not a valid object');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Exports all library data to a JSON file
 */
function exportLibrary() {
  try {
    const prompts = getPrompts();
    const notes = getAllNotes();

    const validation = validateExportData(prompts, notes);
    if (!validation.valid) {
      console.error('Export validation failed:', validation.errors);
      showNotification('Export failed: Data validation errors', 'error');
      return;
    }

    const statistics = calculateExportStatistics(prompts);

    const exportData = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      statistics,
      data: { prompts, notes }
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `prompt-library-export-${timestamp}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showNotification(`Successfully exported ${statistics.totalPrompts} prompts`, 'success');
  } catch (error) {
    console.error('Export error:', error);
    showNotification('Export failed: ' + error.message, 'error');
  }
}

/**
 * Validates imported JSON structure and version
 * @param {Object} data - Parsed JSON data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateImportData(data) {
  const errors = [];
  const warnings = [];

  if (!data.version) {
    errors.push('Missing version number');
  } else if (data.version !== EXPORT_VERSION) {
    warnings.push(`Version mismatch: file is ${data.version}, current is ${EXPORT_VERSION}`);
  }

  if (!data.exportedAt) warnings.push('Missing export timestamp');

  if (!data.data) {
    errors.push('Missing data section');
    return { valid: false, errors, warnings };
  }

  if (!Array.isArray(data.data.prompts)) {
    errors.push('Prompts data is not an array');
  } else {
    data.data.prompts.forEach((prompt, index) => {
      if (!prompt.id) errors.push(`Prompt at index ${index} is missing an ID`);
      if (!prompt.title) errors.push(`Prompt at index ${index} is missing a title`);
      if (!prompt.content) errors.push(`Prompt at index ${index} is missing content`);
    });
  }

  if (typeof data.data.notes !== 'object' || data.data.notes === null) {
    errors.push('Notes data is not a valid object');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Checks for duplicate IDs between existing and imported data
 * @param {Prompt[]} existingPrompts - Current prompts
 * @param {Prompt[]} importedPrompts - Imported prompts
 * @returns {{ duplicates: string[], uniqueImports: Prompt[] }}
 */
function checkDuplicates(existingPrompts, importedPrompts) {
  const existingIds = new Set(existingPrompts.map(p => p.id));
  const duplicates = [];
  const uniqueImports = [];

  importedPrompts.forEach(prompt => {
    if (existingIds.has(prompt.id)) {
      duplicates.push(prompt.id);
    } else {
      uniqueImports.push(prompt);
    }
  });

  return { duplicates, uniqueImports };
}

function createBackup() {
  return {
    prompts: [...state.prompts],
    notes: JSON.parse(JSON.stringify(state.notes)),
    timestamp: Date.now()
  };
}

function restoreFromBackup(backup) {
  if (!backup) return;
  state.prompts = backup.prompts;
  state.notes = backup.notes;
}

/**
 * Import library data with merge/replace option
 * @param {Object} importData - Parsed import data
 * @param {string} strategy - 'merge', 'replace', or 'skip'
 */
async function performImport(importData, strategy) {
  const backup = createBackup();

  try {
    const importedPrompts = importData.data.prompts;
    const importedNotes = importData.data.notes;

    if (strategy === 'replace') {
      await api('/api/prompts', 'DELETE');
      state.prompts = [];
      state.notes = {};

      for (const prompt of importedPrompts) {
        await api('/api/prompts', 'POST', prompt);
        state.prompts.push(prompt);
      }
      for (const [promptId, notes] of Object.entries(importedNotes)) {
        state.notes[promptId] = notes;
        for (const note of notes) {
          await api('/api/notes', 'POST', { ...note, promptId });
        }
      }
      showNotification(`Successfully imported ${importedPrompts.length} prompts (replaced existing)`, 'success');
    } else if (strategy === 'merge') {
      const existingPrompts = getPrompts();
      const { duplicates, uniqueImports } = checkDuplicates(existingPrompts, importedPrompts);

      for (const prompt of uniqueImports) {
        await api('/api/prompts', 'POST', prompt);
        state.prompts.push(prompt);
        if (importedNotes[prompt.id]) {
          state.notes[prompt.id] = importedNotes[prompt.id];
          for (const note of importedNotes[prompt.id]) {
            await api('/api/notes', 'POST', { ...note, promptId: prompt.id });
          }
        }
      }

      const message = duplicates.length > 0
        ? `Imported ${uniqueImports.length} new prompts (${duplicates.length} duplicates skipped)`
        : `Successfully imported ${uniqueImports.length} prompts`;
      showNotification(message, 'success');
    } else if (strategy === 'skip') {
      showNotification('Import cancelled', 'info');
      return;
    }

    render();
  } catch (error) {
    console.error('Import error:', error);
    restoreFromBackup(backup);
    showNotification('Import failed: ' + error.message + ' (data restored)', 'error');
    render();
  }
}

/**
 * Handles file selection and initiates import
 */
function importLibrary() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      const validation = validateImportData(importData);

      if (!validation.valid) {
        showNotification('Import failed: Invalid file format\n' + validation.errors.join('\n'), 'error');
        return;
      }

      if (validation.warnings.length > 0) {
        console.warn('Import warnings:', validation.warnings);
      }

      const existingPrompts = getPrompts();
      const { duplicates } = checkDuplicates(existingPrompts, importData.data.prompts);

      if (existingPrompts.length === 0) {
        await performImport(importData, 'replace');
      } else if (duplicates.length > 0) {
        showMergeDialog(importData, duplicates.length);
      } else {
        showImportDialog(importData);
      }
    } catch (error) {
      console.error('Import file read error:', error);
      if (error instanceof SyntaxError) {
        showNotification('Import failed: Invalid JSON file', 'error');
      } else {
        showNotification('Import failed: ' + error.message, 'error');
      }
    }
  });

  input.click();
}

/**
 * Shows import strategy dialog (no duplicates)
 * @param {Object} importData - Import data
 */
function showImportDialog(importData) {
  const existingCount = getPrompts().length;
  const importCount = importData.data.prompts.length;

  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content">
      <h3 class="modal-title">Import Prompts</h3>
      <p class="modal-text">
        You have ${existingCount} existing prompts.<br>
        The file contains ${importCount} prompts.
      </p>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-secondary" data-action="merge">
          Merge (Add ${importCount} new)
        </button>
        <button class="modal-btn modal-btn-danger" data-action="replace">
          Replace All
        </button>
        <button class="modal-btn modal-btn-ghost" data-action="cancel">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    dialog.remove();

    if (action === 'merge') {
      await performImport(importData, 'merge');
    } else if (action === 'replace') {
      await performImport(importData, 'replace');
    }
  });
}

/**
 * Shows merge conflict resolution dialog
 * @param {Object} importData - Import data
 * @param {number} duplicateCount - Number of duplicates
 */
function showMergeDialog(importData, duplicateCount) {
  const existingCount = getPrompts().length;
  const importCount = importData.data.prompts.length;
  const uniqueCount = importCount - duplicateCount;

  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content">
      <h3 class="modal-title">⚠️ Duplicate Prompts Found</h3>
      <p class="modal-text">
        <strong>${duplicateCount}</strong> duplicate prompt${duplicateCount > 1 ? 's' : ''} detected.<br>
        <strong>${uniqueCount}</strong> unique prompt${uniqueCount > 1 ? 's' : ''} can be imported.
      </p>
      <div class="modal-info">
        <div class="modal-info-row">
          <span>Current library:</span>
          <strong>${existingCount} prompts</strong>
        </div>
        <div class="modal-info-row">
          <span>Import file:</span>
          <strong>${importCount} prompts</strong>
        </div>
      </div>
      <p class="modal-text-small">
        How would you like to proceed?
      </p>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-primary" data-action="merge">
          Add ${uniqueCount} New (Skip Duplicates)
        </button>
        <button class="modal-btn modal-btn-danger" data-action="replace">
          Replace All Data
        </button>
        <button class="modal-btn modal-btn-ghost" data-action="cancel">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    dialog.remove();

    if (action === 'merge') {
      await performImport(importData, 'merge');
    } else if (action === 'replace') {
      await performImport(importData, 'replace');
    }
  });
}

/**
 * Shows notification message
 * @param {string} message - Message to display
 * @param {string} type - 'success', 'error', 'info'
 */
function showNotification(message, type = 'info') {
  const existing = document.getElementById('exportNotification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.id = 'exportNotification';
  notification.className = `export-notification export-notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => { notification.remove(); }, 5000);
}

// Add event listeners for export/import buttons
document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');

  if (exportBtn) exportBtn.addEventListener('click', exportLibrary);
  if (importBtn) importBtn.addEventListener('click', importLibrary);
});

// ============================================================================
// AUTH
// ============================================================================

const authPanel = document.getElementById('authPanel');
const appMain = document.getElementById('appMain');
const userBar = document.getElementById('userBar');
const userEmailEl = document.getElementById('userEmail');

function showApp(user) {
  state.user = user;
  authPanel.style.display = 'none';
  appMain.style.display = '';
  userBar.style.display = 'flex';
  userEmailEl.textContent = user.email;
}

function showAuth() {
  state.user = null;
  state.prompts = [];
  state.notes = {};
  authPanel.style.display = '';
  appMain.style.display = 'none';
  userBar.style.display = 'none';
}

// Auth tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-tab');
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('loginForm').style.display = target === 'login' ? '' : 'none';
    document.getElementById('signupForm').style.display = target === 'signup' ? '' : 'none';
    document.getElementById('loginError').textContent = '';
    document.getElementById('signupError').textContent = '';
  });
});

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  try {
    const user = await api('/api/auth/login', 'POST', { email, password });
    const [prompts, notes] = await Promise.all([api('/api/prompts'), api('/api/notes')]);
    state.prompts = prompts;
    state.notes = notes;
    showApp(user);
    render();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Signup
document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const errorEl = document.getElementById('signupError');
  errorEl.textContent = '';

  try {
    const user = await api('/api/auth/signup', 'POST', { email, password });
    state.prompts = [];
    state.notes = {};
    showApp(user);
    render();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', 'POST');
  showAuth();
});

// ============================================================================
// INIT — check session, then load data or show auth
// ============================================================================

async function init() {
  try {
    const user = await api('/api/auth/me');
    const [prompts, notes] = await Promise.all([api('/api/prompts'), api('/api/notes')]);
    state.prompts = prompts;
    state.notes = notes;
    showApp(user);
  } catch {
    showAuth();
  }
  render();
}

init();
