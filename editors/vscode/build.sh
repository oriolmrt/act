#!/bin/bash

# VSCode Extension Build Script
# Syncs TextMate grammar and packages the extension

set -e

echo "Building Act VSCode Extension..."
echo ""

# Navigate to vscode directory
cd "$(dirname "$0")"

# Sync TextMate grammar
echo "Syncing TextMate grammar..."
cp ../textmate/Syntaxes/act.tmLanguage.json syntaxes/act.tmLanguage.json
echo "   ✓ Grammar synced"

# Get version
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="act-language-${VERSION}.vsix"

# Clean old VSIX files
rm -f ./*.vsix

# Package extension
echo "Packaging extension..."
npx -y @vscode/vsce package --no-dependencies

# Move to dist
echo "Moving to editors/dist/vscode..."
mkdir -p ../dist/vscode
mv "$VSIX_FILE" "../dist/vscode/"

echo ""
echo "VSCode extension built successfully"
echo "Location: editors/dist/vscode/$VSIX_FILE"
echo ""
echo "To install:"
echo "  code --install-extension editors/dist/vscode/$VSIX_FILE"
