# Technical Specification: Prompt Library MVP to Production

**Version:** 1.0  
**Date:** December 2024  
**Author:** Senior Engineering Lead  
**Target Audience:** Junior Engineering Team

---

## Executive Summary

We're taking a browser-based prompt library and turning it into a production SaaS product. This isn't about building the most scalable system from day one—it's about shipping something that works, can handle real users, and won't embarrass us at 3 AM when things break.

**Timeline:** 12 weeks to production-ready MVP  
**Team Size:** 3-4 engineers  
**Budget:** ~$200K (salaries + infrastructure)

**Core Philosophy:**
- ✅ **Boring technology wins** - Use proven stacks, not bleeding edge
- ✅ **Ship fast, optimize later** - Get to production in 3 months
- ✅ **Build for 1K users, plan for 100K** - Don't over-engineer
- ✅ **Make it work, make it right, make it fast** - In that order

Let's get into the details.

---

## Part 1: System Architecture Document

### 1.1 Current State Analysis

**What you have:**
- Vanilla JS app with localStorage
- Solid metadata system (timestamps, token estimation)
- Notes functionality
- Import/export (JSON)
- Rating system

**What you need:**
- Cloud persistence (users want access from multiple devices)
- Authentication (know who owns what)
- Real-time sync (see changes across devices)
- API (enable integrations)
- Search that actually scales
- Team collaboration

**Migration Path:**
1. Keep current app working (backwards compatible)
2. Add cloud sync as progressive enhancement
3. Migrate localStorage → cloud over time
4. Maintain export format for easy migration

---

### 1.2 Data Persistence Strategy

#### 🏆 RECOMMENDATION: PostgreSQL on AWS RDS

**Why PostgreSQL? (The opinionated answer)**

I've built 5 SaaS products. Started with MongoDB twice, DynamoDB once, Firebase twice. **Always ended up regretting it and migrating to PostgreSQL.** Here's why:

**PostgreSQL Wins:**
```
✅ ACID compliance (critical for money/collaboration)
✅ Relations work naturally (users → workspaces → prompts)
✅ JSONB gives you NoSQL flexibility when needed
✅ Full-text search built-in (Elasticsearch can wait)
✅ Mature ecosystem (ORMs, tools, hosting)
✅ You can hire people who know it
✅ Scales to millions of users (Instagram, Uber use it)
✅ Your junior engineers already know SQL
```

**Why NOT the alternatives:**

**DynamoDB:**
```
❌ Query patterns must be known upfront (you'll change your mind)
❌ Complex to reason about (hot keys, LSIs, GSIs)
❌ Expensive at scale ($$$)
❌ No joins (you'll hack around this)
❌ Hard to debug (can't just SELECT * to investigate)
❌ Steeper learning curve

When to use: You're at AWS, need multi-region, have DynamoDB experts
Reality: You have 0 users. Use PostgreSQL.
```

**Firebase/Firestore:**
```
❌ Vendor lock-in (try migrating off, I dare you)
❌ Costs explode with scale
❌ Limited query capabilities
❌ Real-time is nice but not critical
❌ Hard to do complex reporting

When to use: Mobile-first app, need offline-first, small team
Reality: You're building a web app. Use PostgreSQL.
```

#### Database Schema Design

**Core Tables:**

```sql
-- ============================================================================
-- CORE SCHEMA v1.0
-- ============================================================================

-- Organizations (teams/companies)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(20) DEFAULT 'free', -- free, pro, team, enterprise
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- Soft delete
    deleted_at TIMESTAMP DEFAULT NULL
);

CREATE INDEX idx_orgs_slug ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_orgs_plan ON organizations(plan) WHERE deleted_at IS NULL;

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    name VARCHAR(255),
    avatar_url TEXT,
    
    -- Auth
    password_hash TEXT, -- bcrypt, cost 12
    oauth_provider VARCHAR(50), -- google, github, null
    oauth_id VARCHAR(255),
    
    -- Status
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL,
    
    -- Preferences (stored as JSONB for flexibility)
    preferences JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;
CREATE INDEX idx_users_last_seen ON users(last_seen_at) WHERE deleted_at IS NULL;

-- Workspaces (collections of prompts)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(20) DEFAULT 'private', -- private, shared, public
    
    -- Ownership
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL,
    
    -- Settings
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- Prevent duplicate names per org
    CONSTRAINT unique_workspace_name UNIQUE (organization_id, name)
);

CREATE INDEX idx_workspaces_org ON workspaces(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_workspaces_visibility ON workspaces(visibility) WHERE deleted_at IS NULL;
CREATE INDEX idx_workspaces_created_by ON workspaces(created_by) WHERE deleted_at IS NULL;

-- Workspace Members (who has access to what)
CREATE TABLE workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    role VARCHAR(20) NOT NULL DEFAULT 'viewer', -- owner, editor, viewer
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMP DEFAULT NOW(),
    
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_role ON workspace_members(role);

-- Collections (folders within workspaces)
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES collections(id) ON DELETE CASCADE, -- for nested folders
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7), -- hex color for UI
    icon VARCHAR(50), -- emoji or icon name
    
    -- Order for UI
    sort_order INT DEFAULT 0,
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL,
    
    CONSTRAINT unique_collection_name UNIQUE (workspace_id, parent_id, name)
);

CREATE INDEX idx_collections_workspace ON collections(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_parent ON collections(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_created_by ON collections(created_by);

-- Prompts (the main content)
CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    
    -- Content
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    
    -- Metadata (migrated from your localStorage structure)
    model_name VARCHAR(100),
    rating INT CHECK (rating >= 0 AND rating <= 5),
    tags TEXT[], -- PostgreSQL array
    
    -- Token estimation (from your existing code)
    token_estimate_min INT,
    token_estimate_max INT,
    token_confidence VARCHAR(10), -- high, medium, low
    
    -- Version tracking
    version INT DEFAULT 1,
    
    -- Ownership
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL,
    
    -- Additional metadata as JSONB (flexible)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Full-text search vector
    search_vector tsvector
);

-- Indexes for performance
CREATE INDEX idx_prompts_workspace ON prompts(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_collection ON prompts(collection_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_created_by ON prompts(created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_updated ON prompts(updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_rating ON prompts(rating) WHERE rating IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_prompts_tags ON prompts USING GIN(tags);
CREATE INDEX idx_prompts_search ON prompts USING GIN(search_vector);

-- Prompt Versions (track changes over time)
CREATE TABLE prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    
    version INT NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    
    -- Who changed it and why
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    change_note TEXT,
    
    -- Snapshot of metadata at this version
    metadata JSONB DEFAULT '{}'::jsonb,
    
    UNIQUE(prompt_id, version)
);

CREATE INDEX idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);

-- Notes (attached to prompts)
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    
    content TEXT NOT NULL,
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL
);

CREATE INDEX idx_notes_prompt ON notes(prompt_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_created_by ON notes(created_by) WHERE deleted_at IS NULL;

-- API Keys (for programmatic access)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, -- bcrypt hash of actual key
    key_prefix VARCHAR(10) NOT NULL, -- first 8 chars for UI (e.g., "pk_live_")
    
    -- Permissions
    scopes TEXT[], -- ['read:prompts', 'write:prompts', etc]
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT unique_key_name UNIQUE (user_id, name)
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;

-- Activity Log (audit trail)
CREATE TABLE activity_log (
    id BIGSERIAL PRIMARY KEY,
    
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    
    action VARCHAR(100) NOT NULL, -- 'prompt.created', 'workspace.deleted', etc
    resource_type VARCHAR(50) NOT NULL, -- 'prompt', 'workspace', etc
    resource_id UUID,
    
    -- Details
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Partition this table by month for performance
CREATE INDEX idx_activity_user ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_org ON activity_log(organization_id, created_at DESC);
CREATE INDEX idx_activity_resource ON activity_log(resource_type, resource_id, created_at DESC);
```

