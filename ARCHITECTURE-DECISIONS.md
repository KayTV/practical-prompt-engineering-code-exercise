# Architecture Decision Guide

**Purpose:** Quick reference for common technical decisions during prompt library development  
**Last Updated:** December 2024

---

## Decision 1: Backend Language

### Python (FastAPI) ✅ RECOMMENDED

**Choose if:**
- ✅ Team has Python experience
- ✅ Planning AI/ML features (semantic search, recommendations)
- ✅ Want excellent async support
- ✅ Need automatic API documentation

**Pros:**
- Rich AI/ML ecosystem (transformers, embeddings)
- FastAPI = async + auto docs + type hints
- Great for data processing
- Easier to hire ML engineers later

**Cons:**
- Slightly slower than Node.js
- Deployment is more complex
- Package management can be tricky

**Stack:**
```python
Framework: FastAPI 0.104+
ORM: SQLAlchemy 2.0 with asyncpg
Validation: Pydantic v2
Testing: pytest + httpx
```

### Node.js (Express + TypeScript) ✅ ALSO GOOD

**Choose if:**
- ✅ Team is JavaScript/TypeScript focused
- ✅ Want unified language (same as frontend)
- ✅ Need high throughput
- ✅ Faster MVP development

**Pros:**
- Single language for full stack
- Huge package ecosystem (npm)
- Fast execution
- Easy deployment

**Cons:**
- Weaker ML/AI ecosystem
- Callback hell (if not using async/await)
- Less structured than Python

**Stack:**
```typescript
Framework: Express 4.18+ with TypeScript
ORM: Prisma or TypeORM
Validation: Zod or joi
Testing: Jest + supertest
```

### Decision Matrix

| Factor | Python (FastAPI) | Node.js (Express) |
|--------|------------------|-------------------|
| Development speed | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Performance | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| AI/ML support | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Ecosystem | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Type safety | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (with TS) |
| Hiring pool | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**Recommendation:** Python if you plan AI features within 6 months, Node.js otherwise

---

## Decision 2: Database

### PostgreSQL ✅ STRONGLY RECOMMENDED

**Choose PostgreSQL because:**
- ✅ ACID compliance (critical for collaboration)
- ✅ JSONB support (flexible metadata)
- ✅ Full-text search built-in
- ✅ Proven at massive scale
- ✅ Strong ecosystem
- ✅ Free and open source

**When NOT to choose:**
- ❌ Never (for this use case)

### MongoDB ❌ NOT RECOMMENDED

**Why not:**
- Less mature ACID guarantees
- Relational data (workspaces → collections → prompts) fits SQL better
- Harder to enforce referential integrity
- Team probably more familiar with SQL

**When it might make sense:**
- Team has deep MongoDB expertise
- Extreme schema flexibility needed
- Already using MongoDB for other systems

**Decision:** Use PostgreSQL unless you have a very strong reason not to

---

## Decision 3: Search Implementation

### Phase 1 (MVP): PostgreSQL Full-Text ✅

**Use built-in PostgreSQL search for MVP**

**Why:**
- ✅ No additional infrastructure
- ✅ Fast to implement (1-2 days)
- ✅ Good enough for 10K-50K prompts
- ✅ Saves money

**Limitations:**
- Limited fuzzy matching
- No typo tolerance
- Basic relevance ranking

**Implementation:**
```sql
-- Add search vector column
ALTER TABLE prompts ADD COLUMN search_vector tsvector;

-- Create trigger to maintain it
CREATE FUNCTION prompts_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER prompts_search_update
  BEFORE INSERT OR UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION prompts_search_trigger();

-- Create GIN index
CREATE INDEX idx_prompts_search ON prompts USING GIN(search_vector);
```

### Phase 2 (Growth): Elasticsearch ⭐

**Upgrade to Elasticsearch when:**
- ❌ Users complain about search quality
- ❌ Library has >10K prompts
- ❌ Need fuzzy search / typo tolerance
- ✅ Have budget ($300-$1K/month)

