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
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
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

async function getCalendarClient() {
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: "v3", auth });
}

async function getTasksClient() {
  const auth = await getAuthenticatedClient();
  return google.tasks({ version: "v1", auth });
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

// Draft functions
async function listDrafts(maxResults: number = 10) {
  const gmail = await getGmailClient();
  const response = await gmail.users.drafts.list({
    userId: "me",
    maxResults,
  });

  const drafts = response.data.drafts || [];
  const draftDetails = [];

  for (const draft of drafts) {
    const detail = await gmail.users.drafts.get({
      userId: "me",
      id: draft.id!,
      format: "metadata",
    });

    const headers = detail.data.message?.payload?.headers || [];
    draftDetails.push({
      id: draft.id,
      messageId: detail.data.message?.id,
      threadId: detail.data.message?.threadId,
      snippet: detail.data.message?.snippet,
      to: headers.find((h) => h.name === "To")?.value,
      subject: headers.find((h) => h.name === "Subject")?.value,
      date: headers.find((h) => h.name === "Date")?.value,
    });
  }

  return draftDetails;
}

async function getDraft(draftId: string) {
  const gmail = await getGmailClient();
  const response = await gmail.users.drafts.get({
    userId: "me",
    id: draftId,
    format: "full",
  });

  const headers = response.data.message?.payload?.headers || [];

  // Extract body
  let body = "";
  const payload = response.data.message?.payload;

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
    messageId: response.data.message?.id,
    threadId: response.data.message?.threadId,
    to: headers.find((h) => h.name === "To")?.value,
    subject: headers.find((h) => h.name === "Subject")?.value,
    date: headers.find((h) => h.name === "Date")?.value,
    body,
  };
}

async function createDraft(to: string, subject: string, body: string, threadId?: string) {
  const gmail = await getGmailClient();

  // Get sender settings (name, email, signature)
  const sender = await getSenderSettings();

  // Convert plain text body to HTML
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

  const message = [
    fromHeader,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    htmlBody,
  ].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId,
      },
    },
  });

  return {
    id: response.data.id,
    messageId: response.data.message?.id,
    threadId: response.data.message?.threadId,
  };
}

async function updateDraft(draftId: string, to: string, subject: string, body: string, threadId?: string) {
  const gmail = await getGmailClient();

  // Get sender settings
  const sender = await getSenderSettings();

  // Convert plain text body to HTML
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>\n");

  const htmlBody = sender.signatureHtml
    ? `<div>${bodyHtml}</div><br><div>--</div><br>${sender.signatureHtml}`
    : `<div>${bodyHtml}</div>`;

  const fromHeader = sender.displayName
    ? `From: ${sender.displayName} <${sender.email}>`
    : `From: ${sender.email}`;

  const message = [
    fromHeader,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    htmlBody,
  ].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId,
      },
    },
  });

  return {
    id: response.data.id,
    messageId: response.data.message?.id,
    threadId: response.data.message?.threadId,
  };
}

async function deleteDraft(draftId: string) {
  const gmail = await getGmailClient();
  await gmail.users.drafts.delete({
    userId: "me",
    id: draftId,
  });
  return { deleted: true, id: draftId };
}

async function sendDraft(draftId: string) {
  const gmail = await getGmailClient();
  const response = await gmail.users.drafts.send({
    userId: "me",
    requestBody: {
      id: draftId,
    },
  });
  return {
    sent: true,
    messageId: response.data.id,
    threadId: response.data.threadId,
  };
}

// Calendar functions
async function listCalendars() {
  const calendar = await getCalendarClient();
  const response = await calendar.calendarList.list();

  const calendars = response.data.items || [];
  return calendars.map(cal => ({
    id: cal.id,
    summary: cal.summary,
    description: cal.description,
    primary: cal.primary || false,
    accessRole: cal.accessRole,
    backgroundColor: cal.backgroundColor,
  }));
}

