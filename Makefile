.PHONY: all build local-build run dev clean release

# Extract the version from the arguments for "make release <version>"
ifeq (release,$(firstword $(MAKECMDGOALS)))
  RELEASE_VERSION := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  # Turn the version argument into a do-nothing target so Make doesn't complain
  $(eval $(RELEASE_VERSION):;@:)
endif

# Default target builds via docker
all: build

# Platform-agnostic build using Docker multi-stage export
# This creates a container, compiles everything, saves output to bin/, 
# and automatically discards the container.
build:
	@echo "Starting platform-agnostic build process via Docker..."
	@rm -rf bin/
	@rm -rf src/frontend/dist/
	@DOCKER_BUILDKIT=1 docker build --file Dockerfile --output type=local,dest=bin/ .
	@echo "Build complete! Check the bin/ directory for your OS folders."

# Compiles locally using your host's Go and Node.js
local-build:
	@echo "Starting local build process..."
	@rm -rf bin/
	@rm -rf src/frontend/dist/
	@cd src && ./build.sh

# Runs the application on Linux (builds first if needed)
run: build
	@echo "Running Kit..."
	@./bin/linux/kit

# Starts the Go backend directly for development
dev:
	@echo "Starting Go backend in dev mode..."
	@cd src && mkdir -p backend/frontend/dist && cp -r frontend/dist/* backend/frontend/dist/ 2>/dev/null || true && cd backend && go run .

# Tags the current commit with the specified version and pushes it
release:
	@if [ -z "$(RELEASE_VERSION)" ]; then \
		echo "Error: Please specify a version. Example: make release v1.2.3"; \
		exit 1; \
	fi
	@echo "Creating and pushing release tag $(RELEASE_VERSION)..."
	git tag $(RELEASE_VERSION)
	git push origin $(RELEASE_VERSION)