**Adds:**
- Fuzzy matching
- Typo tolerance
- Better relevance scoring
- Aggregations (faceted search)
- Highlighting

### Phase 3 (Scale): Add Semantic Search 🚀

**Add semantic search when:**
- ✅ Have >50K prompts
- ✅ Users want "find similar" feature
- ✅ Have ML engineer on team
- ✅ Budget for embeddings API

**Options:**
1. OpenAI Embeddings API (~$0.0001 per 1K tokens)
2. Cohere Embed API (similar pricing)
3. Self-hosted (sentence-transformers on GPU)

**Decision Tree:**
```
Start → PostgreSQL FTS (MVP)
  ↓
After 1K users or complaints → Add Elasticsearch
  ↓
After 10K users or feature demand → Add Semantic Search
```

---

## Decision 4: Authentication

### Email/Password + OAuth ✅ RECOMMENDED

**For MVP, implement:**
- ✅ Email/password (with bcrypt)
- ✅ OAuth with Google
- ✅ OAuth with GitHub

**Why:**
- Covers 95% of users
- Low friction onboarding
- Industry standard

**Implementation:**
```
Library: Passport.js (Node) or Authlib (Python)
Password hashing: bcrypt (cost factor 12)
Sessions: JWT (15-min access, 7-day refresh)
Storage: Redis for refresh tokens
```

### Social Auth Priority

| Provider | Priority | Reason |
|----------|----------|--------|
| Google | 1st | Widest adoption, easy OAuth |
| GitHub | 2nd | Developer audience |
| Microsoft | 3rd | Enterprise users |
| Magic Link | 4th | Passwordless trend |

### Single Sign-On (SSO) ❌ NOT FOR MVP

**Defer SSO until:**
- ✅ Have enterprise customers
- ✅ They explicitly require it
- ✅ Willing to pay premium ($500+/month)

**Why defer:**
- Complex to implement (SAML, OIDC)
- Costly to maintain
- Only needed by enterprises
- Can add in 6-12 months

---

## Decision 5: Caching Strategy

### Redis ✅ REQUIRED

**Use Redis for:**
- ✅ Session storage (JWT refresh tokens)
- ✅ Rate limiting (token bucket)
- ✅ Job queue (exports, emails)
- ✅ Query caching (hot prompts, popular searches)

**Why Redis:**
- Extremely fast (in-memory)
- Proven at scale
- Rich data structures
- Built-in expiration

**Hosting:**
- MVP: Redis Labs free tier or DigitalOcean
- Scale: AWS ElastiCache or Redis Enterprise

### What to Cache

**Always cache:**
- Rate limit counters (expire: 1 hour)
- Session tokens (expire: 7 days)
- Popular search results (expire: 5 minutes)
- User permissions (expire: 1 minute)

**Never cache:**
- Prompt content (source of truth is PostgreSQL)
- Financial data
- Real-time collaboration state

### Cache Invalidation Strategy

**Simple approach (MVP):**
```
Cache key pattern: {entity}:{id}:{version}

On update:
1. Increment version in Redis
2. Old cache entries auto-expire
3. New requests use new version
```

**Example:**
```python
# Get cached prompt
cache_key = f"prompt:{prompt_id}:v{version}"
cached = redis.get(cache_key)

# On update
new_version = redis.incr(f"prompt:{prompt_id}:version")
redis.delete(f"prompt:{prompt_id}:v{old_version}")
```

---

## Decision 6: File Storage

### Object Storage (S3-compatible) ✅ RECOMMENDED

**Use S3 or compatible for:**
- ✅ Exported files (JSON, YAML, CSV)
- ✅ Backup archives
- ✅ User uploads (future: images in prompts)
- ✅ Generated reports

**Options:**

