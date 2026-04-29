.PHONY: all build local-build run dev clean

# Default target builds via docker
all: build

# Platform-agnostic build using Docker multi-stage export
# This creates a container, compiles everything, saves output to bin/, 
# and automatically discards the container.
build:
	@echo "Starting platform-agnostic build process via Docker..."
	@DOCKER_BUILDKIT=1 docker build --file Dockerfile --output type=local,dest=bin/ .
	@echo "Build complete! Check the bin/ directory for your OS folders."

# Compiles locally using your host's Go and Node.js
local-build:
	@echo "Starting local build process..."
	@cd src && ./build.sh

# Runs the application on Linux (builds first if needed)
run: build
	@echo "Running Kit..."
	@./bin/linux/kit

# Starts the Go backend directly for development
dev:
	@echo "Starting Go backend in dev mode..."
	@cd src && mkdir -p backend/frontend/dist && cp -r frontend/dist/* backend/frontend/dist/ 2>/dev/null || true && cd backend && go run .

# Removes build artifacts
clean:
	@echo "Cleaning up..."
	@rm -rf bin/
	@rm -rf src/frontend/dist/
	@echo "Clean complete."