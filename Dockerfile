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
			GOOS=linux GOARCH=amd64 go build $LDFLAGS -o /out/linux/kit ./backend; \
			GOOS=linux GOARCH=amd64 go build -o /out/linux/delete-kit ./uninstall/main.go; \
		fi

# Windows
RUN if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " windows "; then \
			mkdir -p /out/windows; \
			LDFLAGS=""; \
			if [ "$WITH_TERMINAL" = "true" ]; then LDFLAGS="-ldflags=-X=main.withTerminal=true"; fi; \
			GOOS=windows GOARCH=amd64 go build $LDFLAGS -o /out/windows/kit.exe ./backend; \
			GOOS=windows GOARCH=amd64 go build -o /out/windows/delete-kit.exe ./uninstall/main.go; \
		fi

# macOS (Apple Silicon)
RUN if [ "$TARGET_OS" = "all" ] || echo " $TARGET_OS " | grep -q " macos "; then \
			mkdir -p /out/macos; \
			LDFLAGS=""; \
			if [ "$WITH_TERMINAL" = "true" ]; then LDFLAGS="-ldflags=-X=main.withTerminal=true"; fi; \
			GOOS=darwin GOARCH=arm64 go build $LDFLAGS -o /out/macos/kit ./backend; \
			GOOS=darwin GOARCH=arm64 go build -o /out/macos/delete-kit ./uninstall/main.go; \
		fi


# ==========================================
# Stage 3: Export artifacts to the host
# ==========================================
# We use a scratch image simply to hold the binaries. 
# BuildKit's `--output` flag will dump everything in /out to the host.
FROM scratch AS export-stage
COPY --from=backend /out /
