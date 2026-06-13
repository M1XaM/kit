# ==========================================
# Stage 1: Build the React frontend
# ==========================================
ARG TARGET_OS=all
FROM node:20-alpine AS frontend
WORKDIR /app

# Install dependencies first for cache efficiency
COPY src/frontend/package*.json ./
RUN npm install

# Copy source and build
COPY src/frontend/ ./
RUN npm run build


# ==========================================
# Stage 2: Build the Go backend
# ==========================================
FROM golang:alpine AS backend
ARG TARGET_OS=all
ARG WITH_TERMINAL=false
WORKDIR /app

# Ensure correct CGO state for pure static cross-compilation
ENV CGO_ENABLED=0
ENV GO111MODULE=on

# Pre-cache go modules
COPY src/go.mod src/go.sum ./
RUN go mod download

# Copy the actual Go source code
COPY src/ ./

# Remove any locally built dist and inject the fresh one from Stage 1 into backend
RUN mkdir -p backend/frontend/dist
RUN rm -rf backend/frontend/dist/*
COPY --from=frontend /app/dist ./backend/frontend/dist

# Build the binaries for requested OS targets
RUN mkdir -p /out
RUN for os in $TARGET_OS; do \
			case "$os" in all|linux|windows|macos) ;; *) echo "Unknown TARGET_OS: $os" && exit 1 ;; esac; \
		done

# Linux
RUN if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " linux "; then \
			mkdir -p /out/linux; \
			LDFLAGS=""; \
			if [ "$WITH_TERMINAL" = "true" ]; then LDFLAGS="-ldflags=-X=main.withTerminal=true"; fi; \
			GOOS=linux GOARCH=amd64 go build $LDFLAGS -o /out/linux/install-kit ./backend; \
			GOOS=linux GOARCH=amd64 go build -o /out/linux/uninstall-kit ./uninstall/main.go; \
		fi

# Windows
RUN if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " windows "; then \
			mkdir -p /out/windows; \
			LDFLAGS=""; \
			if [ "$WITH_TERMINAL" = "true" ]; then LDFLAGS="-ldflags=-X=main.withTerminal=true"; fi; \
			GOOS=windows GOARCH=amd64 go build $LDFLAGS -o /out/windows/install-kit.exe ./backend; \
			GOOS=windows GOARCH=amd64 go build -o /out/windows/uninstall-kit.exe ./uninstall/main.go; \
		fi

# macOS (Apple Silicon)
RUN if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " macos "; then \
			mkdir -p /out/macos; \
			LDFLAGS=""; \
			if [ "$WITH_TERMINAL" = "true" ]; then LDFLAGS="-ldflags=-X=main.withTerminal=true"; fi; \
			GOOS=darwin GOARCH=arm64 go build $LDFLAGS -o /out/macos/install-kit ./backend; \
			GOOS=darwin GOARCH=arm64 go build -o /out/macos/uninstall-kit ./uninstall/main.go; \
		fi


# ==========================================
# Stage 3: Build the AI sidecars (kit-bgremove, kit-text2text)
# ==========================================
# The sidecars do ONNX inference and are CGO binaries that dlopen ONNX Runtime
# at runtime, so it can't share the pure-static musl backend stage — it must link
# glibc to run on typical Linux desktops. We use a glibc Go image and a mingw
# cross-toolchain for Windows. macOS needs osxcross/a Mac, so it's skipped here;
# the AI feature simply reports itself unavailable on macOS until that ships.
FROM golang:bookworm AS sidecar
ARG TARGET_OS=all
# WITH_GPU=true bundles the full CUDA 12 + cuDNN 9 runtime so NVIDIA machines run
# on the GPU with zero setup (large: ~2.9GB per OS). Default false ships the tiny
# CPU runtime; the sidecar auto-falls back to CPU regardless.
ARG WITH_GPU=false
WORKDIR /app
ENV GO111MODULE=on
RUN apt-get update && apt-get install -y --no-install-recommends \
		gcc gcc-mingw-w64-x86-64 curl unzip ca-certificates python3-pip && rm -rf /var/lib/apt/lists/*
COPY src/go.mod src/go.sum ./
RUN go mod download
COPY src/ ./
# Only attempt the OSes we can cross-build CGO for here (linux, windows). The
# helper skips any target whose toolchain is missing.
RUN SIDECAR_TARGETS="$(echo "$TARGET_OS" | tr ' ' '\n' | grep -E 'linux|windows|all' | tr '\n' ' ')"; \
		WITH_GPU_FLAG=0; [ "$WITH_GPU" = "true" ] && WITH_GPU_FLAG=1; \
		if [ -z "$SIDECAR_TARGETS" ]; then SIDECAR_TARGETS=""; else \
			[ "$SIDECAR_TARGETS" = "all " ] && SIDECAR_TARGETS="linux windows"; \
			chmod +x build_sidecar.sh && WITH_GPU=$WITH_GPU_FLAG ./build_sidecar.sh /sidecar $SIDECAR_TARGETS; \
		fi; \
		mkdir -p /sidecar


# ==========================================
# Stage 4: Bundle yt-dlp (YouTube downloader)
# ==========================================
# yt-dlp ships as a single self-contained binary per OS, so we just download the
# right one for each requested target into that OS's lib/ folder — the same place
# the AI sidecars live. Kit resolves lib/yt-dlp at runtime (see findSidecar), so
# the YouTube tool works out of the box with no separate install from the user.
FROM debian:bookworm-slim AS ytdlp
ARG TARGET_OS=all
RUN apt-get update && apt-get install -y --no-install-recommends \
		curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /ytdlp
# Pin a known-good release so builds are reproducible; bump deliberately.
ARG YTDLP_VERSION=2026.06.09
RUN set -eux; \
		base="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}"; \
		if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " linux "; then \
			mkdir -p linux/lib; curl -fsSL "$base/yt-dlp_linux" -o linux/lib/yt-dlp; chmod +x linux/lib/yt-dlp; \
		fi; \
		if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " windows "; then \
			mkdir -p windows/lib; curl -fsSL "$base/yt-dlp.exe" -o windows/lib/yt-dlp.exe; \
		fi; \
		if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " macos "; then \
			mkdir -p macos/lib; curl -fsSL "$base/yt-dlp_macos" -o macos/lib/yt-dlp; chmod +x macos/lib/yt-dlp; \
		fi


# ==========================================
# Stage 5: Export artifacts to the host
# ==========================================
# We use a scratch image simply to hold the binaries.
# BuildKit's `--output` flag will dump everything in /out to the host.
# The backend (kit), sidecar (kit-bgremove + lib/) and yt-dlp (lib/yt-dlp)
# outputs share the same per-OS folder layout, so copying them into "/" merges
# them per OS.
FROM scratch AS export-stage
COPY --from=backend /out /
COPY --from=sidecar /sidecar /
COPY --from=ytdlp /ytdlp /
