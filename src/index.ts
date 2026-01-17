#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";

// Configuration paths
const CONFIG_DIR = process.env.GMAIL_CONFIG_DIR || path.join(process.env.HOME || "", ".mcp-gmail");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, "credentials.json");

// Gmail API scopes
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

let oauth2Client: OAuth2Client | null = null;

async function getAuthenticatedClient(): Promise<OAuth2Client> {
  if (oauth2Client) return oauth2Client;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Credentials file not found at ${CREDENTIALS_PATH}. ` +
      `Download OAuth credentials from Google Cloud Console and save them there.`
    );
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oauth2Client.setCredentials(token);
  } else {
    throw new Error(
      `No token found. Run 'npm run auth' in the mcp-gmail directory to authenticate first.`
    );
  }

  return oauth2Client;
}

async function getGmailClient() {
  const auth = await getAuthenticatedClient();
  return google.gmail({ version: "v1", auth });
}

// Cache for sender settings to avoid repeated API calls
interface SenderSettings {
  displayName: string;
  email: string;
  signatureHtml: string; // Raw HTML signature for HTML emails
}
let cachedSenderSettings: SenderSettings | null = null;

async function getSenderSettings(): Promise<SenderSettings> {
  if (cachedSenderSettings !== null) return cachedSenderSettings;

  const gmail = await getGmailClient();
  const response = await gmail.users.settings.sendAs.list({ userId: "me" });

  // Find the primary send-as (default) or first one
  const sendAsSettings = response.data.sendAs || [];
  const primary = sendAsSettings.find(s => s.isDefault) || sendAsSettings[0];

  // Debug: log what we're getting from the API
  console.error("SendAs settings found:", JSON.stringify({
    displayName: primary?.displayName,
    email: primary?.sendAsEmail,
    isDefault: primary?.isDefault,
    hasSignature: !!primary?.signature,
  }, null, 2));

  cachedSenderSettings = {
    displayName: primary?.displayName || "",
    email: primary?.sendAsEmail || "",
    signatureHtml: primary?.signature || "", // Keep raw HTML
  };

  return cachedSenderSettings;
}

async function getMessageHeaders(messageId: string): Promise<{ messageId: string; references: string }> {
  const gmail = await getGmailClient();
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Message-ID", "References"],
  });

  const headers = response.data.payload?.headers || [];
  const msgId = headers.find(h => h.name === "Message-ID")?.value || "";
  const refs = headers.find(h => h.name === "References")?.value || "";

  return { messageId: msgId, references: refs };
}

// Folder to query mapping
const FOLDER_QUERIES: Record<string, string> = {
  inbox: "in:inbox",
  sent: "in:sent",
  unread: "in:inbox is:unread",
  starred: "is:starred",
  important: "is:important",
  trash: "in:trash",
  spam: "in:spam",
  all: "", // No filter - returns everything
};

// Tool implementations
async function listEmails(maxResults: number = 10, folder: string = "inbox", query?: string) {
  const gmail = await getGmailClient();

  // Build the query: combine folder query with custom query if provided
  const folderQuery = FOLDER_QUERIES[folder] || FOLDER_QUERIES.inbox;
  const finalQuery = query ? `${folderQuery} ${query}`.trim() : folderQuery;

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: finalQuery || undefined,
  });

  const messages = response.data.messages || [];
  const emails = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    emails.push({
      id: msg.id,
      threadId: msg.threadId,
      snippet: detail.data.snippet,
      from: headers.find((h) => h.name === "From")?.value,
      to: headers.find((h) => h.name === "To")?.value,
      subject: headers.find((h) => h.name === "Subject")?.value,
      date: headers.find((h) => h.name === "Date")?.value,
      labelIds: detail.data.labelIds,
    });
  }

  return emails;
}

async function getEmail(messageId: string) {
  const gmail = await getGmailClient();
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = response.data.payload?.headers || [];

  // Extract body
  let body = "";
  const payload = response.data.payload;

  if (payload?.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
  } else if (payload?.parts) {
    const textPart = payload.parts.find(
      (p) => p.mimeType === "text/plain" || p.mimeType === "text/html"
    );
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }
  }

  return {
    id: response.data.id,
    threadId: response.data.threadId,
    from: headers.find((h) => h.name === "From")?.value,
    to: headers.find((h) => h.name === "To")?.value,
    subject: headers.find((h) => h.name === "Subject")?.value,
    date: headers.find((h) => h.name === "Date")?.value,
    body,
    labelIds: response.data.labelIds,
  };
}

async function sendEmail(to: string, subject: string, body: string, threadId?: string, originalMessageId?: string) {
  const gmail = await getGmailClient();

  // Get sender settings (name, email, signature)
  const sender = await getSenderSettings();

  // Convert plain text body to HTML (escape HTML chars and preserve line breaks)
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>\n");

  // Build HTML email body with signature
  const htmlBody = sender.signatureHtml
    ? `<div>${bodyHtml}</div><br><div>--</div><br>${sender.signatureHtml}`
    : `<div>${bodyHtml}</div>`;

  // Build From header with display name
  const fromHeader = sender.displayName
    ? `From: ${sender.displayName} <${sender.email}>`
    : `From: ${sender.email}`;

  // Build headers
  const headers: string[] = [
    fromHeader,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
  ];

  // If replying to a thread, add threading headers
  if (threadId && originalMessageId) {
    // Fetch original message headers for proper threading
    const originalHeaders = await getMessageHeaders(originalMessageId);

    if (originalHeaders.messageId) {
      headers.push(`In-Reply-To: ${originalHeaders.messageId}`);

      // Build References header (original references + original message ID)
      const references = originalHeaders.references
        ? `${originalHeaders.references} ${originalHeaders.messageId}`
        : originalHeaders.messageId;
      headers.push(`References: ${references}`);
    }
  }

  const message = [...headers, "", htmlBody].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
      threadId,
    },
  });

  return { id: response.data.id, threadId: response.data.threadId };
}

async function searchEmails(query: string, maxResults: number = 20) {
  return listEmails(maxResults, query);
}

async function getThread(threadId: string) {
  const gmail = await getGmailClient();
  const response = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  });

  const messages = response.data.messages || [];
  return {
    id: response.data.id,
    messages: messages.map((msg) => {
      const headers = msg.payload?.headers || [];
      return {
        id: msg.id,
        snippet: msg.snippet,
        from: headers.find((h) => h.name === "From")?.value,
        to: headers.find((h) => h.name === "To")?.value,
        subject: headers.find((h) => h.name === "Subject")?.value,
        date: headers.find((h) => h.name === "Date")?.value,
      };
    }),
  };
}

async function modifyLabels(messageId: string, addLabels: string[], removeLabels: string[]) {
  const gmail = await getGmailClient();
  const response = await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: addLabels,
      removeLabelIds: removeLabels,
    },
  });

  return { id: response.data.id, labelIds: response.data.labelIds };
}

async function listLabels() {
  const gmail = await getGmailClient();
  const response = await gmail.users.labels.list({ userId: "me" });
  return response.data.labels || [];
}

// MCP Server setup
const server = new Server(
  {
    name: "gmail",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "gmail_list_emails",
      description: "List recent emails from a specified folder. Defaults to inbox.",
      inputSchema: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            enum: ["inbox", "sent", "unread", "starred", "important", "trash", "spam", "all"],
            description: "Email folder to list (default: inbox)",
            default: "inbox",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of emails to return (default: 10, max: 50)",
            default: 10,
          },
          query: {
            type: "string",
            description: "Additional Gmail search query to filter results (e.g., 'from:someone@example.com', 'subject:hello')",
          },
        },
      },
    },
    {
      name: "gmail_get_email",
      description: "Get the full content of a specific email by its message ID",
      inputSchema: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The ID of the email message to retrieve",
          },
        },
        required: ["messageId"],
      },
    },
    {
      name: "gmail_send_email",
      description: "Send a new email or reply to an existing thread. When replying, provide both threadId and replyToMessageId for proper threading.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body content (plain text). Signature will be auto-appended.",
          },
          threadId: {
            type: "string",
            description: "Optional thread ID to reply to an existing conversation",
          },
          replyToMessageId: {
            type: "string",
            description: "The message ID of the email being replied to (required for proper threading)",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "gmail_search",
      description: "Search emails using Gmail's powerful search syntax",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query. Examples: 'from:user@example.com', 'is:unread', 'has:attachment', 'newer_than:2d', 'subject:meeting'",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results (default: 20)",
            default: 20,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "gmail_get_thread",
      description: "Get all messages in an email thread/conversation",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "The ID of the thread to retrieve",
          },
        },
        required: ["threadId"],
      },
    },
    {
      name: "gmail_modify_labels",
      description: "Add or remove labels from an email (e.g., mark as read, archive, star)",
      inputSchema: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The ID of the email message",
          },
          addLabels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to add (e.g., 'STARRED', 'IMPORTANT')",
          },
          removeLabels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to remove (e.g., 'UNREAD', 'INBOX' for archive)",
          },
        },
        required: ["messageId"],
      },
    },
    {
      name: "gmail_list_labels",
      description: "List all available Gmail labels in the account",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "gmail_list_emails": {
        const result = await listEmails(
          args?.maxResults as number | undefined,
          (args?.folder as string) || "inbox",
          args?.query as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_get_email": {
        const result = await getEmail(args?.messageId as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_send_email": {
        const result = await sendEmail(
          args?.to as string,
          args?.subject as string,
          args?.body as string,
          args?.threadId as string | undefined,
          args?.replyToMessageId as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_search": {
        const result = await searchEmails(
          args?.query as string,
          args?.maxResults as number | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_get_thread": {
        const result = await getThread(args?.threadId as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_modify_labels": {
        const result = await modifyLabels(
          args?.messageId as string,
          (args?.addLabels as string[]) || [],
          (args?.removeLabels as string[]) || []
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_list_labels": {
        const result = await listLabels();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gmail MCP server running");
}

main().catch(console.error);