**Why this schema?**

1. **Soft deletes everywhere** - Users expect "undo" functionality
2. **JSONB for flexibility** - Your app will evolve, don't paint yourself into a corner
3. **UUIDs not integers** - Prevents enumeration attacks, easier to merge data
4. **Timestamps on everything** - Debugging and analytics require this
5. **Composite indexes** - Optimized for common queries
6. **GIN indexes** - Fast array and full-text searches
7. **Constraints** - Let the database enforce rules (less bugs)

**Storage Estimates:**

```
User: ~500 bytes
Prompt: ~2-5 KB average
Version: ~3 KB average
Note: ~1 KB average

For 10,000 users with avg 100 prompts each:
- 10K users × 500 bytes = 5 MB
- 1M prompts × 3 KB = 3 GB
- 2M versions (2 per prompt) × 3 KB = 6 GB
- 500K notes × 1 KB = 500 MB

Total: ~10 GB for 10K active users
```

#### Database Hosting Recommendation

**MVP (0-1K users):** 
- **Supabase** $25/month
  - Managed PostgreSQL
  - Built-in auth
  - Auto-generated REST API
  - Real-time subscriptions
  - Easy to start

**Scale (1K-10K users):**
- **AWS RDS** db.t3.medium ($100/month)
  - 2 vCPU, 4 GB RAM
  - 100 GB storage
  - Automated backups
  - Point-in-time recovery

**Growth (10K-100K users):**
- **AWS RDS** db.m5.large ($300/month)
  - 2 vCPU, 8 GB RAM
  - 500 GB storage
  - Read replicas for scale
  - Enhanced monitoring

**Scale (100K-1M users):**
- **AWS RDS** db.m5.xlarge ($600/month)
  - 4 vCPU, 16 GB RAM
  - 1 TB storage
  - Multi-AZ for HA
  - Performance Insights

---

### 1.3 Authentication Strategy

#### 🏆 RECOMMENDATION: Email/Password + OAuth (Google, GitHub)

**Why this approach:**

```
✅ Email/password covers 100% of users
✅ OAuth makes signup frictionless (70% will use it)
✅ Battle-tested libraries exist
✅ Familiar to users
✅ Easy to add API keys later
```

**Implementation Stack:**

**Option 1: Supabase Auth (Recommended for MVP)**
```javascript
// Supabase handles all of this:
- Email/password auth
- OAuth (Google, GitHub, Microsoft, etc.)
- Email verification
- Password reset
- Session management
- Row Level Security (RLS)

// You just write:
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password'
})
```

**Cost:** Free up to 50K users  
**Complexity:** Low  
**Time to implement:** 1 week

**Option 2: Auth0 (If you need enterprise features)**
```
Pros:
✅ Enterprise SSO (SAML, OIDC)
✅ Multi-factor auth
✅ Advanced security rules
✅ Better compliance (SOC 2, etc.)

Cons:
❌ $25/month base + $0.015/MAU (expensive at scale)
❌ More complex to set up
❌ Overkill for MVP
```

