# Act TextMate Bundle

Syntax highlighting for the Act scripting language in TextMate.

## Installation

### macOS/Linux

Double-click `Act.tmbundle` or copy it to:
```bash
~/Library/Application Support/TextMate/Bundles/
```

Or install from command line:
```bash
mkdir -p ~/Library/Application\ Support/TextMate/Bundles
cp -r Act.tmbundle ~/Library/Application\ Support/TextMate/Bundles/
```

Then restart TextMate or run:
```
osascript -e 'tell app "TextMate" to reload bundles'
```

## Features

- Syntax highlighting for Act language
- Support for `.act` file extension
- Keyword recognition
- String and template literal support
- Comment highlighting
- Operator and selector highlighting

## License

MIT License - see LICENSE file in the root of the Act project
