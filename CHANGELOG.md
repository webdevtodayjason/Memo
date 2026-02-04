# Changelog

All notable changes to OpenClaw-Mem will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-02-04

### Fixed
- Auto-capture no longer stores system/operational messages (heartbeat prompts, cron payloads, silver price checks) as observations
- `detectType()` no longer classifies operational text containing "need" as "preference" — now requires explicit preference language ("I like", "I want", "I prefer")
- `[message_id: ...]` metadata tags are now stripped from stored observations
- Added in-memory dedup to prevent the same content from being captured repeatedly across heartbeat cycles
- `CAPTURE_TRIGGERS` patterns tightened with word boundaries to reduce false positives

### Added
- `SYSTEM_MESSAGE_PATTERNS` filter to reject known system prompts before trigger matching
- `markCaptured()` / `textHash()` dedup system (tracks last 200 captures in memory)

## [0.1.1] - 2026-02-02

### Added
- Initial project structure
- SQLite database with FTS5 full-text search
- HTTP worker service on port 37778
- Session and observation tracking
- Search API with type/date filters
- Context injection for new sessions
- CLI tool (`openclaw-mem start/search/stats`)
- Lifecycle hooks for OpenClaw integration
- Architecture documentation
- Contributing guidelines
- GitHub issue templates
- CI workflow

### Credits
- Adapted from [Claude-Mem](https://github.com/thedotmack/claude-mem) by Alex Newman ([@thedotmack](https://github.com/thedotmack))

## [0.1.0] - 2026-02-02

### Added
- Initial release
- Core memory system with SQLite + FTS5
- HTTP API for observations and search
- Session management
- Context injection endpoint
- CLI for management

---

[Unreleased]: https://github.com/webdevtodayjason/openclaw_memory/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/webdevtodayjason/openclaw_memory/releases/tag/v0.1.0