**Option 3: Roll your own (Don't)**
```
❌ Security is hard (password hashing, timing attacks, etc.)
❌ Email verification is annoying
❌ OAuth is painful to debug
❌ Password reset is tedious
❌ Session management has edge cases
❌ Compliance is complex (GDPR, etc.)

Time saved by using Supabase/Auth0: 4-6 weeks
Cost of security breach: Your company

Don't roll your own auth. Please.
```

#### Session Management

**JWT-based sessions:**

```javascript
// Access token (short-lived)
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",
  "iat": 1234567890,
  "exp": 1234568790 // 15 minutes
}

// Refresh token (long-lived)
{
  "sub": "user-uuid",
  "type": "refresh",
  "iat": 1234567890,
  "exp": 1235172690 // 7 days
}
```

**Why JWTs?**
- Stateless (no session store needed)
- Works across servers (horizontal scaling)
- Can include claims (permissions)
- Industry standard

**Security:**
- Store refresh token in httpOnly cookie (can't be stolen by XSS)
- Store access token in memory (or sessionStorage if needed)
- Rotate refresh tokens on use
- Implement token revocation list in Redis

#### API Key Authentication

**For programmatic access:**

```javascript
// API key format
pk_live_abc123def456ghi789

// Parts:
pk_       - prefix (helps identify in logs)
live_     - environment (live, test)
abc123... - random string (32 chars)

// Storage:
- Hash with bcrypt before storing (like passwords)
- Store prefix for UI display
- Track last used timestamp
- Support revocation
```

**Scopes:**
```javascript
const scopes = [
  'read:prompts',
  'write:prompts',
  'delete:prompts',
  'read:workspaces',
  'write:workspaces',
  'admin'
]
```

#### Authentication Flow

```
1. User lands on app
   ↓
2. Check for existing session (JWT in cookie)
   ↓
3. If expired, try refresh token
   ↓
4. If no refresh token, show login
   ↓
5. User logs in (email/pass or OAuth)
   ↓
6. Receive access token + refresh token
   ↓
7. Store refresh in httpOnly cookie
   ↓
8. Store access token in memory
   ↓
9. Include access token in API requests (Bearer header)
   ↓
10. Refresh when needed (15 min before expiry)
```

---

### 1.4 Real-Time Collaboration Requirements

#### Honest Assessment

**Do you need real-time collaboration for MVP?**

**NO.** Here's why:

```
Reality check:
- 95% of users will work solo
- Real-time is 6-8 weeks of development
- Real-time is expensive (WebSocket infrastructure)
- Real-time is complex (conflict resolution, presence, etc.)
- You have 0 users

Build this in v2.0, not MVP.
```

#### MVP Approach: "Good Enough" Sync

**Implement:**
1. **Polling with ETags** (5-10 second intervals)
2. **Optimistic updates** (feels instant)
3. **Conflict detection** (warn user if stale)
4. **Manual refresh** (button to force sync)

```javascript
// Simple polling
setInterval(async () => {
  const response = await fetch('/api/prompts', {
    headers: {
      'If-None-Match': lastETag
    }
  });
  
  if (response.status === 200) {
    // Data changed, update UI
    const prompts = await response.json();
    updateUI(prompts);
    lastETag = response.headers.get('ETag');
  }
  // 304 Not Modified = no changes
}, 10000); // 10 seconds
```

**Cost:** $0 (uses existing HTTP infrastructure)  
**Complexity:** Low  
**User experience:** 95% as good as real-time

#### v2.0 Approach: Real Real-Time

**When you're ready (6-12 months):**

**Option 1: Socket.io + Redis**
```javascript
// Server
io.on('connection', (socket) => {
  socket.on('join:workspace', (workspaceId) => {
    socket.join(workspaceId);
  });
  
  socket.on('prompt:update', async (data) => {
    // Save to DB
    await updatePrompt(data);
    
    // Broadcast to others in workspace
    socket.to(data.workspaceId).emit('prompt:updated', data);
  });
});

// Client
socket.on('prompt:updated', (data) => {
  if (data.id !== currentEditingPromptId) {
    updateUIForPrompt(data);
  }
});
```

**Cost:** $50-200/month (Redis + extra server capacity)  
**Complexity:** High  
**Time:** 4-6 weeks

**Option 2: Ably or Pusher (Managed)**
```javascript
// Just use their SDK
const channel = ably.channels.get(`workspace:${workspaceId}`);

channel.publish('prompt:updated', promptData);

channel.subscribe('prompt:updated', (message) => {
  updateUIForPrompt(message.data);
});
```

**Cost:** $29-99/month (scales with connections)  
**Complexity:** Low  
**Time:** 1-2 weeks

**Recommendation:** Use Ably/Pusher when you add real-time. Don't build it yourself.

#### Conflict Resolution Strategy

**When two users edit the same prompt:**

**MVP (v1.0):** Last write wins + warning
```javascript
// When user tries to save:
const currentVersion = await fetchPrompt(id);

if (currentVersion.updated_at > userVersion.updated_at) {
  showWarning('This prompt was edited by someone else. Overwrite?');
  // Let user choose: overwrite or cancel
}
```

**v2.0:** Operational Transform or CRDTs
```javascript
// Use a library like Y.js or Automerge
import * as Y from 'yjs'

const ydoc = new Y.Doc()
const ytext = ydoc.getText('content')

// Automatic conflict resolution
ytext.insert(0, 'Hello ')
ytext.insert(6, 'World')
// Works across multiple users
```

**Recommendation:** Don't overthink this for MVP. Show a warning, let user decide.

---

### 1.5 Rate Limiting and Abuse Prevention

#### Why Rate Limiting Matters

**Real story:** We launched without rate limiting. Day 3, someone scripted 1M API calls. Our AWS bill: $2,400. Oops.

#### Rate Limiting Strategy

**Implement at multiple levels:**

```
1. API Gateway / CDN level (Cloudflare)
   └─ 1000 requests/min per IP
   
2. Application level (Express middleware)
   └─ Tier-based limits per user
   
3. Database level (connection pooling)
   └─ Max 100 connections
   
4. Expensive operations (search, export)
   └─ Lower limits (10/min)
```

#### Implementation with Redis

```javascript
// Rate limiter middleware
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: async (req) => {
    const user = req.user;
    
    // Tier-based limits
    const limits = {
      free: 100,
      pro: 1000,
      team: 5000,
      enterprise: 50000
    };
    
    return limits[user.plan] || 100;
  },
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many requests. Please upgrade or wait.',
    retryAfter: 900 // seconds
  },
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
});

app.use('/api/', limiter);
```

#### Per-Endpoint Limits

```javascript
// Different limits for different operations
const limits = {
  // Cheap operations
  'GET /api/prompts': 200, // requests per 15 min
  'GET /api/workspaces': 200,
  
  // Medium operations
  'POST /api/prompts': 100,
  'PUT /api/prompts/:id': 100,
  'DELETE /api/prompts/:id': 50,
  
  // Expensive operations
  'POST /api/search': 50,
  'POST /api/export': 10,
  'POST /api/import': 10,
  
  // Very expensive
  'POST /api/workspaces/:id/export-all': 5
};
```

#### Abuse Detection Patterns

```javascript
// Red flags to watch for:
const abusePatterns = {
  // Too many failed auth attempts
  failedLogins: {
    threshold: 5,
    window: '5 minutes',
    action: 'temporary_ban'
  },
  
  // Rapid-fire requests
  burstRate: {
    threshold: 100,
    window: '1 minute',
    action: 'throttle'
  },
  
  // Unusual patterns
  suspiciousActivity: {
    // Creating 100 workspaces in 1 minute
    // Deleting all prompts rapidly
    // Exporting all data repeatedly
    action: 'flag_for_review'
  },
  
  // Known attack patterns
  sqlInjection: {
    pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b)/i,
    action: 'block_immediately'
  }
};
```

#### Protection Layers

**1. Cloudflare (CDN Layer)**
```
✅ DDoS protection (included in Pro plan $20/month)
✅ WAF (Web Application Firewall)
✅ Rate limiting by IP
✅ Bot detection
✅ Cache to reduce server load
```

**2. Application Layer**
```javascript
// Input validation
const { body, validationResult } = require('express-validator');

app.post('/api/prompts',
  body('title').isLength({ max: 500 }).trim().escape(),
  body('content').isLength({ max: 50000 }).trim(),
  body('model_name').optional().isLength({ max: 100 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Process request
  }
);

// Size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
```

**3. Database Layer**
```sql
-- Prevent resource exhaustion
SET statement_timeout = '30s'; -- Kill slow queries
SET idle_in_transaction_session_timeout = '10min'; -- Kill idle connections

-- Connection pooling (in application)
const pool = new Pool({
  max: 20, // Max connections per instance
  min: 2,  // Min connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

#### Cost Analysis

**Without rate limiting:**
```
Abuser makes 10M API calls in 1 day
→ Database CPU: $200
→ Bandwidth: $500
→ Total: $700/day = $21K/month

Game over.
```

**With rate limiting:**
```
Abuser hits limit after 100 requests
→ Additional costs: $0.01
→ Total: $0.01/day = $0.30/month

Saved: $20,999.70/month
```

Rate limiting isn't optional. It's survival.

---

### 1.6 Search Infrastructure

#### Current State

Your app has no search. Users scroll through prompts. This works for 10 prompts, fails at 100.

#### Search Strategy: Staged Approach

**Stage 1: PostgreSQL Full-Text (MVP)**  
**Good for:** 0-10K prompts per workspace

```sql
-- Add search vector to prompts table
ALTER TABLE prompts ADD COLUMN search_vector tsvector;

-- Function to update search vector
CREATE OR REPLACE FUNCTION update_prompt_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update
CREATE TRIGGER prompts_search_update
  BEFORE INSERT OR UPDATE ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_prompt_search_vector();

-- GIN index for fast search
CREATE INDEX idx_prompts_search_gin 
  ON prompts USING GIN(search_vector);

-- Search query
SELECT 
  id, title, content,
  ts_rank(search_vector, query) AS rank
FROM prompts, 
     to_tsquery('english', 'email & marketing') query
WHERE search_vector @@ query
  AND workspace_id = $1
  AND deleted_at IS NULL
ORDER BY rank DESC
LIMIT 20;
```

**Performance:**
- Search time: <100ms for 10K prompts
- Relevance: Good (weighted by field)
- Fuzzy matching: Limited
- Typo tolerance: Basic (stemming)

**Cost:** $0 (included in database)  
**Implementation time:** 3 days

**Stage 2: Elasticsearch (Growth)**  
**Good for:** 10K-1M prompts

**When to migrate:**
- Users complain about search quality
- Need fuzzy matching / typo tolerance
- Want faceted search (filter by multiple dimensions)
- Need search analytics

```javascript
// Elasticsearch index configuration
PUT /prompts
{
  "settings": {
    "number_of_shards": 2,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "prompt_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "asciifolding",
            "english_stemmer",
            "synonym_filter"
          ]
        }
      },
      "filter": {
        "english_stemmer": {
          "type": "stemmer",
          "language": "english"
        },
        "synonym_filter": {
          "type": "synonym",
          "synonyms": [
            "gpt, chatgpt, openai",
            "claude, anthropic",
            "email, mail, message"
          ]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "workspace_id": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "prompt_analyzer",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "content": {
        "type": "text",
        "analyzer": "prompt_analyzer"
      },
      "tags": { "type": "keyword" },
      "model_name": { "type": "keyword" },
      "rating": { "type": "integer" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}

// Search query with fuzzy matching
POST /prompts/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "email marketing",
            "fields": ["title^3", "content", "tags^2"],
            "fuzziness": "AUTO",
            "operator": "or"
          }
        }
      ],
      "filter": [
        { "term": { "workspace_id": "workspace-uuid" } }
      ]
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "content": {}
    }
  },
  "sort": [
    "_score",
    { "updated_at": "desc" }
  ],
  "size": 20
}
```

**Performance:**
- Search time: <50ms for 1M prompts
- Relevance: Excellent
- Fuzzy matching: Yes
- Typo tolerance: Yes
- Faceted search: Yes
- Highlighting: Yes

**Cost:** 
- Self-hosted: $100-300/month (AWS EC2 + storage)
- Elastic Cloud: $45-200/month (managed)

**Implementation time:** 2-3 weeks

**Stage 3: Semantic Search (Future)**  
**Good for:** "Find similar prompts" feature

**When to add:**
- Users request "find similar" functionality
- Want AI-powered recommendations
- Have ML engineer on team
- Budget for embeddings

```javascript
// Generate embeddings with OpenAI
const { data } = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: prompt.content
});

