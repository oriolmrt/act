# VSCode Extension Installation Guide

To install and test the act language extension in VSCode:

## Method 1: Install from Directory (Recommended for Testing)

1. **Copy the extension to your VSCode extensions folder:**

   **On Linux/macOS:**
   ```bash
   cp -r /home/oriol/gdrive/Projects/act3/vscode-act ~/.vscode/extensions/act-language-0.1.0
   ```

   **On Windows:**
   ```cmd
   xcopy /E /I "C:\path\to\vscode-act" "%USERPROFILE%\.vscode\extensions\act-language-0.1.0"
   ```

2. **Restart VSCode** or run the "Developer: Reload Window" command (`Ctrl+Shift+P` or `Cmd+Shift+P`)

3. **Test the highlighting:**
   - Open `test.act` - should show syntax highlighting
   - Open `color-game2.html` or `act-test-suite.html` - should highlight act code in attributes and script tags

## Method 2: Install as VSIX Package

If you have `vsce` installed:

```bash
cd /home/oriol/gdrive/Projects/act3/vscode-act
npm install -g @vscode/vsce  # if not already installed
vsce package
code --install-extension act-language-0.1.0.vsix
```

## Verify Installation

1. Open VSCode
2. Open a `.act` file or HTML file with act attributes
3. Check the language mode in the bottom-right corner
4. For `.act` files, it should say "Act"
5. Syntax highlighting should work automatically in HTML files for `act` attributes

## Troubleshooting

- If highlighting doesn't work, try reloading the window: `Ctrl+Shift+P` → "Developer: Reload Window"
- Check VSCode's Output panel (`View` → `Output`) and select "Extension Host" to see any errors
- Verify the extension is in the correct directory with the right structure
