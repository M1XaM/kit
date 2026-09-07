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

# The release tag is stamped into the binary so it can tell whether a newer
# release exists. Unset (a plain source build) leaves it as "dev", which turns
# auto-update off — nothing to compare against, and nothing worth overwriting.
VERSION="${KIT_VERSION:-dev}"
COMMON_LDFLAGS="-X main.appVersion=$VERSION"

# Linux/macOS install-kit flags: --with-terminal only changes runtime behavior
# (whether the kit:// launcher spawns a terminal for logs).
GO_BUILD_FLAGS=(-ldflags "$COMMON_LDFLAGS")
# Windows is special: a normal console-subsystem .exe pops a terminal window the
# instant it's double-clicked — before any runtime flag is even read. So the
# default (release) Windows build links with `-H windowsgui` to suppress that
# console entirely for BOTH binaries. --with-terminal opts back into a console
# build so logs are visible for people who built it deliberately.
WIN_INSTALL_LDFLAGS="$COMMON_LDFLAGS -H windowsgui"
WIN_UNINSTALL_LDFLAGS="-H windowsgui"
if [ "$WITH_TERMINAL" = "true" ]; then
	GO_BUILD_FLAGS=(-ldflags "$COMMON_LDFLAGS -X main.withTerminal=true")
	WIN_INSTALL_LDFLAGS="$COMMON_LDFLAGS -X main.withTerminal=true"
	WIN_UNINSTALL_LDFLAGS=""
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
	GOOS=windows GOARCH=amd64 go build -ldflags "$WIN_INSTALL_LDFLAGS" -o ../bin/windows/install-kit.exe ./backend
	GOOS=windows GOARCH=amd64 go build -ldflags "$WIN_UNINSTALL_LDFLAGS" -o ../bin/windows/uninstall-kit.exe ./uninstall/main.go
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

# Bundle yt-dlp (single self-contained binary per OS) into each OS's lib/ folder,
# so the YouTube tool works without the user installing yt-dlp. Best-effort: a
# failed download just leaves Kit to fall back to a system yt-dlp on PATH.
YTDLP_VERSION="2026.06.09"
bundle_ytdlp() {
	local os="$1" asset="$2" out="$3"
	mkdir -p "../bin/$os/lib"
	if curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION/$asset" -o "../bin/$os/lib/$out"; then
		[ "$out" = "yt-dlp" ] && chmod +x "../bin/$os/lib/yt-dlp"
		echo "Bundled yt-dlp for $os."
	else
		echo "Warning: could not download yt-dlp for $os; YouTube downloads will need a system yt-dlp."
	fi
}

echo "Bundling yt-dlp..."
case "$TARGET_OS" in
	all)
		bundle_ytdlp linux yt-dlp_linux yt-dlp
		bundle_ytdlp windows yt-dlp.exe yt-dlp.exe
		bundle_ytdlp macos yt-dlp_macos yt-dlp
		;;
	linux)   bundle_ytdlp linux yt-dlp_linux yt-dlp ;;
	windows) bundle_ytdlp windows yt-dlp.exe yt-dlp.exe ;;
	macos)   bundle_ytdlp macos yt-dlp_macos yt-dlp ;;
esac

# Build the AI background-removal sidecar (kit-bgremove) + bundle the ONNX
# Runtime library alongside each kit binary. This is a CGO build and needs a C
# toolchain per target; the helper skips any target whose toolchain is missing
# (locally that usually means only the host OS gets a sidecar — other OSes then
# report the AI feature as unavailable, which Kit handles gracefully).
echo "Building AI sidecar (kit-bgremove)..."
WITH_GPU="$WITH_GPU" ./build_sidecar.sh ../bin "$TARGET_OS" || echo "Sidecar build skipped/failed; AI Remove Background will be unavailable."

echo "Build complete! Check the ../bin/ directory for your OS folders."
