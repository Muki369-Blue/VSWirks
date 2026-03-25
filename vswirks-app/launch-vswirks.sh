#!/bin/bash
ELECTRON="/Users/bluewirks.max/Documents/VSWirks/vswirks-app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
MAIN="/Users/bluewirks.max/Documents/VSWirks/vswirks-app/electron/main.cjs"
cd /Users/bluewirks.max/Documents/VSWirks/vswirks-app
exec "$ELECTRON" "$MAIN"