| Service | Cost | Pros | Cons |
|---------|------|------|------|
| AWS S3 | $0.023/GB | Industry standard, integrations | Slightly expensive |
| DigitalOcean Spaces | $5/month (250GB) | Simple, predictable pricing | Smaller ecosystem |
| Backblaze B2 | $0.005/GB | Cheapest | Less known |
| Cloudflare R2 | $0.015/GB | No egress fees | Newer service |

**Recommendation:**
- MVP: DigitalOcean Spaces (simple, flat pricing)
- Scale: AWS S3 (better integrations, CDN)

### Local File System ❌ AVOID

**Don't store files locally because:**
- ❌ Hard to scale (no shared filesystem)
- ❌ Backups are complex
- ❌ No CDN integration
- ❌ Loss on server failure

**Exception:** Temporary files (delete after processing)

---

## Decision 7: Real-Time Collaboration

### Defer to Post-MVP ✅ RECOMMENDED

**Why not in MVP:**
- ❌ High complexity (WebSockets, conflict resolution)
- ❌ Users can live without it initially
- ❌ Adds infrastructure costs
- ❌ Extends timeline by 4-6 weeks

**When to add:**
- ✅ Users explicitly request it
- ✅ Competing products have it
- ✅ Have stable MVP with users
- ✅ Budget for 2+ months of development

### When you do build it...

**Option 1: Build from scratch**
- Use WebSockets (Socket.io or native)
- Implement Operational Transform (OT) or CRDT
- Handle conflict resolution
- Complexity: Very High
- Time: 2-3 months

**Option 2: Use library**
- Y.js (CRDT library)
- ShareDB (OT library)
- Complexity: High
- Time: 1-2 months

**Option 3: Third-party service**
- Liveblocks ($49/month+)
- PartyKit ($10/month+)
- Pusher ($49/month+)
- Complexity: Low
- Time: 2-4 weeks

**Recommendation:** Use third-party service (Liveblocks or PartyKit) when you add real-time

---

## Decision 8: API Design

### REST API (MVP) + GraphQL (v2.0) ✅

**MVP: REST API**
```
GET    /api/v1/prompts              # List prompts
POST   /api/v1/prompts              # Create prompt
GET    /api/v1/prompts/{id}         # Get prompt
PUT    /api/v1/prompts/{id}         # Update prompt
DELETE /api/v1/prompts/{id}         # Delete prompt

GET    /api/v1/workspaces/{id}/prompts  # List workspace prompts
POST   /api/v1/search               # Search prompts
```

**Why REST for MVP:**
- ✅ Simple to implement
- ✅ Easy to understand
- ✅ Great tooling (Swagger/OpenAPI)
- ✅ Familiar to developers

**Add GraphQL in v2.0:**
```graphql
query GetWorkspace($id: ID!) {
  workspace(id: $id) {
    id
    name
    collections {
      id
      name
      prompts(limit: 50) {
        id
        title
        content
        tags
      }
    }
  }
}
```

**Why add GraphQL:**
- ✅ Flexible queries (get exactly what you need)
- ✅ Reduces over-fetching
- ✅ Single request for complex data
- ✅ Great for mobile apps

**When to add:** After MVP, when users complain about too many API calls

---

## Decision 9: Deployment

### MVP: Platform-as-a-Service ✅

**Recommended: DigitalOcean App Platform**

**Why:**
- ✅ Simple deployment (git push)
- ✅ Predictable pricing ($12-50/month)
- ✅ Managed PostgreSQL available
- ✅ Built-in SSL
- ✅ Easy scaling

**Alternatives:**
- Render ($7-25/month) - Good free tier
- Railway ($5-30/month) - Developer-friendly
- Heroku ($7-25/month) - Most established (expensive)
- Fly.io ($0-20/month) - Great for global apps

### Scale: Container Orchestration

**When to move:**
- ✅ Spending >$500/month on PaaS
- ✅ Need custom infrastructure
- ✅ Have DevOps expertise

**Options:**
- AWS ECS (managed containers)
- AWS EKS (managed Kubernetes)
- GCP Cloud Run (serverless containers)

