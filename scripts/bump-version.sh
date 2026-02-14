#!/bin/bash
set -e

# Usage: bump-version.sh [major|minor|patch]
BUMP_TYPE=${1:-patch}

# Get current version
CURRENT=$(node -p "require('./package.json').version")

# Calculate new version
NEW=$(semver -i "$BUMP_TYPE" "$CURRENT")

# Update package.json
npm version "$NEW" --no-git-tag-version

# Update .claude-plugin/plugin.json
node -e "
  const fs = require('fs');
  const path = './.claude-plugin/plugin.json';
  const data = JSON.parse(fs.readFileSync(path));
  data.version = '$NEW';
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
"

echo "✓ Version bumped from $CURRENT to $NEW (updated package.json and plugin.json)"
