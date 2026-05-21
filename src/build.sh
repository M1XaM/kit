#!/bin/bash
cd "$(dirname "$0")"

echo "Building React frontend..."
cd frontend
npm run build
cd ..

TARGET_OS="${1:-all}"

mkdir -p backend/frontend/dist
cp -r frontend/dist/* backend/frontend/dist/ || true

build_linux() {
	mkdir -p ../bin/linux
	GOOS=linux GOARCH=amd64 go build -o ../bin/linux/kit ./backend
	GOOS=linux GOARCH=amd64 go build -o ../bin/linux/delete-kit ./uninstall/main.go
}

build_windows() {
	mkdir -p ../bin/windows
	GOOS=windows GOARCH=amd64 go build -o ../bin/windows/kit.exe ./backend
	GOOS=windows GOARCH=amd64 go build -o ../bin/windows/delete-kit.exe ./uninstall/main.go
}

build_macos() {
	mkdir -p ../bin/macos
	GOOS=darwin GOARCH=arm64 go build -o ../bin/macos/kit ./backend
	GOOS=darwin GOARCH=arm64 go build -o ../bin/macos/delete-kit ./uninstall/main.go
}

case "$TARGET_OS" in
	all)
		echo "Building Go executables for Linux..."
		build_linux
		echo "Building Go executables for Windows..."
		build_windows
		echo "Building Go executables for macOS (Apple Silicon)..."
		build_macos
		;;
	linux)
		echo "Building Go executables for Linux..."
		build_linux
		;;
	windows)
		echo "Building Go executables for Windows..."
		build_windows
		;;
	macos)
		echo "Building Go executables for macOS (Apple Silicon)..."
		build_macos
		;;
	*)
		echo "Unknown target: $TARGET_OS"
		echo "Usage: ./build.sh [all|linux|windows|macos]"
		exit 1
		;;
esac

echo "Build complete! Check the ../bin/ directory for your OS folders."
