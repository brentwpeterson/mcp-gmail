# Calendar Read - Success Criteria

**Branch:** feature/calendar-read
**Created:** 2026-01-19

## Acceptance Criteria

- [ ] Can list upcoming calendar events for configurable time range (default: next 7 days)
- [ ] Can get full details of a specific calendar event by ID
- [ ] Events include essential fields: title, start/end time, location, description, attendees
- [ ] Can list available calendars (primary and shared)

## Verification Commands

```bash
# Build the project
cd mcp-servers/gmail && npm run build

# Re-authenticate to grant calendar scope
npm run auth

# Test via Claude Code (after restarting to load updated MCP)
# - gcal_list_calendars
# - gcal_list_events
# - gcal_get_event with an event ID from list
```

## Verification Status

| Criterion | Local | Production | Verified By |
|-----------|-------|------------|-------------|
| List events with time range | ⏳ | N/A | |
| Get event details | ⏳ | N/A | |
| Events have essential fields | ⏳ | N/A | |
| List calendars | ⏳ | N/A | |

**Legend:** ⏳ Pending | ✅ Passed | ❌ Failed

## Completion Checklist

- [ ] All criteria verified locally
- [ ] User confirmed in testing
- [ ] No regressions introduced
- [ ] Ready for /claude-complete
