CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT DEFAULT '', lang TEXT DEFAULT '', format TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, r2_key TEXT NOT NULL, cover_key TEXT, pages INTEGER DEFAULT 0, tags TEXT DEFAULT '[]', visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private','public')), in_shelf INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_books_visibility ON books(visibility);
CREATE INDEX idx_books_created ON books(created_at DESC);
CREATE TABLE progress (book_id TEXT PRIMARY KEY, location TEXT DEFAULT '', percent REAL DEFAULT 0, updated_at INTEGER NOT NULL);