async function listCalendarEvents(
  calendarId: string = "primary",
  timeMin?: string,
  timeMax?: string,
  maxResults: number = 50
) {
  const calendar = await getCalendarClient();

  // Default to now and 7 days from now
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId,
    timeMin: timeMin || now.toISOString(),
    timeMax: timeMax || weekFromNow.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items || [];
  return events.map(event => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    status: event.status,
    htmlLink: event.htmlLink,
    attendees: event.attendees?.map(a => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      organizer: a.organizer,
      self: a.self,
    })),
    organizer: event.organizer ? {
      email: event.organizer.email,
      displayName: event.organizer.displayName,
      self: event.organizer.self,
    } : undefined,
    creator: event.creator ? {
      email: event.creator.email,
      displayName: event.creator.displayName,
      self: event.creator.self,
    } : undefined,
  }));
}

async function getCalendarEvent(calendarId: string = "primary", eventId: string) {
  const calendar = await getCalendarClient();

  const response = await calendar.events.get({
    calendarId,
    eventId,
  });

  const event = response.data;
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    status: event.status,
    htmlLink: event.htmlLink,
    hangoutLink: event.hangoutLink,
    conferenceData: event.conferenceData,
    attendees: event.attendees?.map(a => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      organizer: a.organizer,
      self: a.self,
      comment: a.comment,
    })),
    organizer: event.organizer ? {
      email: event.organizer.email,
      displayName: event.organizer.displayName,
      self: event.organizer.self,
    } : undefined,
    creator: event.creator ? {
      email: event.creator.email,
      displayName: event.creator.displayName,
      self: event.creator.self,
    } : undefined,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    created: event.created,
    updated: event.updated,
  };
}

// Google Tasks functions
async function listTaskLists() {
  const tasks = await getTasksClient();
  const response = await tasks.tasklists.list({
    maxResults: 100,
  });

  const taskLists = response.data.items || [];
  return taskLists.map(list => ({
    id: list.id,
    title: list.title,
    updated: list.updated,
    selfLink: list.selfLink,
  }));
}

async function listTasks(
  taskListId: string = "@default",
  showCompleted: boolean = false,
  showHidden: boolean = false,
  dueMin?: string,
  dueMax?: string,
  maxResults: number = 100
) {
  const tasks = await getTasksClient();
  const response = await tasks.tasks.list({
    tasklist: taskListId,
    showCompleted,
    showHidden,
    dueMin,
    dueMax,
    maxResults,
  });

  const taskItems = response.data.items || [];
  return taskItems.map(task => ({
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    due: task.due,
    completed: task.completed,
    parent: task.parent,
    position: task.position,
    updated: task.updated,
    selfLink: task.selfLink,
    links: task.links,
  }));
}

async function getTask(taskListId: string = "@default", taskId: string) {
  const tasks = await getTasksClient();
  const response = await tasks.tasks.get({
    tasklist: taskListId,
    task: taskId,
  });

  const task = response.data;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    due: task.due,
    completed: task.completed,
    deleted: task.deleted,
    hidden: task.hidden,
    parent: task.parent,
    position: task.position,
    updated: task.updated,
    selfLink: task.selfLink,
    links: task.links,
  };
}

async function createTask(
  taskListId: string = "@default",
  title: string,
  notes?: string,
  due?: string,
  parent?: string
) {
  const tasks = await getTasksClient();
  const response = await tasks.tasks.insert({
    tasklist: taskListId,
    requestBody: {
      title,
      notes,
      due,
    },
    parent,
  });

  const task = response.data;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    due: task.due,
    updated: task.updated,
    selfLink: task.selfLink,
  };
}

async function updateTask(
  taskListId: string = "@default",
  taskId: string,
  title?: string,
  notes?: string,
  due?: string,
  status?: string
) {
  const tasks = await getTasksClient();

  // First get the current task to preserve fields we're not updating
  const current = await tasks.tasks.get({
    tasklist: taskListId,
    task: taskId,
  });

  const response = await tasks.tasks.update({
    tasklist: taskListId,
    task: taskId,
    requestBody: {
      id: taskId,
      title: title ?? current.data.title,
      notes: notes ?? current.data.notes,
      due: due ?? current.data.due,
      status: status ?? current.data.status,
    },
  });

  const task = response.data;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    due: task.due,
    completed: task.completed,
    updated: task.updated,
    selfLink: task.selfLink,
  };
}

