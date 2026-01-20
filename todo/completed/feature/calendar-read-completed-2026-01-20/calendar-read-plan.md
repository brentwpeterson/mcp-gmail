# Calendar Read - Implementation Plan

## Current State Analysis

The Gmail MCP server (`mcp-servers/gmail/`) is already set up with:
- OAuth2 authentication via `googleapis` library
- MCP SDK integration for tool definitions
- Token storage at `~/.mcp-gmail/token.json`
- Credentials at `~/.mcp-gmail/credentials.json`

The `googleapis` package already includes the Calendar API, so no new dependencies needed.

## Implementation Approach

### 1. Add Calendar Scope to OAuth

**File:** `src/auth.ts` and `src/index.ts`

Add the calendar readonly scope:
```typescript
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",  // NEW
];
```

**Note:** User will need to re-authenticate to grant calendar permission.

### 2. Add Calendar Client Helper

**File:** `src/index.ts`

```typescript
async function getCalendarClient() {
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: "v3", auth });
}
```

### 3. Implement Calendar Functions

**File:** `src/index.ts`

#### `listCalendars()`
- Call `calendarList.list()`
- Return: id, summary, description, accessRole, primary flag

#### `listEvents(calendarId?, timeMin?, timeMax?, maxResults?)`
- Default calendarId to "primary"
- Default timeMin to now, timeMax to 7 days from now
- Call `events.list()` with `singleEvents: true`, `orderBy: "startTime"`
- Return: id, summary, start, end, location, description, attendees, status

#### `getEvent(calendarId, eventId)`
- Call `events.get()`
- Return full event details

### 4. Register MCP Tools

Add three new tools:
1. `gcal_list_calendars` - No required params
2. `gcal_list_events` - Optional: calendarId, timeMin, timeMax, maxResults
3. `gcal_get_event` - Required: eventId; Optional: calendarId

### 5. Add Tool Handlers

Add cases to the `CallToolRequestSchema` handler switch statement.

## File Changes Summary

| File | Changes |
|------|---------|
| `src/index.ts` | Add scope, calendar client, 3 functions, 3 tools, 3 handlers |
| `src/auth.ts` | Add calendar scope |
| `package.json` | Bump version to 0.3.0 |

## Considerations

### Re-authentication Required
Users will need to run `npm run auth` again to grant calendar permissions. The auth script already handles this gracefully (prompts "Do you want to re-authenticate?").

### Package Name
Consider renaming from `mcp-gmail` to `mcp-google` since it now handles multiple Google services. This is optional and could be a future change.

### Error Handling
Calendar API errors should be caught and returned in the same format as Gmail errors.

## Decisions Made

- **Package name:** Keep as `mcp-gmail`
- **Tool prefix:** Use `gcal_` (e.g., `gcal_list_events`)

## Future Considerations

- Creating/updating calendar events (separate feature, would need write scope)
