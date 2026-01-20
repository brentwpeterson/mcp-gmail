# Calendar Read

**Branch:** feature/calendar-read
**Status:** IN PROGRESS
**Category:** Feature
**Created:** 2026-01-19

## Overview

Add Google Calendar read functionality to the existing Gmail MCP server. This will allow Claude to list and view calendar events, helping with schedule awareness and meeting context.

## Acceptance Criteria

See `success-criteria.md` for full criteria and verification status.

**Quick View:**
- [ ] Can list upcoming calendar events for configurable time range (default: 7 days)
- [ ] Can get full details of a specific calendar event by ID
- [ ] Events include essential fields: title, start/end time, location, description, attendees
- [ ] Can list available calendars (primary and shared)

## Files

- [x] README.md - This file
- [x] success-criteria.md - Acceptance criteria
- [x] calendar-read-plan.md - Implementation plan
- [ ] progress.log - Progress tracking
- [ ] debug.log - Debug attempts
- [x] notes.md - Notes and discoveries

## Quick Commands

```bash
# Check branch
git branch --show-current

# Build
npm run build

# Test auth (will prompt to re-auth for calendar scope)
npm run auth
```
