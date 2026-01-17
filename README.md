# Gmail MCP Server

A Model Context Protocol (MCP) server that provides Gmail access for Claude Code and other MCP-compatible clients.

## Features

- List emails from any folder (inbox, sent, unread, starred, etc.)
- Read full email content
- Send emails with automatic signature
- Reply to threads with proper threading headers
- Search using Gmail's query syntax
- Manage labels (star, archive, mark read/unread)

## Prerequisites

- Node.js 20 or higher
- A Google Cloud project with Gmail API enabled
- OAuth 2.0 credentials (Desktop app type)

## Setup

### 1. Create a Google Cloud Project

If you don't have one already:

```bash
gcloud projects create your-project-name --name="Your MCP Tools"
gcloud config set project your-project-name
gcloud services enable gmail.googleapis.com
```

### 2. Configure OAuth Consent Screen

1. Go to [Google Cloud Console - OAuth Consent](https://console.cloud.google.com/apis/credentials/consent)
2. Select **Internal** (for Google Workspace) or **External** (for personal Gmail)
3. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`

### 3. Create OAuth Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Desktop app** as the application type
4. Download the JSON file
5. Save it as `~/.mcp-gmail/credentials.json`

### 4. Install and Build

```bash
git clone https://github.com/brentwpeterson/mcp-gmail.git
cd mcp-gmail
npm install
npm run build
```

### 5. Authenticate

```bash
npm run auth
```

This opens a browser for Google OAuth. Approve the permissions, and tokens will be saved to `~/.mcp-gmail/token.json`.

### 6. Configure Your MCP Client

Add to your MCP configuration file (e.g., `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-gmail/dist/index.js"]
    }
  }
}
```

Restart your MCP client to load the server.

## Available Tools

| Tool | Description |
|------|-------------|
| `gmail_list_emails` | List recent emails with optional folder and search query |
| `gmail_get_email` | Get full content of a specific email |
| `gmail_send_email` | Send a new email or reply to a thread |
| `gmail_search` | Search emails using Gmail query syntax |
| `gmail_get_thread` | Get all messages in a conversation |
| `gmail_modify_labels` | Add/remove labels (read, star, archive) |
| `gmail_list_labels` | List all available labels |

## Folder Options

The `gmail_list_emails` tool supports these folders:

| Folder | Description |
|--------|-------------|
| `inbox` (default) | Inbox emails |
| `sent` | Sent emails |
| `unread` | Unread inbox emails |
| `starred` | Starred emails |
| `important` | Important emails |
| `trash` | Deleted emails |
| `spam` | Spam folder |
| `all` | All emails (no filter) |

## Gmail Search Syntax

The `gmail_search` tool and `query` parameter support Gmail's search syntax:

- `from:user@example.com` - From specific sender
- `to:user@example.com` - To specific recipient
- `subject:meeting` - Subject contains word
- `is:unread` - Unread messages
- `is:starred` - Starred messages
- `has:attachment` - Has attachments
- `newer_than:2d` - Newer than 2 days
- `older_than:1w` - Older than 1 week
- `label:work` - Has specific label

Combine with spaces (AND) or `OR`: `from:boss@work.com is:unread`

## Configuration

Environment variables (optional):

| Variable | Description | Default |
|----------|-------------|---------|
| `GMAIL_CONFIG_DIR` | Config directory | `~/.mcp-gmail` |
| `GMAIL_CREDENTIALS_PATH` | Path to credentials.json | `~/.mcp-gmail/credentials.json` |

## How It Works

- **Signatures**: Automatically fetched from your Gmail "Send mail as" settings
- **Thread Replies**: Proper `In-Reply-To` and `References` headers for correct threading
- **Sender Name**: Uses your display name from Gmail settings

## Security

- OAuth tokens are stored locally in `~/.mcp-gmail/token.json`
- Credentials and tokens are never committed (see `.gitignore`)
- Only you can access your email through this server
- Tokens can be revoked at any time from [Google Account Permissions](https://myaccount.google.com/permissions)

## License

MIT
