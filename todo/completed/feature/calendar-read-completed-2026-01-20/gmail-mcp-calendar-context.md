# Resume Instructions for Claude

## IMMEDIATE SETUP
1. **Directory:** `cd /Users/brent/scripts/CB-Workspace/mcp-servers/gmail`
2. **Branch:** `git checkout feature/calendar-read`
3. **Last Commit:** `e111691 Add Google Calendar read support (v0.3.0)`

## SESSION METADATA
**Saved:** 2026-01-19
**MCP Entity:** gmail-mcp-calendar

## CURRENT TODO
**Path:** `todo/current/feature/calendar-read/`
**Status:** Implementation complete, ready for user testing

## WHAT WAS DONE
Added Google Calendar read functionality to the Gmail MCP server:

1. **Added OAuth scope:** `calendar.readonly` to both `auth.ts` and `index.ts`
2. **Added calendar client helper:** `getCalendarClient()` function
3. **Implemented 3 new tools:**
   - `gcal_list_calendars` - Lists all accessible calendars (primary + shared)
   - `gcal_list_events` - Lists upcoming events (default: next 7 days)
   - `gcal_get_event` - Gets full details of a specific event
4. **Registered MCP tools and handlers** in the server
5. **Bumped version** to 0.3.0
6. **Built successfully** with `npm run build`
7. **Re-authenticated** - User completed OAuth flow with new calendar scope

## ACCEPTANCE CRITERIA
- [ ] Can list upcoming calendar events for configurable time range (default: 7 days)
- [ ] Can get full details of a specific calendar event by ID
- [ ] Events include essential fields: title, start/end time, location, description, attendees
- [ ] Can list available calendars (primary and shared)

## NEXT ACTIONS
1. **User needs to restart Claude Code** to reload the MCP server with new calendar tools
2. **Test the tools:**
   - `gcal_list_calendars` - should show user's calendars
   - `gcal_list_events` - should show upcoming events
   - `gcal_get_event` with an event ID - should show full details
3. **Mark criteria as passed** after user confirms testing
4. **Run `/claude-complete`** when all criteria verified

## KEY FILES
- `src/index.ts` - Main MCP server with calendar functions and tools
- `src/auth.ts` - OAuth auth script with calendar scope
- `package.json` - Version 0.3.0
- `todo/current/feature/calendar-read/success-criteria.md` - Acceptance criteria

## NOTES
- User decided: Keep package name as `mcp-gmail` (not rename to mcp-google)
- User decided: Use `gcal_` prefix for calendar tools
- No git remote configured for this repo (local only)
