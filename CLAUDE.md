# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude plugin for securely working with 1Password through the `op` CLI tool. The fundamental design principle is that Claude manipulates secrets **without revealing them** to itself or others.

### Core Security Pattern

Use **secret references** (`op://vault/item/field`) rather than exposing plaintext secrets. The plugin should:
- Never return actual secret values in tool outputs
- Use `op read` and `op inject` for runtime secret resolution
- Ensure secrets are never committed to source control or logged
- Leverage 1Password CLI's biometric authentication where available

## 1Password CLI Integration

### Key Commands

- `op account list` - List all configured accounts with their details
- `op --account <identifier>` - Execute commands for a specific account
- `op item get/create/edit/delete/list` - CRUD operations on items
- `op read "op://vault/item/field"` - Read secret by reference (returns actual value - use carefully)
- `op inject -i template.tpl -o output` - Inject secrets into config files using `{{ op://... }}` syntax
- `op run --env-file=".env.tpl" -- command` - Pass secrets as environment variables
- `op vault list` - List available vaults
- `op item template list` - List item templates (Login, Password, API Credential, etc.)

### Secret Reference Syntax
```
op://vault-name/item-name/field-name
op://vault-name/item-name/field-name?attribute=otp  # for TOTP codes
```

### Multi-Account Support

The plugin **must support multiple 1Password accounts**. Users may have personal, work, and other accounts configured.

**Account Identification:**

- **Use**: Sign-in address (URL) or User ID
- **Never use**: Email address (not unique across accounts)
- Get account details: `op account list --format json`
- Account identifiers can be passed via `--account` flag or `OP_ACCOUNT` environment variable

**Example workflow:**

```bash
# List accounts to show user their options
op account list --format json

# Execute command for specific account
op --account ABCDEFG1234567 item list
op --account company.1password.com item list
```

### Documentation
- CLI Reference: https://developer.1password.com/docs/cli/
- Secret References: https://developer.1password.com/docs/cli/secrets-reference-syntax/
- Get help: `op [command] --help`

## Plugin Architecture Principles

### Tool Design

When implementing plugin tools:

1. **Account Selection**: Tools should accept an optional account identifier (URL or User ID). If multiple accounts exist and none is specified, prompt the user to select one.
2. **List/Search Operations**: Return item names, IDs, and metadata but NOT secret values
3. **Create/Edit Operations**: Accept secret references or prompt for secure input, never log inputs
4. **Read Operations**: Return only secret references by default; require explicit user confirmation to reveal values
5. **Template Operations**: Use `op inject` to populate templates without exposing secrets in transit

### Automatic Secret Protection (op-inject)

The `op-inject` tool automatically protects output files containing injected secrets:

- **Gitignore Protection**: If in a git repository or `.gitignore` exists, adds output file to `.gitignore`
- **Claudeignore Protection**: If no git repository, adds output file to `.claudeignore`
- **File Permissions**: Sets output file permissions to `600` (owner read/write only)
- **Cloud Sync Warning**: Warns if output file is in a cloud sync directory (Dropbox, iCloud, etc.)

These protections help prevent accidental exposure of secrets through version control, Claude's context window, or cloud synchronization.

### Output Format
- Use `--format json` for machine-readable output
- Parse JSON responses to extract metadata while filtering secret fields
- Return structured data that references items without exposing sensitive values

### Authentication
- Assume user has configured `op` CLI with biometric/app integration
- Check authentication with `op whoami` before operations
- Handle authentication errors gracefully with clear user guidance

## Development Workflow

### Prerequisites
- 1Password CLI installed and configured (`op signin`)
- 1Password app integration enabled for biometric auth
- Node.js/TypeScript environment
- `semver` CLI tool for version management (`brew install semver` on macOS)

### Common Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Watch mode compilation
- `npm start` - Run the MCP server

### Version Bumping

Use VSCode tasks (Cmd/Ctrl+Shift+P → "Tasks: Run Task") to update both `package.json` and `.claude-plugin/plugin.json`:

- **Bump Major Version** - 1.0.0 → 2.0.0 (breaking changes)
- **Bump Minor Version** - 1.0.0 → 1.1.0 (new features)
- **Bump Patch Version** - 1.0.0 → 1.0.1 (bug fixes, default task)

Manual update requires updating both files:

```bash
npm version [major|minor|patch] --no-git-tag-version
# Then manually update version in .claude-plugin/plugin.json
```

### Testing Strategy
- Use a dedicated test vault (`test-vault`) for development
- Create disposable test items, never use production secrets
- Verify that test outputs contain references, not actual secrets
- Test authentication error handling and vault permission scenarios

## Security Checklist

Before committing any code:
- [ ] No hardcoded secrets or references to real vaults/items
- [ ] No logging of `op read` command outputs
- [ ] Tool results filtered to prevent secret exposure
- [ ] Error messages don't leak secret values
- [ ] Test cases use disposable test data only
