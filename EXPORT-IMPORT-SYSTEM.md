# Export/Import System Documentation

## Overview

The export/import system provides a complete solution for backing up, sharing, and migrating your prompt library data. The system includes data validation, duplicate detection, merge conflict resolution, and error recovery with automatic rollback.

## Features

### 1. Export Functionality

**What Gets Exported:**
- All prompts with complete metadata (title, content, ratings, models, timestamps, token estimates)
- All notes associated with prompts
- Export statistics and metadata
- Version information for future compatibility

**Export JSON Schema:**
```json
{
  "version": "1.0.0",
  "exportedAt": "2025-12-12T10:30:00.000Z",
  "statistics": {
    "totalPrompts": 25,
    "averageRating": 4.2,
    "mostUsedModel": "GPT-4",
    "totalMinTokens": 5000,
    "totalMaxTokens": 7500,
    "ratedPromptsCount": 18
  },
  "data": {
    "prompts": [...],
    "notes": {...}
  }
}
```

**File Naming:**
- Files are automatically named with timestamp: `prompt-library-export-2025-12-12T10-30-00.json`
- This prevents accidental overwrites and helps track backup versions

### 2. Import Functionality

**Import Process:**
1. File validation (JSON structure, version compatibility)
2. Data integrity checks (required fields, data types)
3. Duplicate detection (compares prompt IDs)
4. User choice for merge strategy
5. Backup creation before import
6. Import execution with automatic rollback on failure

**Validation Checks:**
- JSON structure validation
- Version compatibility check
- Required fields validation (id, title, content)
- Data type validation
- Timestamp integrity

### 3. Merge Conflict Resolution

When duplicates are detected, users are presented with clear options:

**Merge Strategy Options:**
1. **Add New (Skip Duplicates)** - Imports only unique prompts, preserves existing data
2. **Replace All Data** - Completely replaces library with imported data
3. **Cancel** - Aborts the import operation

**Merge Dialog Features:**
- Shows count of duplicate prompts
- Shows count of unique prompts that can be imported
- Displays current library size vs import file size
- Clear action buttons with color-coded importance

### 4. Error Recovery

**Backup System:**
- Automatic backup created before every import
- Backup includes all prompts and notes
- Timestamped for reference

**Rollback on Failure:**
- Any error during import triggers automatic rollback
- Data is restored to pre-import state
- User is notified of failure and restoration

**Error Messages:**
- Detailed error messages for validation failures
- Specific information about what went wrong
- Recovery status notifications

## User Interface

### Export/Import Buttons

Located in the "Saved prompts" section header:
- **📤 Export** - Downloads current library as JSON file
- **📥 Import** - Opens file picker for JSON import

### Modal Dialogs

**Import Dialog (No Duplicates):**
- Simple choice between Merge or Replace
- Shows existing count and import count
- Clear action buttons

**Merge Conflict Dialog (With Duplicates):**
- Warning indicator for duplicates
- Detailed statistics breakdown
- Information panel showing:
  - Current library size
  - Import file size
  - Duplicate count
  - Unique import count

### Notifications

**Success Notifications (Green):**
- Successful export with count
- Successful import with details
- Merge completion with statistics

**Error Notifications (Red):**
- Validation failures with details
- Import errors with recovery status
- File format errors

**Info Notifications (Blue):**
- Import cancelled
- Version warnings
- General information

## Technical Implementation

### Data Validation

**Export Validation:**
```javascript
validateExportData(prompts, notes)
```
- Validates array structure
- Checks required fields
- Validates data types
- Returns validation result with errors

**Import Validation:**
```javascript
validateImportData(data)
```
- Checks version compatibility
- Validates JSON structure
- Verifies required fields
- Returns errors and warnings separately

### Statistics Calculation

The system calculates comprehensive statistics:
- Total prompt count
- Average rating (excluding unrated)
- Most frequently used model
- Total token estimates (min/max ranges)
- Count of rated prompts

### Duplicate Detection

```javascript
checkDuplicates(existingPrompts, importedPrompts)
```
- Compares prompt IDs
- Returns list of duplicate IDs
- Returns list of unique imports
- Used for merge decision logic

### Backup and Rollback

**Backup Creation:**
```javascript
createBackup()
```
- Captures current state of prompts and notes
- Includes timestamp
- Stored in memory during import

**Rollback:**
```javascript
restoreFromBackup(backup)
```
- Restores prompts to localStorage
- Restores notes to localStorage
- Triggered automatically on error

## Usage Examples

### Basic Export
1. Click "📤 Export" button
2. File automatically downloads with timestamp
3. Success notification appears

### Import Without Conflicts
1. Click "📥 Import" button
2. Select JSON file
3. Choose "Merge" or "Replace All"
4. Import completes with success message

### Import With Conflicts
1. Click "📥 Import" button
2. Select JSON file with duplicates
3. Review conflict dialog showing:
   - 5 duplicates detected
   - 10 unique prompts can be imported
4. Choose:
   - "Add 10 New (Skip Duplicates)" - safe option
   - "Replace All Data" - complete replacement
   - "Cancel" - abort operation
5. Import proceeds based on choice

### Error Recovery Example
1. Attempt to import invalid file
2. Validation fails with error message
3. No changes made to library
4. User can correct issue and try again

## Best Practices

### For Users

1. **Regular Backups**
   - Export your library regularly
   - Keep exports in a safe location
   - Consider cloud storage for backups

2. **Before Major Changes**
   - Export before bulk deletions
   - Export before importing unknown files
   - Keep recent backup available

3. **Importing Data**
   - Review file contents if possible
   - Use "Merge" for adding to existing data
   - Use "Replace" only when starting fresh

4. **Managing Duplicates**
   - "Skip Duplicates" is the safer option
   - "Replace All" when you want clean import
   - Cancel if unsure about the file

### For Developers

1. **Version Compatibility**
   - Version number in schema allows future changes
   - Add migration logic for version updates
   - Maintain backward compatibility

2. **Data Validation**
   - Always validate on import
   - Check required fields
   - Validate data types and ranges

3. **Error Handling**
   - Always create backup before changes
   - Rollback on any failure
   - Provide detailed error messages

4. **User Experience**
   - Clear action labels
   - Visual feedback (notifications)
   - Confirmation for destructive actions

## Future Enhancements

Potential improvements for the system:

1. **Selective Import**
   - Choose specific prompts to import
   - Filter by model, rating, or date
   - Preview prompts before importing

2. **Auto-Backup**
   - Automatic periodic exports
   - Configurable backup schedule
   - Maximum backup retention

3. **Cloud Sync**
   - Sync across devices
   - Collaborative sharing
   - Version history

4. **Import Preview**
   - Show prompts before import
   - Side-by-side comparison
   - Individual prompt selection

5. **Merge Strategies**
   - Update existing prompts
   - Keep newer/older versions
   - Smart merge based on timestamps

6. **Export Filters**
   - Export by rating
   - Export by model
   - Export date range

## Error Messages Reference

### Validation Errors
- `"Missing version number"` - Export file has no version field
- `"Missing data section"` - Export file structure is invalid
- `"Prompts data is not an array"` - Prompts field is not an array
- `"Prompt at index X is missing an ID"` - Prompt without required ID
- `"Notes data is not a valid object"` - Notes structure is invalid

### Import Errors
- `"Import failed: Invalid file format"` - JSON structure is wrong
- `"Import failed: Invalid JSON file"` - File is not valid JSON
- `"Import failed: Data validation errors"` - Multiple validation issues

### Success Messages
- `"Successfully exported X prompts"` - Export completed
- `"Imported X new prompts (Y duplicates skipped)"` - Merge with duplicates
- `"Successfully imported X prompts"` - Import completed
- `"Import cancelled"` - User cancelled operation

## Troubleshooting

### Export Not Working
- Check browser's download settings
- Verify localStorage has data
- Check console for errors
- Try different browser

### Import Validation Failing
- Verify JSON is valid (use JSON validator)
- Check file was not corrupted
- Ensure file is from this application
- Check version compatibility

### Duplicates Not Detected
- Verify prompt IDs are identical
- Check if prompts were manually edited
- Confirm file structure is correct

### Rollback Not Working
- Check browser console for errors
- Verify localStorage is accessible
- Check browser storage limits
- Try refreshing the page

## Technical Details

### Storage Keys
- Prompts: `promptLibrary.prompts.v1`
- Notes: `promptLibrary.notes.v1`

### Export Version
- Current version: `1.0.0`
- Semantic versioning for compatibility

### File Format
- JSON with 2-space indentation
- UTF-8 encoding
- Application/json MIME type

### Browser Compatibility
- Modern browsers with localStorage support
- File API support required
- Blob and URL.createObjectURL support
- No server required (client-side only)

## Security Considerations

1. **Local Storage Only**
   - Data never leaves user's device
   - No server uploads
   - User controls all files

2. **File Validation**
   - All imports are validated
   - Malicious data is rejected
   - Type checking prevents injection

3. **Backup Before Import**
   - Protects against data loss
   - Automatic rollback on error
   - User maintains control

4. **No Personal Data Collection**
   - System doesn't track usage
   - No analytics or telemetry
   - Privacy-focused design