**Complexity jump:** 3-5x more DevOps work

---

## Decision 10: Monitoring & Observability

### Essential for MVP ✅

**Error Tracking: Sentry**
- ✅ Free tier (5K errors/month)
- ✅ Source maps for frontend
- ✅ Stack traces for backend
- ✅ User context

**Performance: DataDog or New Relic**
- ⭐ DataDog (free 14-day trial, then $15/host/month)
- ⭐ New Relic (100GB free/month)

**User Analytics: PostHog**
- ✅ Open source option (self-hosted)
- ✅ Cloud option ($0-100/month)
- ✅ Feature flags
- ✅ Session recordings
- ✅ Funnels

**Uptime Monitoring: UptimeRobot**
- ✅ Free tier (50 monitors)
- ✅ 5-minute checks
- ✅ Email/SMS alerts

### Don't Skip

**Monitoring prevents:**
- ❌ Silent failures
- ❌ Slow performance going unnoticed
- ❌ Users churning due to bugs
- ❌ Downtime without awareness

**Minimum setup time:** 4-8 hours  
**Worth it:** Absolutely yes

---

## Decision 11: Testing Strategy

### MVP Testing Priorities

**Must Have:**
1. ✅ API integration tests (auth, CRUD, permissions)
2. ✅ Database migration tests
3. ✅ Core business logic unit tests

**Nice to Have:**
4. ⭐ Frontend component tests
5. ⭐ End-to-end tests (critical paths)

**Skip for MVP:**
6. ❌ 100% code coverage
7. ❌ Full E2E test suite
8. ❌ Visual regression tests

### Testing Stack

**Backend:**
```python
# Python
pytest                  # Test runner
pytest-asyncio         # Async test support
httpx                  # API testing
factory_boy            # Test data factories

# Node.js
jest                   # Test runner
supertest              # API testing
@faker-js/faker        # Test data
```

**Frontend:**
```javascript
vitest                 # Test runner (faster than Jest)
@testing-library/react # Component testing
@testing-library/user-event  # User interaction
msw                    # API mocking
```

### Coverage Target

**MVP:**
- Backend: 60-70% (focus on business logic)
- Frontend: 40-50% (focus on shared components)

**Post-MVP:**
- Backend: 80%+
- Frontend: 70%+

---

## Decision 12: Rate Limiting

### Token Bucket with Redis ✅

**Implementation:**
```python
def check_rate_limit(user_id: str, tier: str = "free") -> dict:
    limits = {
        "free": {"requests": 100, "window": 3600},      # 100/hour
        "pro": {"requests": 1000, "window": 3600},      # 1000/hour
        "team": {"requests": 5000, "window": 3600},     # 5000/hour
    }
    
    config = limits[tier]
    key = f"rate_limit:{tier}:{user_id}:{int(time.time() / config['window'])}"
    
    current = redis.incr(key)
    redis.expire(key, config["window"])
    
    return {
        "allowed": current <= config["requests"],
        "limit": config["requests"],
        "remaining": max(0, config["requests"] - current),
        "reset_at": (int(time.time() / config["window"]) + 1) * config["window"]
    }
```

### Rate Limit Tiers

| Tier | Requests/Hour | Requests/Day | Prompts | Cost |
|------|---------------|--------------|---------|------|
| Free | 100 | 1,000 | 1,000 | $0 |
| Pro | 1,000 | 20,000 | Unlimited | $10/month |
| Team | 5,000 | 100,000 | Unlimited | $49/month |
| Enterprise | Custom | Custom | Unlimited | Custom |

### Per-Endpoint Limits

**Expensive operations:**
- POST /export: 10/hour (generates large files)
- POST /import: 10/hour (database intensive)
- POST /search: 200/hour (higher, but still limited)

**Regular operations:**
- GET requests: Use tier limits
- POST /prompts: 50/hour (creation)
- PUT/DELETE: Use tier limits