async function completeTask(taskListId: string = "@default", taskId: string) {
  const tasks = await getTasksClient();

  // Get current task first
  const current = await tasks.tasks.get({
    tasklist: taskListId,
    task: taskId,
  });

  const response = await tasks.tasks.update({
    tasklist: taskListId,
    task: taskId,
    requestBody: {
      id: taskId,
      title: current.data.title,
      status: "completed",
    },
  });

  const task = response.data;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    completed: task.completed,
    updated: task.updated,
  };
}

async function deleteTask(taskListId: string = "@default", taskId: string) {
  const tasks = await getTasksClient();
  await tasks.tasks.delete({
    tasklist: taskListId,
    task: taskId,
  });
  return { deleted: true, taskId };
}

// MCP Server setup
const server = new Server(
  {
    name: "gmail",
    version: "0.4.0",
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
    {
      name: "gmail_list_drafts",
      description: "List all email drafts in the account",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Maximum number of drafts to return (default: 10)",
            default: 10,
          },
        },
      },
    },
    {
      name: "gmail_get_draft",
      description: "Get the full content of a specific draft by its ID",
      inputSchema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The ID of the draft to retrieve",
          },
        },
        required: ["draftId"],
      },
    },
    {
      name: "gmail_create_draft",
      description: "Create a new email draft. The draft can be reviewed and sent later.",
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
            description: "Optional thread ID to create a draft reply to an existing conversation",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "gmail_update_draft",
      description: "Update an existing email draft with new content",
      inputSchema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The ID of the draft to update",
          },
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
            description: "Optional thread ID for reply drafts",
          },
        },
        required: ["draftId", "to", "subject", "body"],
      },
    },
    {
      name: "gmail_delete_draft",
      description: "Permanently delete an email draft",
      inputSchema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The ID of the draft to delete",
          },
        },
        required: ["draftId"],
      },
    },
    {
      name: "gmail_send_draft",
      description: "Send an existing draft. This will move the draft to sent mail.",
      inputSchema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The ID of the draft to send",
          },
        },
        required: ["draftId"],
      },
    },
    // Google Calendar tools
    {
      name: "gcal_list_calendars",
      description: "List all calendars accessible to the user (primary and shared calendars)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "gcal_list_events",
      description: "List upcoming calendar events. Defaults to primary calendar and next 7 days.",
      inputSchema: {
        type: "object",
        properties: {
          calendarId: {
            type: "string",
            description: "Calendar ID to list events from (default: 'primary')",
            default: "primary",
          },
          timeMin: {
            type: "string",
            description: "Start of time range (ISO 8601 format). Defaults to now.",
          },
          timeMax: {
            type: "string",
            description: "End of time range (ISO 8601 format). Defaults to 7 days from now.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of events to return (default: 50)",
            default: 50,
          },
        },
      },
    },
    {
      name: "gcal_get_event",
      description: "Get full details of a specific calendar event by its ID",
      inputSchema: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The ID of the event to retrieve",
          },
          calendarId: {
            type: "string",
            description: "Calendar ID containing the event (default: 'primary')",
            default: "primary",
          },
        },
        required: ["eventId"],
      },
    },
    // Google Tasks tools
    {
      name: "gtasks_list_tasklists",
      description: "List all task lists in Google Tasks",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "gtasks_list_tasks",
      description: "List tasks from a task list. By default shows incomplete tasks from the default list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list ID (default: '@default' for the primary list)",
            default: "@default",
          },
          showCompleted: {
            type: "boolean",
            description: "Include completed tasks (default: false)",
            default: false,
          },
          showHidden: {
            type: "boolean",
            description: "Include hidden tasks (default: false)",
            default: false,
          },
          dueMin: {
            type: "string",
            description: "Filter tasks due after this date (RFC 3339 format)",
          },
          dueMax: {
            type: "string",
            description: "Filter tasks due before this date (RFC 3339 format)",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of tasks to return (default: 100)",
            default: 100,
          },
        },
      },
    },
    {
      name: "gtasks_get_task",
      description: "Get details of a specific task by ID",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to retrieve",
          },
          taskListId: {
            type: "string",
            description: "Task list ID containing the task (default: '@default')",
            default: "@default",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "gtasks_create_task",
      description: "Create a new task in Google Tasks",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the task",
          },
          notes: {
            type: "string",
            description: "Notes/description for the task",
          },
          due: {
            type: "string",
            description: "Due date (RFC 3339 format, e.g., '2026-01-20T00:00:00Z')",
          },
          taskListId: {
            type: "string",
            description: "Task list ID to add task to (default: '@default')",
            default: "@default",
          },
          parent: {
            type: "string",
            description: "Parent task ID to create as a subtask",
          },
        },
        required: ["title"],
      },
    },
    {
      name: "gtasks_update_task",
      description: "Update an existing task (title, notes, due date, or status)",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to update",
          },
          taskListId: {
            type: "string",
            description: "Task list ID containing the task (default: '@default')",
            default: "@default",
          },
          title: {
            type: "string",
            description: "New title for the task",
          },
          notes: {
            type: "string",
            description: "New notes for the task",
          },
          due: {
            type: "string",
            description: "New due date (RFC 3339 format)",
          },
          status: {
            type: "string",
            enum: ["needsAction", "completed"],
            description: "Task status",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "gtasks_complete_task",
      description: "Mark a task as completed",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to complete",
          },
          taskListId: {
            type: "string",
            description: "Task list ID containing the task (default: '@default')",
            default: "@default",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "gtasks_delete_task",
      description: "Delete a task permanently",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to delete",
          },
          taskListId: {
            type: "string",
            description: "Task list ID containing the task (default: '@default')",
            default: "@default",
          },
        },
        required: ["taskId"],
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

      case "gmail_list_drafts": {
        const result = await listDrafts(args?.maxResults as number | undefined);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_get_draft": {
        const result = await getDraft(args?.draftId as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_create_draft": {
        const result = await createDraft(
          args?.to as string,
          args?.subject as string,
          args?.body as string,
          args?.threadId as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_update_draft": {
        const result = await updateDraft(
          args?.draftId as string,
          args?.to as string,
          args?.subject as string,
          args?.body as string,
          args?.threadId as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_delete_draft": {
        const result = await deleteDraft(args?.draftId as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gmail_send_draft": {
        const result = await sendDraft(args?.draftId as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // Google Calendar handlers
      case "gcal_list_calendars": {
        const result = await listCalendars();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gcal_list_events": {
        const result = await listCalendarEvents(
          (args?.calendarId as string) || "primary",
          args?.timeMin as string | undefined,
          args?.timeMax as string | undefined,
          (args?.maxResults as number) || 50
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gcal_get_event": {
        const result = await getCalendarEvent(
          (args?.calendarId as string) || "primary",
          args?.eventId as string
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // Google Tasks handlers
      case "gtasks_list_tasklists": {
        const result = await listTaskLists();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_list_tasks": {
        const result = await listTasks(
          (args?.taskListId as string) || "@default",
          (args?.showCompleted as boolean) || false,
          (args?.showHidden as boolean) || false,
          args?.dueMin as string | undefined,
          args?.dueMax as string | undefined,
          (args?.maxResults as number) || 100
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_get_task": {
        const result = await getTask(
          (args?.taskListId as string) || "@default",
          args?.taskId as string
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_create_task": {
        const result = await createTask(
          (args?.taskListId as string) || "@default",
          args?.title as string,
          args?.notes as string | undefined,
          args?.due as string | undefined,
          args?.parent as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_update_task": {
        const result = await updateTask(
          (args?.taskListId as string) || "@default",
          args?.taskId as string,
          args?.title as string | undefined,
          args?.notes as string | undefined,
          args?.due as string | undefined,
          args?.status as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_complete_task": {
        const result = await completeTask(
          (args?.taskListId as string) || "@default",
          args?.taskId as string
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "gtasks_delete_task": {
        const result = await deleteTask(
          (args?.taskListId as string) || "@default",
          args?.taskId as string
        );
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