const embedding = data[0].embedding; // 1536 dimensions

// Store in PostgreSQL with pgvector
await db.query(`
  UPDATE prompts
  SET content_embedding = $1
  WHERE id = $2
`, [JSON.stringify(embedding), prompt.id]);

// Find similar prompts (cosine similarity)
const similar = await db.query(`
  SELECT id, title, content,
         1 - (content_embedding <=> $1) AS similarity
  FROM prompts
  WHERE workspace_id = $2
    AND id != $3
    AND deleted_at IS NULL
  ORDER BY content_embedding <=> $1
  LIMIT 10
`, [JSON.stringify(queryEmbedding), workspaceId, promptId]);
```

**Performance:**
- Search time: ~200ms
- Relevance: Excellent (understands meaning)
- Finds similar: Yes

**Cost:**
- OpenAI embeddings: $0.0001 per 1K tokens
- 100K prompts × avg 500 tokens = 50M tokens
- One-time indexing: $5
- Ongoing (new prompts): ~$10/month

**Implementation time:** 3-4 weeks

#### Search Recommendation Timeline

```
Month 1-3 (MVP):
└─ PostgreSQL full-text search
   └─ Cost: $0
   └─ Good enough for most users

Month 6-9 (v2.0):
└─ Elasticsearch (if needed)
   └─ Cost: $100-300/month
   └─ Better relevance, fuzzy search

Month 12+ (v3.0):
└─ Semantic search with embeddings
   └─ Cost: $10-50/month
   └─ "Find similar" feature
```

**Don't over-engineer search for MVP.** PostgreSQL full-text is fine for your first 1,000 users.

---

## Part 2: API Design Specification

### 2.1 RESTful vs GraphQL

#### 🏆 RECOMMENDATION: Start with REST, Add GraphQL Later

**Why REST for MVP:**

```
✅ Simpler to implement (3-4 weeks vs 6-8 weeks)
✅ Easier to debug (curl, Postman, browser)
✅ Better caching (HTTP caching works out of the box)
✅ Junior engineers know it
✅ Great tooling (Swagger/OpenAPI docs)
✅ Works with any HTTP client

You have 0 users. Ship REST.
```

**When to add GraphQL:**

```
Add GraphQL when:
- Users complain about over-fetching (too much data)
- Mobile app needs flexible queries
- Frontend makes 10+ API calls per page
- You have 10K+ users
- You have time (6-12 months in)

Not before.
```

### 2.2 REST API Design

#### Base URL Structure

```
https://api.promptlibrary.com/v1/
```

Why:
- Separate subdomain (easier to scale, different security rules)
- Version in URL (breaking changes are inevitable)
- Clean, predictable structure

#### Endpoint Design

**Resource-oriented:**

```http
# Organizations
GET    /v1/organizations          # List orgs user belongs to
POST   /v1/organizations          # Create org
GET    /v1/organizations/:id      # Get org details
PATCH  /v1/organizations/:id      # Update org
DELETE /v1/organizations/:id      # Delete org (soft)

# Workspaces
GET    /v1/workspaces             # List workspaces (across orgs)
POST   /v1/workspaces             # Create workspace
GET    /v1/workspaces/:id         # Get workspace
PATCH  /v1/workspaces/:id         # Update workspace
DELETE /v1/workspaces/:id         # Delete workspace

# Workspace Members
GET    /v1/workspaces/:id/members           # List members
POST   /v1/workspaces/:id/members           # Invite member
PATCH  /v1/workspaces/:id/members/:user_id # Update role
DELETE /v1/workspaces/:id/members/:user_id # Remove member

# Collections
GET    /v1/collections                        # List collections (all workspaces)
GET    /v1/workspaces/:id/collections        # List collections in workspace
POST   /v1/workspaces/:id/collections        # Create collection
GET    /v1/collections/:id                   # Get collection
PATCH  /v1/collections/:id                   # Update collection
DELETE /v1/collections/:id                   # Delete collection

# Prompts
GET    /v1/prompts                       # List prompts (all workspaces)
GET    /v1/workspaces/:id/prompts       # List prompts in workspace
GET    /v1/collections/:id/prompts      # List prompts in collection
POST   /v1/prompts                       # Create prompt
GET    /v1/prompts/:id                  # Get prompt
PATCH  /v1/prompts/:id                  # Update prompt
DELETE /v1/prompts/:id                  # Delete prompt

# Prompt Versions
GET    /v1/prompts/:id/versions         # List versions
GET    /v1/prompts/:id/versions/:ver    # Get specific version
POST   /v1/prompts/:id/revert/:ver      # Revert to version

# Notes
GET    /v1/prompts/:id/notes            # List notes
POST   /v1/prompts/:id/notes            # Create note
PATCH  /v1/notes/:id                    # Update note
DELETE /v1/notes/:id                    # Delete note

# Search
POST   /v1/search                       # Search across workspaces
POST   /v1/workspaces/:id/search       # Search in workspace

# Export/Import
POST   /v1/workspaces/:id/export       # Export workspace
POST   /v1/workspaces/:id/import       # Import into workspace
GET    /v1/exports/:job_id             # Check export status
GET    /v1/exports/:job_id/download    # Download export file

# User
GET    /v1/users/me                    # Get current user
PATCH  /v1/users/me                    # Update current user
DELETE /v1/users/me                    # Delete account

# API Keys
GET    /v1/api-keys                    # List API keys
POST   /v1/api-keys                    # Create API key
DELETE /v1/api-keys/:id                # Delete API key
```

#### Request/Response Format

**Request (Create Prompt):**
```http
POST /v1/prompts
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "collection_id": "660e8400-e29b-41d4-a716-446655440001",
  "title": "Email marketing template",
  "content": "Write a compelling email about {{product}} that...",
  "description": "Standard marketing email template",
  "tags": ["email", "marketing", "template"],
  "model_name": "GPT-4",
  "rating": 4,
  "metadata": {
    "use_case": "product_launch",
    "language": "en"
  }
}
```

**Response (Success):**
```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /v1/prompts/770e8400-e29b-41d4-a716-446655440002

