# Resume Instructions for Claude

## IMMEDIATE SETUP
1. **Directory:** `cd /Users/brent/scripts/CB-Workspace/mcp-servers/gmail`
2. **Branch:** `git checkout feature/calendar-read`
3. **Last Commit:** `fe136d3 Add Google Tasks full CRUD support (v0.4.0)`

## SESSION METADATA
**Saved:** 2026-01-20
**MCP Entity:** gmail-mcp-tasks

## WHAT WAS DONE THIS SESSION

### Google Calendar (v0.3.0 - Completed)
- Calendar API enabled in Google Cloud Console
- Tested `gcal_list_events` - working (showed tomorrow's 6 meetings)
- Added calendar check to `/brent-start` command (Step 3.7)
- Added TODAY'S CALENDAR section to dashboard

### Google Tasks (v0.4.0 - Implemented, Needs Testing)
Added full CRUD support for Google Tasks:

1. **OAuth scope added:** `https://www.googleapis.com/auth/tasks`
2. **New client helper:** `getTasksClient()` function
3. **7 new tools implemented:**
   - `gtasks_list_tasklists` - List all task lists
   - `gtasks_list_tasks` - List tasks (with filters for completed, due dates)
   - `gtasks_get_task` - Get task details
   - `gtasks_create_task` - Create new task
   - `gtasks_update_task` - Update task (title, notes, due, status)
   - `gtasks_complete_task` - Mark task complete
   - `gtasks_delete_task` - Delete task
4. **Version bumped** to 0.4.0
5. **Build successful** with `npm run build`

## NEXT ACTIONS (User must do before testing)

1. **Restart Claude Code** to load new OAuth token with Tasks scope

2. **Test Tasks tools after restart:**
   - `gtasks_list_tasklists` - should show task lists
   - `gtasks_list_tasks` - should show tasks
   - Try creating/completing/deleting a task

## CURRENT STATE
- Tasks API enabled in Google Cloud Console
- User re-authenticated with `npm run auth` (token saved)
- Claude Code needs restart to load new token

## KEY FILES
- `src/index.ts` - Main MCP server with all tools (1500+ lines)
- `src/auth.ts` - OAuth auth script with all scopes
- `package.json` - Version 0.4.0

## BRENT-START UPDATES
Updated `/brent-start` command with:
- **Step 3.7:** Pull today's calendar events via `gcal_list_events`
- **Dashboard section:** TODAY'S CALENDAR table with time, meeting, attendees

File modified: `/Users/brent/scripts/CB-Workspace/.claude-local/commands/brent-start.md`

## NOTES
- Package name remains `mcp-gmail` (covers Gmail, Calendar, Tasks)
- Tool prefixes: `gmail_`, `gcal_`, `gtasks_`
- No git remote configured for this repo (local only)
- Calendar acceptance criteria: Ready to mark complete after user confirms testing
- Tasks acceptance criteria: Pending user testing after API enable + re-auth + restart
