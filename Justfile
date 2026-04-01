set shell := ["zsh", "-lc"]

verify:
    npm run verify

test:
    npm run test:app

syntax:
    npm run check:syntax

open:
    npm --prefix ./vswirks-app start
