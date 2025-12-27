#!/bin/bash

# Release script for Act.js
# Creates minified and gzipped versions of act.js

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"
SRC_FILE="$PROJECT_ROOT/act.js"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building Act.js release...${NC}"

# Check if source file exists
if [ ! -f "$SRC_FILE" ]; then
    echo "Error: act.js not found at $SRC_FILE"
    exit 1
fi

# Check if terser is installed
if ! command -v terser &> /dev/null; then
    echo "Error: terser is not installed."
    echo "Install it with: npm install -g terser"
    exit 1
fi

# Check if brotli is installed
if ! command -v brotli &> /dev/null; then
    echo "Error: brotli is not installed."
    exit 1
fi

# Create dist directory if it doesn't exist
mkdir -p "$DIST_DIR"

# Copy the regular act.js
echo "Copying act.js..."
cp "$SRC_FILE" "$DIST_DIR/act.js"

# Create minified version using Terser
echo "Creating minified version..."
terser "$SRC_FILE" \
    --compress \
    --mangle \
    --output "$DIST_DIR/act.min.js"

# Create gzipped version of minified file
echo "Creating gzipped version..."
gzip -9 -k -f "$DIST_DIR/act.min.js"

# Create brotli version of minified file
echo "Creating brotli version..."
brotli -9 -k -f "$DIST_DIR/act.min.js"

# Show file sizes
echo ""
echo -e "${GREEN}Build complete${NC}"
echo ""
echo "File sizes:"
echo "  act.js:        $(wc -c < "$DIST_DIR/act.js" | tr -d ' ') bytes"
echo "  act.min.js:    $(wc -c < "$DIST_DIR/act.min.js" | tr -d ' ') bytes"
echo "  act.min.js.gz: $(wc -c < "$DIST_DIR/act.min.js.gz" | tr -d ' ') bytes"
echo "  act.min.js.br: $(wc -c < "$DIST_DIR/act.min.js.br" | tr -d ' ') bytes"
