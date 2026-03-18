## Practical Prompt Engineering Course
This is a companion repository for the [Practical Prompt Engineering](https://frontendmasters.com/courses/prompt-engineering/) course on Frontend Masters.
[![Frontend Masters](https://static.frontendmasters.com/assets/brand/logos/full.png)](https://frontendmasters.com/courses/prompt-engineering/)

### About this Repo

This repo contains a minimal **Prompt Library** application built with **HTML, CSS, and JavaScript**. It lets you save prompts locally (via `localStorage`), view them as cards, and delete them.

### Features

- **Create prompts**: Title + prompt content + optional model name
- **Save to localStorage**: Prompts persist across page refreshes
- **Prompt cards**: Title + short content preview + delete button
- **Delete prompts**: Removes from `localStorage` and updates the UI
- **Star ratings**: Rate prompts 1-5 stars
- **Notes system**: Add, edit, and delete notes attached to prompts
- **📊 Metadata tracking**: Automatic model tracking, timestamps, and token estimation
  - Track AI model names (GPT-4, Claude, etc.)
  - Auto-generated ISO 8601 timestamps
  - Smart token estimation with confidence levels
  - Color-coded visual feedback (green/yellow/red)

### Files

- **`index.html`**: App structure (form + saved prompt list)
- **`styles.css`**: Modern "developer theme" styling
- **`app.js`**: Save/render/delete logic backed by `localStorage`
- **`METADATA-SYSTEM.md`**: Complete documentation for the metadata tracking system
- **`IMPLEMENTATION-SUMMARY.md`**: Implementation overview and test results

### Run it

Open `index.html` in your browser (no install/build steps required).

Or use a local server:
```bash
python3 -m http.server 8080
# Then visit http://localhost:8080
```

### Metadata Tracking System

The app includes a comprehensive metadata tracking system for prompts:

#### Core Functions

1. **`estimateTokens(text, isCode)`** - Estimates token count with confidence levels
2. **`trackModel(modelName, content)`** - Creates metadata with timestamps and token estimates
3. **`updateTimestamps(metadata)`** - Updates modification timestamps

#### Features

- 🎯 **Automatic token estimation** - Get instant min/max token estimates
- 🏷️ **Model tracking** - Record which AI model you're using
- ⏰ **Timestamp management** - ISO 8601 timestamps with human-readable display
- 🎨 **Visual feedback** - Color-coded confidence badges:
  - 🟢 Green (High) - Highly accurate for prompts <1000 tokens
  - 🟡 Yellow (Medium) - Moderate accuracy for 1000-5000 tokens
  - 🔴 Red (Low) - Less accurate for >5000 tokens
- ✅ **Full validation** - Comprehensive error handling and input validation
- 🔄 **Backward compatible** - Existing prompts work without metadata

See `METADATA-SYSTEM.md` for detailed documentation.