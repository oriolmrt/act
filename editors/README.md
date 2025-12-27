# Editor Extensions

Editor support for the Act scripting language.

## Available Editors

- **VSCode** - Full support including Act code in HTML files
- **TextMate** - `.act` files only
- **Visual Studio** - `.act` files only
- **WebStorm / IntelliJ** - `.act` files only

> **Note:** Only VSCode supports syntax highlighting for Act code embedded in HTML files (`<script type="text/act">` and `act@*` attributes). Other editors support standalone `.act` files only.

## Installation

### TextMate

Double-click the `editors/textmate` folder. TextMate will install it automatically.

### VSCode

Build and install:
```bash
./editors/vscode/build.sh
code --install-extension editors/dist/vscode/act-language-*.vsix
```

### Visual Studio (2022+)

Copy the `editors/textmate` folder to your user extensions directory:
`%USERPROFILE%\.vs\Extensions\Act`

### WebStorm / IntelliJ

1. Open **Settings/Preferences** > **Editor** > **TextMate Bundles**.
2. Click `+` and select the `editors/textmate` folder.
3. Ensure the `act` bundle is associated with `*.act`.

## Development

### VSCode Extension

To build the VSCode extension:
```bash
cd editors/vscode
./build.sh
```

This will:
1. Sync the TextMate grammar from `editors/textmate/`
2. Package the extension to `editors/dist/vscode/act-language-X.X.X.vsix`

### TextMate Grammar

The canonical syntax grammar is in `textmate/Syntaxes/act.tmLanguage.json`. 

If you update it, rebuild the VSCode extension to include the changes.
