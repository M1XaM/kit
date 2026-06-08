#!/bin/bash
cd "$(dirname "$0")"

echo "Building React frontend..."
cd frontend
npm run build
cd ..

WITH_TERMINAL="false"
WITH_GPU="0"
TARGET_OS="all"

for arg in "$@"; do
	case "$arg" in
		--with-terminal)
			WITH_TERMINAL="true"
			;;
		--with-gpu)
			WITH_GPU="1"
			;;
		all|linux|windows|macos)
			TARGET_OS="$arg"
			;;
		*)
			echo "Unknown option: $arg"
			echo "Usage: ./build.sh [all|linux|windows|macos] [--with-terminal] [--with-gpu]"
			exit 1
			;;
	esac
done

GO_BUILD_FLAGS=()
if [ "$WITH_TERMINAL" = "true" ]; then
	GO_BUILD_FLAGS=(-ldflags "-X main.withTerminal=true")
fi

# Embed a clean copy of the freshly built frontend. Clear first so stale
# hashed assets from previous builds never linger in the embedded bundle.
rm -rf backend/frontend/dist
mkdir -p backend/frontend/dist
cp -r frontend/dist/* backend/frontend/dist/ || true

build_linux() {
	mkdir -p ../bin/linux
	GOOS=linux GOARCH=amd64 go build "${GO_BUILD_FLAGS[@]}" -o ../bin/linux/install-kit ./backend
	GOOS=linux GOARCH=amd64 go build -o ../bin/linux/uninstall-kit ./uninstall/main.go
}

build_windows() {
	mkdir -p ../bin/windows
	GOOS=windows GOARCH=amd64 go build "${GO_BUILD_FLAGS[@]}" -o ../bin/windows/install-kit.exe ./backend
	GOOS=windows GOARCH=amd64 go build -o ../bin/windows/uninstall-kit.exe ./uninstall/main.go
}

build_macos() {
	mkdir -p ../bin/macos
	GOOS=darwin GOARCH=arm64 go build "${GO_BUILD_FLAGS[@]}" -o ../bin/macos/install-kit ./backend
	GOOS=darwin GOARCH=arm64 go build -o ../bin/macos/uninstall-kit ./uninstall/main.go
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
		echo "Usage: ./build.sh [all|linux|windows|macos] [--with-terminal]"
		exit 1
		;;
esac

# Build the AI background-removal sidecar (kit-bgremove) + bundle the ONNX
# Runtime library alongside each kit binary. This is a CGO build and needs a C
# toolchain per target; the helper skips any target whose toolchain is missing
# (locally that usually means only the host OS gets a sidecar — other OSes then
# report the AI feature as unavailable, which Kit handles gracefully).
echo "Building AI sidecar (kit-bgremove)..."
WITH_GPU="$WITH_GPU" ./build_sidecar.sh ../bin "$TARGET_OS" || echo "Sidecar build skipped/failed; AI Remove Background will be unavailable."

echo "Build complete! Check the ../bin/ directory for your OS folders."
