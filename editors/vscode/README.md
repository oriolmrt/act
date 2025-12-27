# Act Language Support for VSCode

Syntax highlighting for the [act](https://github.com/oriolmrt/act) scripting language.

## Features

- Syntax highlighting for `.act` files
- Syntax highlighting for `act` attributes in HTML files (e.g., `act@click`, `act@input`)
- Syntax highlighting for `<script type="text/act">` tags in HTML files

## Installation

### From Source

1. Copy this directory to your VSCode extensions folder:
   - **Windows**: `%USERPROFILE%\.vscode\extensions\`
   - **macOS/Linux**: `~/.vscode/extensions/`

2. Restart VSCode

### From VSIX (if packaged)

1. Run `vsce package` in this directory to create a `.vsix` file
2. Install using: `code --install-extension act-language-0.1.0.vsix`