{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "collection_id": "660e8400-e29b-41d4-a716-446655440001",
  "title": "Email marketing template",
  "content": "Write a compelling email about {{product}} that...",
  "description": "Standard marketing email template",
  "tags": ["email", "marketing", "template"],
  "model_name": "GPT-4",
  "rating": 4,
  "token_estimate_min": 45,
  "token_estimate_max": 60,
  "token_confidence": "high",
  "version": 1,
  "created_by": "880e8400-e29b-41d4-a716-446655440003",
  "created_at": "2024-12-12T10:30:00Z",
  "updated_at": "2024-12-12T10:30:00Z",
  "metadata": {
    "use_case": "product_launch",
    "language": "en"
  }
}
```

**Response (Error):**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "invalid_request",
    "message": "Title is required and must be less than 500 characters",
    "field": "title",
    "docs": "https://docs.promptlibrary.com/errors/invalid_request"
  }
}
```

#### HTTP Status Codes

**Use these consistently:**

```http
200 OK              - Successful GET, PATCH
201 Created         - Successful POST
204 No Content      - Successful DELETE
400 Bad Request     - Invalid input
401 Unauthorized    - Missing/invalid auth token
403 Forbidden       - Authenticated but not authorized
404 Not Found       - Resource doesn't exist
409 Conflict        - Resource already exists or version conflict
422 Unprocessable   - Validation failed
429 Too Many Requests - Rate limited
500 Server Error    - Our fault (log and alert)
503 Service Unavailable - Maintenance or overload
```

**Don't invent new codes.** Use standard HTTP semantics.

### 2.3 API Versioning Strategy

#### URL Versioning (Recommended)

```
https://api.promptlibrary.com/v1/prompts
https://api.promptlibrary.com/v2/prompts
```

**Why:**
- Clear and explicit
- Easy to route different versions to different servers
- Can maintain v1 and v2 simultaneously
- No header magic

**When to create v2:**
```
Breaking changes only:
✅ Removing a field
✅ Changing field types
✅ Changing URL structure
✅ Changing auth mechanism

Not breaking:
❌ Adding new optional fields
❌ Adding new endpoints
❌ Deprecating (but still supporting) fields
```

**Deprecation Policy:**
```
1. Announce deprecation 6 months before
2. Add warnings to API responses
3. Email all affected users
4. Maintain old version for 12 months minimum
5. Provide migration guide
```

#### Header-Based Versioning (Alternative)

```http
GET /prompts
Accept: application/vnd.promptlibrary.v1+json
```

**Don't use this.** It's clever but confusing. URL versioning is simpler.

### 2.4 Pagination Strategy

#### Cursor-Based Pagination (Recommended)

**Why cursor-based:**
- Works with real-time data (no skipped/duplicate items)
- Consistent results
- Efficient at scale
- Works with any sort order

**Request:**
```http
GET /v1/prompts?
  workspace_id=550e8400-e29b-41d4-a716-446655440000
  &limit=50
  &cursor=eyJpZCI6Ijc3MGU4NDAwLWUyOWIifQ==
  &sort=updated_at
  &order=desc
```

**Response:**
```json
{
  "data": [
    {
      "id": "prompt-1",
      "title": "...",
      "updated_at": "2024-12-12T10:30:00Z"
    },
    // ... 49 more
  ],
  "pagination": {
    "limit": 50,
    "next_cursor": "eyJpZCI6InByb21wdC01MCIsInVwZGF0ZWRfYXQiOiIyMDI0LTEyLTExVDE1OjAwOjAwWiJ9",
    "has_more": true
  }
}
```

**Cursor format (base64 encoded JSON):**
```javascript
// Encode
const cursor = Buffer.from(JSON.stringify({
  id: lastItem.id,
  updated_at: lastItem.updated_at
})).toString('base64');

// Decode
const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());

// SQL query with cursor
SELECT * FROM prompts
WHERE workspace_id = $1
  AND (updated_at, id) < ($2, $3)  -- Cursor values
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

**Why this works:**
- Composite cursor (updated_at + id) ensures uniqueness
- Works even if updated_at is the same for multiple items
- No offset calculations
- Consistent results

#### Offset-Based Pagination (Don't Use)

```http
GET /v1/prompts?page=2&limit=50
```

**Problems:**
```
❌ If item is added, results shift (duplicate on page 2)
❌ If item is deleted, results shift (skip items)
❌ Inefficient at large offsets (OFFSET 10000 is slow)
❌ Doesn't work with real-time updates
```

**Only use offset if:**
- You need page numbers in UI (rare)
- Data is truly static
- You understand the tradeoffs

### 2.5 Filtering and Sorting

#### Filter Parameters

```http
GET /v1/prompts?
  workspace_id=550e8400-e29b-41d4-a716-446655440000
  &collection_id=660e8400-e29b-41d4-a716-446655440001
  &tags=email,marketing
  &rating_min=3
  &created_after=2024-01-01T00:00:00Z
  &created_before=2024-12-31T23:59:59Z
  &model_name=GPT-4
  &search=email template
```

**Implementation:**
```javascript
// Build query dynamically
let query = `
  SELECT * FROM prompts
  WHERE workspace_id = $1
    AND deleted_at IS NULL
`;

const params = [workspaceId];
let paramIndex = 2;

if (collection_id) {
  query += ` AND collection_id = $${paramIndex}`;
  params.push(collection_id);
  paramIndex++;
}

if (tags && tags.length > 0) {
  query += ` AND tags && $${paramIndex}`;  // PostgreSQL array overlap
  params.push(tags);
  paramIndex++;
}

if (rating_min) {
  query += ` AND rating >= $${paramIndex}`;
  params.push(rating_min);
  paramIndex++;
}

// ... etc

const results = await db.query(query, params);
```

#### Sort Parameters

```http
GET /v1/prompts?
  sort=updated_at
  &order=desc
```

**Supported sort fields:**
```javascript
const allowedSorts = [
  'created_at',
  'updated_at',
  'title',
  'rating',
  'relevance'  // Only with search
];

const allowedOrders = ['asc', 'desc'];

// Validate
if (!allowedSorts.includes(sort)) {
  return res.status(400).json({
    error: 'Invalid sort field. Allowed: ' + allowedSorts.join(', ')
  });
}
```

**SQL injection prevention:**
```javascript
// DON'T do this (SQL injection)
const query = `SELECT * FROM prompts ORDER BY ${sort} ${order}`;

// DO this (whitelist + parameterize)
const sortField = allowedSorts.includes(sort) ? sort : 'updated_at';
const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
const query = `SELECT * FROM prompts ORDER BY ${sortField} ${sortOrder}`;
```

### 2.6 Webhook Events

#### Event Types

```javascript
const webhookEvents = {
  // Prompt events
  'prompt.created': {
    data: {
      id, workspace_id, title, content, created_by, created_at
    }
  },
  'prompt.updated': {
    data: {
      id, workspace_id, title, content, updated_by, updated_at, changes: {...}
    }
  },
  'prompt.deleted': {
    data: {
      id, workspace_id, deleted_by, deleted_at
    }
  },
  
  // Workspace events
  'workspace.created': {
    data: {
      id, name, created_by, created_at
    }
  },
  'workspace.member_added': {
    data: {
      workspace_id, user_id, role, invited_by
    }
  },
  'workspace.member_removed': {
    data: {
      workspace_id, user_id, removed_by
    }
  },
  
  // Collection events
  'collection.created': {
    data: {
      id, workspace_id, name, created_by
    }
  },
  'collection.updated': {
    data: {
      id, workspace_id, name, updated_by
    }
  },
  'collection.deleted': {
    data: {
      id, workspace_id, deleted_by
    }
  }
};
```

#### Webhook Delivery

```javascript
// Store webhook configurations
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    url TEXT NOT NULL,
    events TEXT[] NOT NULL,  -- Array of event types
    secret TEXT NOT NULL,    -- For HMAC signature
    
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Failure handling
    failure_count INT DEFAULT 0,
    last_failure_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);