---

## Decision 13: Version Control Implementation

### Application-Level Versioning ✅ RECOMMENDED

**Approach:**
- Store version history in `prompt_versions` table
- Increment version on each save
- Keep full content snapshot (not diffs)

**Why:**
- ✅ Simple to implement
- ✅ Fast to query
- ✅ No Git dependency
- ✅ Easy to show diffs in UI

**Schema:**
```sql
CREATE TABLE prompt_versions (
    id UUID PRIMARY KEY,
    prompt_id UUID REFERENCES prompts(id),
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    title VARCHAR(500),
    metadata JSONB,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    change_note TEXT,
    UNIQUE(prompt_id, version)
);
```

### Git Integration ❌ NOT FOR MVP

**Defer Git sync until:**
- Users request it
- Have developer-heavy user base
- V2.0 or later

**When you add it:**
- Allow sync to GitHub repo
- Two-way sync (repo ↔ library)
- Resolve conflicts (Git wins vs Library wins)

---

## Decision 14: Data Export Format

### Support Multiple Formats ✅

**Priority Order:**
1. **JSON** (primary, lossless)
2. **YAML** (developer-friendly)
3. **CSV** (spreadsheet users)
4. **Markdown** (documentation)

**JSON Format:**
```json
{
  "version": "1.0",
  "exported_at": "2024-12-12T10:00:00Z",
  "workspace": {
    "id": "ws_123",
    "name": "Marketing Prompts",
    "collections": [
      {
        "id": "col_456",
        "name": "Email Templates",
        "prompts": [
          {
            "id": "prm_789",
            "title": "Welcome Email",
            "content": "Hello {{name}}!",
            "tags": ["email", "welcome"],
            "metadata": {...},
            "versions": [...]
          }
        ]
      }
    ]
  }
}
```

**Why multiple formats:**
- ✅ Users have different needs
- ✅ JSON for backup/restore
- ✅ YAML for Git storage
- ✅ CSV for analysis
- ✅ Markdown for sharing

---

## Quick Decision Checklist

When facing a technical decision, ask:

1. **Does it solve a real user problem?**
   - ✅ Yes → Consider it
   - ❌ No → Skip for now

2. **Is it required for MVP?**
   - ✅ Yes → Build it simple
   - ❌ No → Defer to v2.0

3. **What's the complexity?**
   - Low → Build it
   - Medium → Evaluate carefully
   - High → Find simpler alternative or defer

4. **What's the opportunity cost?**
   - If it delays MVP by >2 weeks → Probably skip

5. **Can users live without it?**
   - ✅ Yes → Defer
   - ❌ No → Must have

---

## Anti-Patterns to Avoid

**❌ Over-engineering**
- Don't build microservices for MVP
- Don't implement real-time when async is fine
- Don't use Kubernetes for 100 users

**❌ Under-engineering**
- Don't skip authentication
- Don't skip rate limiting
- Don't skip backups
- Don't skip monitoring

**❌ Wrong priorities**
- Don't polish UI before validating core value
- Don't build CLI before web UI works
- Don't add social features before core features work

**❌ Technology decisions**
- Don't use NoSQL for relational data
- Don't skip PostgreSQL full-text search
- Don't build custom auth (use library)
- Don't skip Redis (it's essential)

---

## When in Doubt

**Default to:**
- ✅ Boring technology (PostgreSQL, Redis, React)
- ✅ Proven patterns (REST API, JWT auth, RBAC)
- ✅ Simple implementations (MVP mindset)
- ✅ Deferring complexity (add later if needed)

**Ask yourself:**
- "Will this delay MVP?"
- "Can I add this in v2.0?"
- "Is there a simpler way?"
- "What would Postman do?"

---

**Remember:** The goal is to launch a working product in 3 months, not to build the perfect architecture. You can refactor later based on real usage.

*See PROMPT-LIBRARY-RESEARCH.md for detailed rationale behind these decisions.*

