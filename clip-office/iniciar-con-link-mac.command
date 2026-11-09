#!/bin/bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm run setup
echo "Abriendo tu oficina con link público... (no cierres esta ventana)"
npm run online
