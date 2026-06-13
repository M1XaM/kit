.PHONY: all build local-build run dev clean release test linux windows macos platform-build with-terminal with-gpu

# Plain `make` must build everything. `with-terminal` is defined as a target
# below (so Make doesn't choke on `make build with-terminal`), but it must
# never become the default goal — pin the default explicitly.
.DEFAULT_GOAL := all

PLATFORM_TARGETS := linux windows macos
REQUESTED_PLATFORMS := $(filter $(PLATFORM_TARGETS),$(MAKECMDGOALS))

# `with-terminal` is a pseudo-flag, not a real target. Add it to any build
# goal (e.g. `make build with-terminal`, `make linux with-terminal`) and the
# binary is compiled to open a terminal with logs when launched via the URL
# scheme. It's a phony no-op target so Make doesn't choke on the extra word.
WITH_TERMINAL_FLAG :=
DOCKER_TERMINAL_ARG :=
ifneq ($(filter with-terminal,$(MAKECMDGOALS)),)
WITH_TERMINAL_FLAG := --with-terminal
DOCKER_TERMINAL_ARG := --build-arg WITH_TERMINAL=true
endif

# `with-gpu` is a pseudo-flag like `with-terminal`. Add it to any build goal
# (e.g. `make build with-gpu`, `make linux with-gpu`) to bundle the full CUDA +
# cuDNN runtime so NVIDIA machines run background removal on the GPU with zero
# setup. This makes the release very large (~2.9GB per OS); without it Kit ships
# the tiny CPU runtime and still runs (just on the CPU).
WITH_GPU_FLAG :=
DOCKER_GPU_ARG :=
ifneq ($(filter with-gpu,$(MAKECMDGOALS)),)
WITH_GPU_FLAG := --with-gpu
DOCKER_GPU_ARG := --build-arg WITH_GPU=true
endif

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
	@DOCKER_BUILDKIT=1 docker build --file Dockerfile $(DOCKER_TERMINAL_ARG) $(DOCKER_GPU_ARG) --output type=local,dest=bin/ .
	@echo "Build complete! Check the bin/ directory for your OS folders."

# Compiles locally using your host's Go and Node.js
local-build:
	@echo "Starting local build process..."
	@rm -rf bin/
	@rm -rf src/frontend/dist/
	@cd src && ./build.sh $(WITH_TERMINAL_FLAG) $(WITH_GPU_FLAG)

linux windows macos: platform-build

platform-build:
	@if [ -z "$(REQUESTED_PLATFORMS)" ]; then \
		echo "Error: Specify one or more platforms: linux windows macos"; \
		exit 1; \
	fi
	@echo "Starting platform-agnostic build process via Docker for $(REQUESTED_PLATFORMS)..."
	@rm -rf bin/
	@rm -rf src/frontend/dist/
	@DOCKER_BUILDKIT=1 docker build --file Dockerfile --build-arg TARGET_OS="$(REQUESTED_PLATFORMS)" $(DOCKER_TERMINAL_ARG) $(DOCKER_GPU_ARG) --output type=local,dest=bin/ .
	@echo "Build complete! Check the bin/ directory for your OS folders."

# Starts the Go backend directly for development. Requires a prior frontend
# build (`cd src/frontend && npm run build`); re-embeds a clean copy so the
# server never serves a stale bundle.
dev:
	@echo "Starting Go backend in dev mode..."
	@if [ ! -d src/frontend/dist ]; then \
		echo "Error: src/frontend/dist is missing. Run 'cd src/frontend && npm run build' first (or use 'make local-build')."; \
		exit 1; \
	fi
	@cd src && rm -rf backend/frontend/dist && mkdir -p backend/frontend/dist && cp -r frontend/dist/* backend/frontend/dist/ && cd backend && go run .

# Runs every backend unit test inside Docker (same as the build runs in Docker).
# A non-zero exit means at least one test failed; BuildKit prints the failing
# stage's full log because we force plain progress. The build cache is bypassed
# with --no-cache so a test run always reflects the current source.
test:
	@echo "Running unit tests in Docker..."
	@DOCKER_BUILDKIT=1 docker build --file Dockerfile.test --target test --no-cache --progress=plain .
	@echo "All unit tests passed."

# Tags the current commit with the specified version and pushes it. The unit
# tests must pass first: `make test` fails the build (and this target) if any
# test fails, so a broken commit can never be tagged as a release.
release: test
	@if [ -z "$(RELEASE_VERSION)" ]; then \
		echo "Error: Please specify a version. Example: make release v1.2.3"; \
		exit 1; \
	fi
	@echo "Creating and pushing release tag $(RELEASE_VERSION)..."
	git tag $(RELEASE_VERSION)
	git push origin $(RELEASE_VERSION)

# Pseudo-flag target: lets `make <goal> with-terminal` parse without error.
# The real effect comes from the WITH_TERMINAL_FLAG/DOCKER_TERMINAL_ARG vars
# set at the top when `with-terminal` is among the goals.
with-terminal:
	@:

# Pseudo-flag target: lets `make <goal> with-gpu` parse without error. The real
# effect comes from the WITH_GPU_FLAG/DOCKER_GPU_ARG vars set at the top when
# `with-gpu` is among the goals.
with-gpu:
	@:
