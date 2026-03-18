# Metadata Tracking System Documentation

## Overview

This metadata tracking system provides comprehensive tracking for prompts in the Prompt Library application. It automatically tracks model names, timestamps, and token estimates for each prompt.

## Core Functions

### 1. `estimateTokens(text, isCode)`

Estimates token count for given text content.

**Parameters:**
- `text` (string): The text to estimate tokens for
- `isCode` (boolean): Whether the text is code (applies 1.3x multiplier)

**Returns:** `TokenEstimate` object
```javascript
{
  min: number,        // Minimum estimated tokens (0.75 * word_count)
  max: number,        // Maximum estimated tokens (0.25 * char_count)
  confidence: string  // 'high' | 'medium' | 'low'
}
```

**Confidence Levels:**
- **High**: < 1000 average tokens
- **Medium**: 1000-5000 average tokens
- **Low**: > 5000 average tokens

**Example:**
```javascript
const estimate = estimateTokens('Hello world', false);
// { min: 2, max: 3, confidence: 'high' }

const codeEstimate = estimateTokens('function test() {}', true);
// Applies 1.3x multiplier for code
```

### 2. `trackModel(modelName, content)`

Creates a complete metadata object for a prompt with auto-generated timestamps.

**Parameters:**
- `modelName` (string): Name of the AI model (1-100 characters, non-empty)
- `content` (string): Prompt content for token estimation

**Returns:** `MetadataObject`
```javascript
{
  model: string,           // Model name (trimmed)
  createdAt: string,       // ISO 8601 timestamp
  updatedAt: string,       // ISO 8601 timestamp
  tokenEstimate: {
    min: number,
    max: number,
    confidence: 'high' | 'medium' | 'low'
  }
}
```

**Validation:**
- Throws error if model name is empty or > 100 characters
- Throws error if content is not a string

**Example:**
```javascript
const metadata = trackModel('GPT-4 Turbo', 'Your prompt content here');
// {
//   model: 'GPT-4 Turbo',
//   createdAt: '2025-12-12T20:00:00.000Z',
//   updatedAt: '2025-12-12T20:00:00.000Z',
//   tokenEstimate: { min: 23, max: 65, confidence: 'high' }
// }
```

### 3. `updateTimestamps(metadata)`

Updates the `updatedAt` timestamp while preserving `createdAt`.

**Parameters:**
- `metadata` (MetadataObject): Existing metadata object

**Returns:** Updated `MetadataObject` with new `updatedAt` timestamp

**Validation:**
- Throws error if metadata is not an object
- Throws error if createdAt is not valid ISO 8601
- Validates updatedAt >= createdAt

**Example:**
```javascript
const updated = updateTimestamps(existingMetadata);
// Returns new object with updated timestamp
```

## UI Integration

### Model Input Field

A new optional input field has been added to the prompt creation form:

```html
<input
  id="promptModel"
  name="model"
  type="text"
  placeholder="e.g., GPT-4, Claude 3.5 Sonnet"
  autocomplete="off"
  maxlength="100"
/>
```

### Metadata Display

Metadata is displayed in each prompt card with the following information:

1. **Model Name**: Displays the AI model used
2. **Created Timestamp**: Human-readable format (e.g., "Dec 12, 2024, 8:00 PM")
3. **Updated Timestamp**: Only shown if different from created timestamp
4. **Token Estimate**: Shows range with color-coded confidence badge

**Confidence Badge Colors:**
- 🟢 **Green** (High): < 1000 tokens - Highly accurate estimate
- 🟡 **Yellow** (Medium): 1000-5000 tokens - Moderate accuracy
- 🔴 **Red** (Low): > 5000 tokens - Less accurate estimate

### CSS Classes

```css
.metadata-section        /* Container for metadata */
.metadata-row           /* Individual metadata row */
.metadata-label         /* Label (Model, Created, etc.) */
.metadata-value         /* Value display */
.confidence-badge       /* Token confidence indicator */
.confidence-high        /* Green badge */
.confidence-medium      /* Yellow badge */
.confidence-low         /* Red badge */
```

## Data Structure

### Prompt Object (Updated)

```javascript
{
  id: string,
  title: string,
  content: string,
  createdAt: number,
  rating: number,
  metadata?: {                    // Optional metadata
    model: string,
    createdAt: string,            // ISO 8601
    updatedAt: string,            // ISO 8601
    tokenEstimate: {
      min: number,
      max: number,
      confidence: 'high' | 'medium' | 'low'
    }
  }
}
```

## Usage Examples

### Creating a Prompt with Metadata

```javascript
// User fills form with:
// - Title: "Code Review Prompt"
// - Content: "Review the following code..."
// - Model: "GPT-4 Turbo"

const metadata = trackModel('GPT-4 Turbo', content);
const prompt = {
  id: crypto.randomUUID(),
  title: 'Code Review Prompt',
  content: content,
  createdAt: Date.now(),
  rating: 0,
  metadata: metadata
};
```

### Updating Prompt Metadata

```javascript
if (prompt.metadata) {
  prompt.metadata = updateTimestamps(prompt.metadata);
}
```

## Error Handling

All functions include comprehensive error handling:

```javascript
try {
  const metadata = trackModel(modelName, content);
} catch (error) {
  console.error('Error creating metadata:', error);
  // Continue without metadata
}
```

**Common Errors:**
- `"Model name must be a non-empty string"`
- `"Model name must not exceed 100 characters"`
- `"Content must be a string"`
- `"Metadata must be an object"`
- `"Metadata must have a valid createdAt ISO 8601 timestamp"`
- `"updatedAt must be greater than or equal to createdAt"`

## Technical Implementation

### Token Estimation Algorithm

```
Base calculation:
  min_tokens = 0.75 × word_count
  max_tokens = 0.25 × character_count

If isCode=true:
  min_tokens = min_tokens × 1.3
  max_tokens = max_tokens × 1.3

Confidence determination:
  avg_tokens = (min_tokens + max_tokens) / 2
  if avg_tokens > 5000: confidence = 'low'
  else if avg_tokens >= 1000: confidence = 'medium'
  else: confidence = 'high'
```

### ISO 8601 Validation

```javascript
function isValidISO8601(dateString) {
  if (typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && dateString === date.toISOString();
}
```

## Browser Compatibility

- Works in all modern browsers
- Uses standard JavaScript (ES6+)
- No external dependencies
- localStorage compatible
- Respects browser's locale for timestamp formatting

## Testing

All core functions have been tested with the following scenarios:

✓ Basic token estimation  
✓ Token estimation with code multiplier  
✓ Confidence level calculations (high/medium/low)  
✓ Metadata creation with valid inputs  
✓ ISO 8601 timestamp validation  
✓ Timestamp updates  
✓ Empty model name validation  
✓ Model name length validation  
✓ Invalid metadata object handling  

## Future Enhancements

Potential improvements for the metadata system:

1. **Edit Metadata**: Allow users to update model name and metadata
2. **Metadata Filters**: Filter prompts by model or token count
3. **Token Usage Tracking**: Track actual token usage vs estimates
4. **Export Metadata**: Include metadata in export functionality
5. **Metadata Analytics**: Show statistics across all prompts
6. **Custom Token Calculators**: Support different tokenization methods per model

## Backward Compatibility

The metadata system is **fully backward compatible**:

- Existing prompts without metadata continue to work normally
- Metadata is optional (only added when model name is provided)
- UI gracefully handles prompts with and without metadata
- No breaking changes to existing functionality

