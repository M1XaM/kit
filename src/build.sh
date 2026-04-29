#!/bin/bash
cd "$(dirname "$0")"

echo "Building React frontend..."
cd frontend
npm run build
cd ..

echo "Creating bin/ directories for each OS..."
mkdir -p ../bin/linux
mkdir -p ../bin/windows
mkdir -p ../bin/macos

echo "Building Go executables for Linux..."
mkdir -p backend/frontend/dist
cp -r frontend/dist/* backend/frontend/dist/ || true

GOOS=linux GOARCH=amd64 go build -o ../bin/linux/kit ./backend
GOOS=linux GOARCH=amd64 go build -o ../bin/linux/delete-kit ./uninstall/main.go

echo "Building Go executables for Windows..."
GOOS=windows GOARCH=amd64 go build -o ../bin/windows/kit.exe ./backend
GOOS=windows GOARCH=amd64 go build -o ../bin/windows/delete-kit.exe ./uninstall/main.go

echo "Building Go executables for macOS (Apple Silicon)..."
GOOS=darwin GOARCH=arm64 go build -o ../bin/macos/kit ./backend
GOOS=darwin GOARCH=arm64 go build -o ../bin/macos/delete-kit ./uninstall/main.go

echo "Build complete! Check the ../bin/ directory for your OS folders."
