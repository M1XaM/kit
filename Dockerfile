# ==========================================
# Stage 1: Build the React frontend
# ==========================================
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

# Build the binaries for all OS targets
RUN mkdir -p /out/linux /out/windows /out/macos

# Linux
RUN GOOS=linux GOARCH=amd64 go build -o /out/linux/kit ./backend
RUN GOOS=linux GOARCH=amd64 go build -o /out/linux/delete-kit ./uninstall/main.go

# Windows
RUN GOOS=windows GOARCH=amd64 go build -o /out/windows/kit.exe ./backend
RUN GOOS=windows GOARCH=amd64 go build -o /out/windows/delete-kit.exe ./uninstall/main.go

# macOS (Apple Silicon)
RUN GOOS=darwin GOARCH=arm64 go build -o /out/macos/kit ./backend
RUN GOOS=darwin GOARCH=arm64 go build -o /out/macos/delete-kit ./uninstall/main.go


# ==========================================
# Stage 3: Export artifacts to the host
# ==========================================
# We use a scratch image simply to hold the binaries. 
# BuildKit's `--output` flag will dump everything in /out to the host.
FROM scratch AS export-stage
COPY --from=backend /out /