// Webhook delivery function
async function deliverWebhook(endpoint, event) {
  const payload = {
    id: generateEventId(),
    type: event.type,
    created_at: new Date().toISOString(),
    data: event.data
  };
  
  // Sign payload with HMAC
  const signature = crypto
    .createHmac('sha256', endpoint.secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event.type,
        'X-Webhook-ID': payload.id
      },
      body: JSON.stringify(payload),
      timeout: 5000  // 5 second timeout
    });
    
    if (response.ok) {
      // Success - reset failure count
      await db.query(`
        UPDATE webhook_endpoints
        SET failure_count = 0
        WHERE id = $1
      `, [endpoint.id]);
    } else {
      await handleWebhookFailure(endpoint, response.status);
    }
  } catch (error) {
    await handleWebhookFailure(endpoint, error);
  }
}

async function handleWebhookFailure(endpoint, error) {
  const newCount = endpoint.failure_count + 1;
  
  // Exponential backoff: retry after 1min, 5min, 15min, 1hour, then disable
  const retryDelays = [60, 300, 900, 3600];
  
  if (newCount <= retryDelays.length) {
    // Schedule retry
    await scheduleWebhookRetry(endpoint, retryDelays[newCount - 1]);
  } else {
    // Too many failures - disable webhook
    await db.query(`
      UPDATE webhook_endpoints
      SET is_active = FALSE,
          failure_count = $1,
          last_failure_at = NOW()
      WHERE id = $2
    `, [newCount, endpoint.id]);
    
    // Email user
    await sendEmail({
      to: endpoint.owner_email,
      subject: 'Webhook disabled due to failures',
      body: `Your webhook ${endpoint.url} has been disabled after ${newCount} failures.`
    });
  }
  
  // Update failure count
  await db.query(`
    UPDATE webhook_endpoints
    SET failure_count = $1,
        last_failure_at = NOW()
    WHERE id = $2
  `, [newCount, endpoint.id]);
}
```

#### Webhook Security

**Verify webhook signatures:**

```javascript
// In receiving app
function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Constant-time comparison (prevents timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware
app.post('/webhooks/promptlibrary', 
  express.raw({ type: 'application/json' }),  // Get raw body
  (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const secret = process.env.WEBHOOK_SECRET;
    
    if (!verifyWebhookSignature(req.body, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process webhook
    const event = JSON.parse(req.body);
    processWebhook(event);
    
    res.json({ received: true });
  }
);
```

### 2.7 API Documentation

#### OpenAPI/Swagger Specification

**Generate docs automatically:**

```javascript
// With express + swagger-jsdoc
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Prompt Library API',
      version: '1.0.0',
      description: 'API for managing AI prompts',
    },
    servers: [
      {
        url: 'https://api.promptlibrary.com/v1',
        description: 'Production server',
      },
      {
        url: 'https://api-staging.promptlibrary.com/v1',
        description: 'Staging server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
  },
  apis: ['./routes/*.js'], // Path to API routes
};

const swaggerSpec = swaggerJsdoc(options);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

**Document endpoints with JSDoc:**

```javascript
/**
 * @swagger
 * /prompts:
 *   post:
 *     summary: Create a new prompt
 *     tags: [Prompts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - workspace_id
 *               - title
 *               - content
 *             properties:
 *               workspace_id:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *                 maxLength: 500
 *               content:
 *                 type: string
 *                 maxLength: 50000
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Prompt created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Prompt'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
app.post('/prompts', createPrompt);
```

**Result:** Beautiful interactive docs at https://api.promptlibrary.com/docs

---

## Part 3: Scaling Projections

### 3.1 Growth Path: 100 → 1M Users

#### Stage 1: MVP (0-1,000 users)

**Architecture:**
```
┌─────────────┐
│ Cloudflare  │ ← CDN + DDoS protection
│   (Free)    │
└──────┬──────┘
       │
┌──────▼──────┐
│  Vercel     │ ← Frontend (React SPA)
│ ($20/month) │
└──────┬──────┘
       │
┌──────▼────────────┐
│  DigitalOcean     │ ← Backend API (Node/Python)
│  App Platform     │
│  ($24/month)      │
│  - 2 containers   │
│  - Auto-scaling   │
└──────┬────────────┘
       │
┌──────▼────────────┐
│  Supabase         │ ← Database + Auth
│  ($25/month)      │
│  - PostgreSQL     │
│  - Auth           │
│  - Storage        │
│  - Real-time      │
└───────────────────┘

┌───────────────────┐
│  Redis Cloud      │ ← Cache + Queue
│  (Free tier)      │
└───────────────────┘
```

**Monthly Cost:** ~$70  
**Can handle:** 1,000 users, 100,000 prompts  
**Response time:** <200ms p95  
**Uptime:** 99.5%

#### Stage 2: Growth (1K-10K users)

**Architecture changes:**
```
Add:
✅ Separate API servers (2x)
✅ Redis paid tier ($10/month)
✅ Postgres scaling (db.t3.medium, $100/month)
✅ S3 for file storage ($5/month)
✅ CloudWatch monitoring ($20/month)
✅ More Vercel bandwidth ($50/month)
```

**Monthly Cost:** ~$300  
**Can handle:** 10,000 users, 1M prompts  
**Response time:** <200ms p95  
**Uptime:** 99.9%

**Team needs:**
- 2-3 engineers
- 1 DevOps (part-time)
- On-call rotation

#### Stage 3: Scale (10K-100K users)

**Architecture:**
```
┌─────────────┐
│ Cloudflare  │ ← CDN + WAF
│ Pro Plan    │
│ ($20/month) │
└──────┬──────┘
       │
┌──────▼──────────────┐
│  AWS CloudFront     │ ← CDN for API
│  ($50/month)        │
└──────┬──────────────┘
       │
┌──────▼──────────────┐
│  AWS ALB            │ ← Load Balancer
│  ($30/month)        │
└──────┬──────────────┘
       │
┌──────▼──────────────┐
│  ECS Fargate        │ ← API Servers (4-8 tasks)
│  ($400/month)       │
│  - Auto-scaling     │
│  - Health checks    │
└──────┬──────────────┘
       │
┌──────▼──────────────────────────────────────┐
│  AWS RDS PostgreSQL (db.m5.large)           │
│  ($300/month)                               │
│  - 2 vCPU, 8 GB RAM                         │
│  - Multi-AZ (high availability)             │
│  - Read replica for reporting               │
│  - Automated backups                        │
└──────┬──────────────────────────────────────┘
       │
┌──────▼──────────────┐
│  ElastiCache Redis  │ ← Cache + Sessions
│  ($150/month)       │
│  - 2 nodes          │
│  - Replication      │
└─────────────────────┘

┌─────────────────────┐
│  Elasticsearch      │ ← Search
│  ($200/month)       │
│  - 2 nodes          │
│  - 100 GB storage   │
└─────────────────────┘

┌─────────────────────┐
│  S3                 │ ← File Storage
│  ($50/month)        │
└─────────────────────┘

┌─────────────────────┐
│  DataDog            │ ← Monitoring
│  ($300/month)       │
└─────────────────────┘
```

**Monthly Cost:** ~$1,500  
**Can handle:** 100,000 users, 10M prompts  
**Response time:** <150ms p95  
**Uptime:** 99.95%

**Team needs:**
- 5-8 engineers
- 1-2 DevOps
- 1 Site Reliability Engineer (SRE)
- 24/7 on-call

#### Stage 4: Big Scale (100K-1M users)

**Architecture changes:**
```
Add:
✅ Multiple regions (US, EU)
✅ Database sharding
✅ Microservices (search, export, etc.)
✅ Kubernetes (EKS)
✅ Kafka for event streaming
✅ Data warehouse (Snowflake) for analytics
✅ CDN everywhere
```

**Monthly Cost:** ~$10,000-20,000  
**Can handle:** 1M users, 100M prompts  
**Response time:** <100ms p95  
**Uptime:** 99.99%

**Team needs:**
- 15-25 engineers
- 3-5 DevOps/SRE
- 1 Security engineer
- 1 Data engineer

### 3.2 Cost Per User Analysis

```
Stage 1 (0-1K users):
  Infrastructure: $70/month
  Cost per user: $0.07/month
  
Stage 2 (1K-10K users):
  Infrastructure: $300/month
  Cost per user: $0.03/month
  
Stage 3 (10K-100K users):
  Infrastructure: $1,500/month
  Cost per user: $0.015/month
  
Stage 4 (100K-1M users):
  Infrastructure: $15,000/month
  Cost per user: $0.015/month

Economies of scale work!
```

**Pricing Model (to be profitable):**

```
Free Tier:
  - 1 user
  - 100 prompts
  - 100 API calls/hour
  - Cost to serve: $0.05/month
  - Acceptable (drives adoption)

Pro ($10/month):
  - 1 user
  - Unlimited prompts
  - 1,000 API calls/hour
  - Cost to serve: $0.15/month
  - Margin: $9.85 (98.5%)
  - Target: 20% of users upgrade

Team ($49/month):
  - 5 users
  - Unlimited prompts
  - 5,000 API calls/hour
  - Cost to serve: $0.75/month
  - Margin: $48.25 (98.5%)
  - Target: 5% of users

Business ($99/month):
  - 15 users
  - Unlimited prompts
  - 15,000 API calls/hour
  - Cost to serve: $2.00/month
  - Margin: $97 (98%)
  - Target: 1% of users

Enterprise ($500+/month):
  - Custom users
  - SSO, audit logs, SLA
  - Cost to serve: $20-50/month
  - Margin: $450+ (90%)
  - Target: 0.1% of users
```

**Revenue Projection:**

```
10,000 total users:
  - 8,000 free ($0) = $0
  - 1,500 pro ($10) = $15,000/month
  - 400 team ($49) = $19,600/month
  - 90 business ($99) = $8,910/month
  - 10 enterprise ($500 avg) = $5,000/month
  
Total: $48,510/month
Infrastructure: $300/month
Gross margin: 99.4%
```

### 3.3 Performance Benchmarks

#### API Response Time Targets

```
Endpoint Type          p50      p95      p99
─────────────────────────────────────────────
GET (simple)         <50ms   <100ms   <200ms
GET (complex query)  <100ms  <200ms   <500ms
POST/PATCH           <100ms  <200ms   <500ms
DELETE               <50ms   <100ms   <200ms
Search               <150ms  <300ms   <1000ms
Export (async)       <500ms  <1000ms  <2000ms

Target: p95 < 200ms for all endpoints
Reality: Measure and optimize
```

#### Database Query Performance

```
Query Type              Target
──────────────────────────────────
Simple SELECT           <10ms
JOIN (2-3 tables)       <30ms
Aggregation             <50ms
Full-text search        <100ms
Complex reporting       <1000ms

Monitor slow queries:
  - Log queries > 100ms
  - Alert on queries > 1000ms
  - Weekly slow query review
```

#### Caching Strategy

```
What to cache:
✅ User session (Redis, TTL 15 min)
✅ User permissions (Redis, TTL 1 min)
✅ Popular prompts (Redis, TTL 5 min)
✅ Search results (Redis, TTL 30 sec)
✅ Workspace metadata (Redis, TTL 5 min)

What NOT to cache:
❌ Prompt content (always fresh)
❌ Financial data
❌ User settings (cached in JWT)

Cache hit rate target: >80%
```

#### Load Testing Targets

```
Test Scenarios:

1. Normal load:
   - 10 req/sec sustained
   - Should handle easily
   - Response time: <100ms p95

2. Peak load:
   - 100 req/sec sustained
   - Should handle without degradation
   - Response time: <200ms p95

3. Spike:
   - 500 req/sec for 1 minute
   - Should handle with auto-scaling
   - Response time: <500ms p95

4. Stress test:
   - 1000 req/sec until failure
   - Find breaking point
   - Graceful degradation

Tools: k6, Artillery, Gatling
Run monthly, before major releases
```

#### Monitoring & Alerts

```
Critical Alerts (wake up at 3 AM):
🚨 API error rate > 5%
🚨 Database CPU > 90%
🚨 Response time p95 > 1000ms
🚨 Service down (health check fails)
🚨 Disk space > 90%

Warning Alerts (check in morning):
⚠️  API error rate > 1%
⚠️  Database CPU > 70%
⚠️  Response time p95 > 500ms
⚠️  Memory usage > 80%
⚠️  Cache hit rate < 70%

Metrics to Track:
📊 Request rate (req/sec)
📊 Response time (p50, p95, p99)
📊 Error rate (%)
📊 Database query time
📊 Cache hit rate
📊 Active users (concurrent)
📊 Queue depth (background jobs)
```

---

## Part 4: Migration Strategy

### 4.1 localStorage → Cloud Migration

**Challenge:** Users have data in localStorage. Don't lose it.

**Strategy: Progressive Enhancement**

```javascript
// Phase 1: Detect localStorage data
function hasLocalData() {
  const localPrompts = localStorage.getItem('promptLibrary.prompts.v1');
  return localPrompts && JSON.parse(localPrompts).length > 0;
}

// Phase 2: Offer migration
if (hasLocalData() && user.isAuthenticated && !user.hasMigrated) {
  showMigrationBanner({
    message: 'You have 23 prompts in local storage. Sync to cloud?',
    action: 'Migrate Now'
  });
}

// Phase 3: Upload local data
async function migrateToCloud() {
  const localPrompts = JSON.parse(localStorage.getItem('promptLibrary.prompts.v1'));
  const localNotes = JSON.parse(localStorage.getItem('promptLibrary.notes.v1'));
  
  try {
    // Batch upload
    const response = await fetch('/api/v1/import/migrate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompts: localPrompts,
        notes: localNotes,
        source: 'localStorage'
      })
    });
    
    if (response.ok) {
      // Mark as migrated
      await markUserMigrated(user.id);
      
      // Keep localStorage as backup for 30 days
      localStorage.setItem('promptLibrary.migrated', Date.now());
      
      showSuccess('✅ Migrated 23 prompts to cloud!');
    }
  } catch (error) {
    showError('Migration failed. Your local data is safe.');
  }
}

// Phase 4: Keep both in sync for safety
async function savePrompt(prompt) {
  // Save to cloud first
  try {
    const response = await fetch('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify(prompt)
    });
    
    if (response.ok) {
      // Also save to localStorage as backup
      saveToLocalStorage(prompt);
    }
  } catch (error) {
    // If cloud fails, still save locally
    saveToLocalStorage(prompt);
    queueForRetry(prompt);
  }
}
```

### 4.2 Deployment Strategy

#### Zero-Downtime Deployment

```
1. Blue-Green Deployment:

   ┌──────────┐
   │  Blue    │ ← Current (serving 100% traffic)
   │ (v1.0)   │
   └──────────┘
   
   ┌──────────┐
   │  Green   │ ← New version (0% traffic)
   │ (v1.1)   │
   └──────────┘
   
   Deploy green → Test → Switch traffic → Old blue becomes next green

2. Canary Deployment:
   
   v1.0: 95% traffic
   v1.1: 5% traffic (canary)
   
   Monitor for 1 hour →
   If OK: 50% / 50%
   Monitor for 1 hour →
   If OK: 0% / 100%
   
3. Database Migrations:
   
   ✅ Always backward compatible
   ✅ Add columns first (nullable)
   ✅ Deploy code
   ✅ Backfill data
   ✅ Make non-nullable
   ✅ Remove old code
```

---

## Part 5: Security Checklist

### 5.1 Must-Haves Before Launch

```
Authentication:
✅ Passwords hashed with bcrypt (cost 12)
✅ JWT tokens expire (15 min access, 7 day refresh)
✅ Refresh token rotation
✅ OAuth properly implemented
✅ Email verification required
✅ Password reset works securely

Authorization:
✅ Permission checks on every request
✅ Row-level security (users can't access others' data)
✅ API keys scoped properly
✅ No JWT token in localStorage (httpOnly cookies)

Input Validation:
✅ All inputs validated (title length, content size, etc.)
✅ SQL injection prevented (parameterized queries)
✅ XSS prevented (sanitize HTML)
✅ CSRF protection (SameSite cookies)
✅ File upload validation (size, type)

Infrastructure:
✅ HTTPS only (force redirect)
✅ Security headers (CSP, HSTS, etc.)
✅ Rate limiting active
✅ DDoS protection (Cloudflare)
✅ Database backups automated
✅ Secrets in env vars (not code)

Compliance:
✅ Privacy policy
✅ Terms of service
✅ GDPR compliance (data export, deletion)
✅ CCPA compliance
✅ Security incident response plan

Monitoring:
✅ Error tracking (Sentry)
✅ Access logs
✅ Failed login attempts tracked
✅ Suspicious activity alerts
✅ Uptime monitoring
```

### 5.2 Security Headers

```javascript
// Express middleware
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.promptlibrary.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
}));

// Additional headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```

---

## Part 6: Launch Checklist

### 6.1 Week Before Launch

```
Code:
✅ All tests passing (>80% coverage)
✅ No critical bugs
✅ Performance tested (load test passed)
✅ Security audit completed
✅ Code review done

Infrastructure:
✅ Production environment configured
✅ Database backups configured
✅ Monitoring/alerts set up
✅ CDN configured
✅ DNS configured
✅ SSL certificates valid

Documentation:
✅ API docs published
✅ User guide written
✅ Privacy policy live
✅ Terms of service live
✅ FAQ prepared

Support:
✅ Support email set up
✅ Status page ready
✅ Incident response plan ready
✅ On-call rotation scheduled

Marketing:
✅ Landing page live
✅ Product Hunt draft ready
✅ Email to waitlist prepared
✅ Social media posts queued
✅ Press kit ready
```

### 6.2 Launch Day

```
Morning (9 AM PT):
✅ Final smoke tests
✅ Database backup taken
✅ Team on standby
✅ Monitoring dashboard open

Launch (10 AM PT):
✅ Remove waitlist gate
✅ Send email to waitlist
✅ Post to Product Hunt
✅ Tweet launch announcement
✅ Post in relevant communities

Afternoon (12 PM - 5 PM PT):
✅ Monitor errors closely
✅ Respond to support requests
✅ Fix critical bugs immediately
✅ Engage with Product Hunt comments
✅ Monitor server load

Evening (5 PM PT):
✅ Review metrics
✅ Address any issues
✅ Plan for tomorrow
✅ Celebrate 🎉
```

### 6.3 Week After Launch

```
Daily:
✅ Monitor error rates
✅ Review support tickets
✅ Fix bugs
✅ Engage with users
✅ Collect feedback

Weekly:
✅ Review analytics
✅ Plan improvements
✅ Write blog post
✅ Send updates to users
✅ Iterate based on feedback
```

---

## Part 7: The Hard Truths (Senior Engineer to Junior Team)

### 7.1 What Will Go Wrong

**Expect these problems:**

```
Week 1:
- Bug you didn't catch in production
- API endpoint you forgot to secure
- Feature that doesn't work on Safari
- User doing something you never imagined
- Database query that's slower than you thought

Month 1:
- User asks for feature you didn't build
- Competitor launches similar product
- Server goes down at 2 AM
- Someone finds security vulnerability
- Costs are higher than projected

Year 1:
- Need to refactor major parts
- Database migration needed
- Team member leaves
- Major outage (everyone sees)
- Realize you need to pivot
```

**This is normal. This is startup life.**

### 7.2 What Actually Matters

```
✅ Shipping fast
✅ Talking to users
✅ Fixing bugs quickly
✅ Iterating based on feedback
✅ Staying alive (don't run out of money)

❌ Perfect code
❌ 100% test coverage
❌ Microservices architecture
❌ Latest JS framework
❌ Premature optimization
```

### 7.3 Technical Debt is OK

**Good debt (take it):**
- Hardcoded values to ship faster
- Manual processes you'll automate later
- PostgreSQL instead of "more scalable" database
- Monolith instead of microservices
- Simple auth instead of enterprise SSO

**Bad debt (avoid):**
- No tests at all
- No monitoring
- Security vulnerabilities
- Data loss scenarios
- No backups

### 7.4 When to Optimize

```
Optimize when:
✅ Users complain about speed
✅ Costs are too high
✅ Can't ship new features
✅ Hiring slowed by bad code

Don't optimize when:
❌ "Just in case"
❌ "To learn new tech"
❌ "Best practice says"
❌ "Might be slow later"

Measure first. Optimize second.
```

---

## Final Recommendation

**Ship this in 12 weeks:**

1. **Week 1-2:** Set up infrastructure (Supabase + DigitalOcean)
2. **Week 3-4:** Build API (CRUD + auth)
3. **Week 5-6:** Migrate frontend to use API
4. **Week 7-8:** Add workspaces + collaboration
5. **Week 9-10:** Polish, fix bugs, optimize
6. **Week 11:** Testing, security audit
7. **Week 12:** Launch

**Don't:**
- Build real-time collaboration (v2.0)
- Build CLI (v2.0)
- Build mobile app (v3.0)
- Use Kubernetes (wait till 100K users)
- Use microservices (monolith is fine)
- Over-engineer anything

**Do:**
- Use PostgreSQL (boring, works)
- Use Supabase (fast auth + database)
- Ship fast, iterate faster
- Talk to users every week
- Fix bugs same day
- Monitor everything

**Remember:** Done is better than perfect. Ship it. You'll learn what users actually need, not what you think they need.

Good luck. You've got this. 🚀

---

**Questions? Common concerns:**

Q: "But what if we need to scale to 10M users?"
A: You have 0 users. Build for 1K, plan for 100K. You'll refactor anyway.

Q: "Shouldn't we use [hot new tech]?"
A: No. Use boring technology. It's boring because it works.

Q: "What if PostgreSQL can't scale?"
A: Instagram used PostgreSQL to 1B users. You'll be fine.

Q: "Should we build microservices for better scaling?"
A: No. Monolith until you have real scaling problems.

Q: "How do we prevent [rare edge case]?"
A: You don't. Fix it when it happens. Ship now.

**Now go build something people want.**

