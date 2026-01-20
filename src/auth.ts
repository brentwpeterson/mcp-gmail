#!/usr/bin/env node

/**
 * Gmail OAuth Authentication Script
 *
 * Run this once to authenticate with Google and store tokens locally.
 * Usage: npm run auth
 */

import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

const CONFIG_DIR = process.env.GMAIL_CONFIG_DIR || path.join(process.env.HOME || "", ".mcp-gmail");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
const CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH || path.join(CONFIG_DIR, "credentials.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
];

async function authenticate() {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Check for credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  Credentials file not found!                                     ║
╠══════════════════════════════════════════════════════════════════╣
║  Please download your OAuth credentials from Google Cloud        ║
║  Console and save them to:                                       ║
║                                                                  ║
║  ${CREDENTIALS_PATH.padEnd(62)}║
║                                                                  ║
║  Steps:                                                          ║
║  1. Go to console.cloud.google.com                               ║
║  2. APIs & Services → Credentials                                ║
║  3. Download OAuth 2.0 Client ID JSON                            ║
║  4. Save as credentials.json in the path above                   ║
╚══════════════════════════════════════════════════════════════════╝
    `);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  // Use localhost redirect for OAuth
  const redirectUri = "http://localhost:3333/oauth2callback";
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // Check if we already have a token
  if (fs.existsSync(TOKEN_PATH)) {
    console.log("Token already exists. Do you want to re-authenticate? (y/n)");
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const answer = await new Promise<string>((resolve) => {
      rl.question("> ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "y") {
      console.log("Keeping existing token.");
      process.exit(0);
    }
  }

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  Gmail OAuth Authentication                                      ║
╠══════════════════════════════════════════════════════════════════╣
║  Opening browser for Google authentication...                    ║
║  If it doesn't open, copy this URL manually:                     ║
╚══════════════════════════════════════════════════════════════════╝

${authUrl}

Waiting for authentication callback...
  `);

  // Open browser
  const open = (await import("open")).default;
  await open(authUrl);

  // Start local server to receive callback
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = url.parse(req.url || "", true);

        if (reqUrl.pathname === "/oauth2callback") {
          const code = reqUrl.query.code as string;

          if (!code) {
            res.writeHead(400);
            res.end("No authorization code received");
            return;
          }

          // Exchange code for tokens
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          // Save token
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Authentication Successful</title></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #22c55e;">✓ Authentication Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  ✓ Authentication successful!                                    ║
╠══════════════════════════════════════════════════════════════════╣
║  Token saved to: ${TOKEN_PATH.substring(0, 44).padEnd(44)}║
║                                                                  ║
║  The Gmail MCP server is now ready to use.                       ║
║  Restart Claude Code to load the new server.                     ║
╚══════════════════════════════════════════════════════════════════╝
          `);

          server.close();
          resolve();
        }
      } catch (error) {
        console.error("Authentication error:", error);
        res.writeHead(500);
        res.end("Authentication failed");
        server.close();
        reject(error);
      }
    });

    server.listen(3333, () => {
      console.log("OAuth callback server listening on http://localhost:3333");
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}

authenticate().catch((error) => {
  console.error("Authentication failed:", error.message);
  process.exit(1);
});
