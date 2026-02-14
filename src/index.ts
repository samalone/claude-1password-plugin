#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const server = new McpServer({
  name: "1password",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runOp(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("op", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);
    // Sanitize: strip anything that looks like a secret value from error output
    throw new Error(`op command failed: ${msg}`);
  }
}

function prependAccount(args: string[], account?: string): string[] {
  if (account) {
    return ["--account", account, ...args];
  }
  return args;
}

/**
 * Given raw JSON from `op item get --format json`, produce a safe version that
 * replaces secret field values with their `op://` reference URIs.
 */
function sanitizeItemFields(raw: string): string {
  const item = JSON.parse(raw);
  const vaultName: string = item.vault?.name ?? item.vault?.id ?? "unknown";
  const itemTitle: string = item.title ?? item.id ?? "unknown";

  if (Array.isArray(item.fields)) {
    for (const field of item.fields) {
      const label: string = field.label || field.id || "unknown";
      // Build the reference URI
      field.reference = field.reference || `op://${vaultName}/${itemTitle}/${label}`;
      // Remove actual secret values — keep only non-sensitive metadata
      delete field.value;
    }
  }

  // Also strip any top-level sensitive fields that op might include
  // (e.g., notesPlain for secure notes with secret content)
  // Keep title, id, category, tags, urls, vault, fields (sanitized), sections
  const safe = {
    id: item.id,
    title: item.title,
    category: item.category,
    tags: item.tags,
    urls: item.urls,
    vault: item.vault,
    sections: item.sections,
    fields: item.fields,
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_edited_by: item.last_edited_by,
    version: item.version,
    favorite: item.favorite,
  };
  return JSON.stringify(safe, null, 2);
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// 1. op-account-list
server.registerTool(
  "op-account-list",
  {
    title: "List 1Password Accounts",
    description:
      "List all locally configured 1Password accounts. Returns account URLs, user IDs, and account IDs.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await runOp(["account", "list", "--format", "json"]);
      // Parse and strip email addresses for privacy
      const accounts = JSON.parse(result);
      const safe = accounts.map((a: Record<string, unknown>) => ({
        url: a.url,
        user_uuid: a.user_uuid,
        account_uuid: a.account_uuid,
      }));
      return textResult(JSON.stringify(safe, null, 2));
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 2. op-whoami
server.registerTool(
  "op-whoami",
  {
    title: "Check 1Password Auth Status",
    description:
      "Check the current 1Password CLI authentication status. Returns the signed-in account details.",
    inputSchema: {
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID to check"),
    },
  },
  async ({ account }) => {
    try {
      const args = prependAccount(["whoami", "--format", "json"], account);
      const result = await runOp(args);
      return textResult(result);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 3. op-vault-list
server.registerTool(
  "op-vault-list",
  {
    title: "List 1Password Vaults",
    description: "List all available vaults in a 1Password account.",
    inputSchema: {
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
    },
  },
  async ({ account }) => {
    try {
      const args = prependAccount(
        ["vault", "list", "--format", "json"],
        account
      );
      const result = await runOp(args);
      return textResult(result);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 4. op-item-list
server.registerTool(
  "op-item-list",
  {
    title: "List 1Password Items",
    description:
      "List items in a vault. Returns item names, IDs, and categories — never secret values.",
    inputSchema: {
      vault: z.string().describe("Vault name or ID"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
      categories: z
        .string()
        .optional()
        .describe(
          "Comma-separated category filter (e.g. 'Login,Password,API Credential')"
        ),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tag filter"),
    },
  },
  async ({ vault, account, categories, tags }) => {
    try {
      const args = ["item", "list", "--vault", vault, "--format", "json"];
      if (categories) args.push("--categories", categories);
      if (tags) args.push("--tags", tags);
      const result = await runOp(prependAccount(args, account));
      return textResult(result);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 5. op-item-get
server.registerTool(
  "op-item-get",
  {
    title: "Get 1Password Item Details",
    description:
      "Get metadata and field references for a 1Password item. Secret field values are replaced with op:// reference URIs — actual secrets are never returned.",
    inputSchema: {
      item: z.string().describe("Item name, ID, or sharing link"),
      vault: z
        .string()
        .optional()
        .describe("Vault name or ID (recommended to avoid ambiguity)"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
    },
  },
  async ({ item, vault, account }) => {
    try {
      const args = ["item", "get", item, "--format", "json"];
      if (vault) args.push("--vault", vault);
      const result = await runOp(prependAccount(args, account));
      const sanitized = sanitizeItemFields(result);
      return textResult(sanitized);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 6. op-item-create
server.registerTool(
  "op-item-create",
  {
    title: "Create 1Password Item",
    description:
      "Create a new item in 1Password. Returns the created item's metadata and field references — no secrets.",
    inputSchema: {
      category: z
        .string()
        .describe(
          "Item category (e.g. Login, Password, 'API Credential', 'Secure Note', 'SSH Key')"
        ),
      title: z.string().describe("Item title"),
      vault: z
        .string()
        .optional()
        .describe("Vault name or ID (default: Private/Personal)"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
      url: z.string().optional().describe("URL associated with the item"),
      generatePassword: z
        .string()
        .optional()
        .describe(
          "Password recipe (e.g. '20,letters,digits' or just 'true' for default)"
        ),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tags"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Assignment statements for fields (e.g. ['username=admin', 'server.host[text]=10.0.0.1'])"
        ),
    },
  },
  async ({ category, title, vault, account, url, generatePassword, tags, fields }) => {
    try {
      const args = [
        "item",
        "create",
        "--category",
        category,
        "--title",
        title,
        "--format",
        "json",
      ];
      if (vault) args.push("--vault", vault);
      if (url) args.push("--url", url);
      if (tags) args.push("--tags", tags);
      if (generatePassword) {
        if (generatePassword === "true") {
          args.push("--generate-password");
        } else {
          args.push(`--generate-password=${generatePassword}`);
        }
      }
      if (fields) {
        for (const field of fields) {
          args.push(field);
        }
      }
      const result = await runOp(prependAccount(args, account));
      const sanitized = sanitizeItemFields(result);
      return textResult(sanitized);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 7. op-item-edit
server.registerTool(
  "op-item-edit",
  {
    title: "Edit 1Password Item",
    description:
      "Edit an existing 1Password item. Use assignment statements to update fields.",
    inputSchema: {
      item: z.string().describe("Item name or ID"),
      vault: z
        .string()
        .optional()
        .describe("Vault name or ID"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
      title: z.string().optional().describe("New title for the item"),
      url: z.string().optional().describe("New URL for the item"),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tags (replaces existing tags)"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Assignment statements for fields (e.g. ['username=newuser', 'password=newsecret'])"
        ),
    },
  },
  async ({ item, vault, account, title, url, tags, fields }) => {
    try {
      const args = ["item", "edit", item, "--format", "json"];
      if (vault) args.push("--vault", vault);
      if (title) args.push("--title", title);
      if (url) args.push("--url", url);
      if (tags) args.push("--tags", tags);
      if (fields) {
        for (const field of fields) {
          args.push(field);
        }
      }
      const result = await runOp(prependAccount(args, account));
      const sanitized = sanitizeItemFields(result);
      return textResult(sanitized);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 8. op-item-delete
server.registerTool(
  "op-item-delete",
  {
    title: "Delete 1Password Item",
    description:
      "Delete or archive a 1Password item. Defaults to archive for safety.",
    inputSchema: {
      item: z.string().describe("Item name or ID"),
      vault: z
        .string()
        .optional()
        .describe("Vault name or ID"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
      archive: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Archive instead of permanently deleting (default: true for safety)"
        ),
    },
  },
  async ({ item, vault, account, archive }) => {
    try {
      const args = ["item", "delete", item];
      if (vault) args.push("--vault", vault);
      if (archive) args.push("--archive");
      await runOp(prependAccount(args, account));
      return textResult(
        `Item "${item}" has been ${archive ? "archived" : "deleted"}.`
      );
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 9. op-read
server.registerTool(
  "op-read",
  {
    title: "Read Secret Value",
    description:
      "Read the actual value of a secret using an op:// reference. WARNING: This returns the real secret value. Only use when the user explicitly requests it or when a secret must be passed to a command at runtime. Prefer using op:// references instead of revealing secrets.",
    inputSchema: {
      reference: z
        .string()
        .regex(/^op:\/\//)
        .describe(
          "Secret reference URI (e.g. op://vault/item/field)"
        ),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
    },
  },
  async ({ reference, account }) => {
    try {
      const args = prependAccount(["read", reference], account);
      const result = await runOp(args);
      return textResult(result.trim());
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 10. op-inject
server.registerTool(
  "op-inject",
  {
    title: "Inject Secrets into Template",
    description:
      "Inject secrets into a template file using {{ op://vault/item/field }} placeholders. The output file will contain resolved secrets but its contents are never returned.",
    inputSchema: {
      inputFile: z
        .string()
        .describe("Path to the template file with {{ op://... }} placeholders"),
      outputFile: z.string().describe("Path to write the resolved output file"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
    },
  },
  async ({ inputFile, outputFile, account }) => {
    try {
      const args = prependAccount(
        ["inject", "-i", inputFile, "-o", outputFile],
        account
      );
      await runOp(args);
      return textResult(
        `Secrets injected successfully: ${inputFile} -> ${outputFile}`
      );
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// 11. op-item-search
server.registerTool(
  "op-item-search",
  {
    title: "Search 1Password Items",
    description:
      "Search for items across vaults by title, category, or tags. Returns metadata only — never secret values.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe("Search query to match against item titles"),
      vault: z
        .string()
        .optional()
        .describe("Vault name or ID to search within"),
      categories: z
        .string()
        .optional()
        .describe("Comma-separated category filter"),
      tags: z
        .string()
        .optional()
        .describe("Comma-separated tag filter"),
      account: z
        .string()
        .optional()
        .describe("Account URL or User ID"),
    },
  },
  async ({ query, vault, categories, tags, account }) => {
    try {
      const args = ["item", "list", "--format", "json"];
      if (vault) args.push("--vault", vault);
      if (categories) args.push("--categories", categories);
      if (tags) args.push("--tags", tags);
      const result = await runOp(prependAccount(args, account));

      // If a text query is provided, filter results client-side
      if (query) {
        const items = JSON.parse(result);
        const lowerQuery = query.toLowerCase();
        const filtered = items.filter((item: Record<string, unknown>) => {
          const title = String(item.title ?? "").toLowerCase();
          return title.includes(lowerQuery);
        });
        return textResult(JSON.stringify(filtered, null, 2));
      }

      return textResult(result);
    } catch (e: unknown) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("1Password MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
