#!/bin/bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm run setup
(sleep 2 && open http://localhost:4321) &
npm start
