# Calendar Read - Notes

## Discovery Notes

### Current Gmail MCP Structure
- Located at: `mcp-servers/gmail/`
- Version: 0.2.0
- Uses MCP SDK 1.0.0 with `googleapis` 144.0.0
- Auth stored in `~/.mcp-gmail/`
- 14 Gmail tools already implemented

### Google Calendar API
- Part of `googleapis` package (already installed)
- Calendar API v3
- Readonly scope: `https://www.googleapis.com/auth/calendar.readonly`

### Key Decisions

**Package Name:** Keep as `mcp-gmail` (avoid breaking change)

**Tool Naming:** Use `gcal_` prefix (e.g., `gcal_list_events`, `gcal_get_event`)

**Default Time Range:** 7 days is reasonable for "upcoming events" use case
