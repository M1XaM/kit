#!/bin/bash
# Builds the AI background-removal sidecar (kit-bgremove) and bundles its shared
# libraries into <out>/<os>/lib, alongside which the release ships install-kit
# and uninstall-kit. Final per-OS layout:
#
#   <os>/install-kit
#   <os>/uninstall-kit
#   <os>/lib/kit-bgremove        + libonnxruntime.so (+ CUDA/cuDNN when GPU)
#
# Two bundle modes:
#   CPU (default)  : ONNX Runtime CPU only. Tiny (~25MB). Runs on the CPU.
#   GPU (WITH_GPU=1): ONNX Runtime GPU + the full CUDA 12 + cuDNN 9 runtime, so
#                     any NVIDIA machine runs on the GPU with zero setup. Large
#                     (~2.9GB per OS). The sidecar auto-falls back to CPU when no
#                     usable GPU is found, so the same binary works either way.
#
# Usage: ./build_sidecar.sh <out_dir> <os...>          # os in: linux windows macos
#   WITH_GPU=1 ./build_sidecar.sh ../bin linux windows # zero-setup GPU bundle
#
# The sidecar is a CGO build, so each target needs a C toolchain; targets whose
# toolchain (or a download) is unavailable are skipped with a warning — Kit then
# reports the AI feature as unavailable on that OS, which it handles gracefully.

set -u
cd "$(dirname "$0")"

ORT_VERSION="${ORT_VERSION:-1.26.0}"
WITH_GPU="${WITH_GPU:-0}"
OUT_DIR="$1"; shift
TARGETS="$*"

# Pinned, mutually-compatible CUDA 12 / cuDNN 9 redistributable versions
# (validated against ONNX Runtime 1.26 GPU). Bump together when upgrading ORT.
CUDA_WHEELS=(
	"nvidia-cuda-runtime-cu12==12.9.79"
	"nvidia-cublas-cu12==12.9.2.10"
	"nvidia-cudnn-cu12==9.23.0.39"
	"nvidia-cufft-cu12==11.4.1.4"
	"nvidia-curand-cu12==10.3.10.19"
	"nvidia-cuda-nvrtc-cu12==12.9.86"
	"nvidia-nvjitlink-cu12==12.9.86"
)
# Standalone libs nothing in our path loads — dropped to save space.
TRIM_LIBS=(libonnxruntime_providers_tensorrt.so onnxruntime_providers_tensorrt.dll
	libcufftw.so.11 cufftw64_11.dll libnvblas.so.12 nvblas64_12.dll
	libnvrtc.alt.so.12 "libnvrtc-builtins.alt.so."*)

fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi; }

# extract_wheels <pip-platform> <dest> : download the pinned CUDA wheels for the
# given platform (manylinux/​win) and copy their shared libs into dest.
extract_wheels() {
	local platform="$1" dest="$2" tmp
	tmp="$(mktemp -d)"
	if ! pip3 download --no-deps --only-binary=:all: --platform "$platform" \
		--python-version 3.12 -d "$tmp" "${CUDA_WHEELS[@]}" >/dev/null 2>&1; then
		echo "  [sidecar] WARN: could not download CUDA wheels for $platform"; rm -rf "$tmp"; return 1
	fi
	local x="$tmp/x"; mkdir -p "$x"
	for whl in "$tmp"/*.whl; do unzip -o -q "$whl" -d "$x"; done
	# nvidia wheels put libs under nvidia/<pkg>/lib (linux) or nvidia/<pkg>/bin (win)
	find "$x/nvidia" \( -name '*.so' -o -name '*.so.*' -o -name '*.dll' \) -type f \
		-exec cp -P {} "$dest/" \;
	rm -rf "$tmp"
}

build_one() {
	local os="$1" goos cc bin arch ort_os ort_kind archive ext libglob pip_platform dest
	arch="amd64"
	case "$os" in
		linux)   goos=linux;   bin=kit-bgremove;     cc="${CC_LINUX:-gcc}";   ort_os=linux; ext=tgz; pip_platform=manylinux2014_x86_64 ;;
		windows) goos=windows; bin=kit-bgremove.exe; cc="${CC_WINDOWS:-x86_64-w64-mingw32-gcc}"; ort_os=win; ext=zip; pip_platform=win_amd64 ;;
		macos)   goos=darwin; arch=arm64; bin=kit-bgremove; cc="${CC_MACOS:-clang}"; ort_os=osx; ext=tgz; pip_platform="" ;;
		*) echo "  [sidecar] unknown os: $os"; return 1 ;;
	esac

	if ! command -v "$cc" >/dev/null 2>&1; then
		echo "  [sidecar] WARN: '$cc' not found — skipping $os (AI feature unavailable on $os)."; return 0
	fi

	dest="${OUT_DIR}/${os}/lib"; mkdir -p "$dest"

	echo "  [sidecar] building kit-bgremove for ${os}..."
	if ! CGO_ENABLED=1 GOOS="$goos" GOARCH="$arch" CC="$cc" go build -trimpath -o "${dest}/${bin}" ./bgremove; then
		echo "  [sidecar] WARN: build failed for $os — skipping."; return 0
	fi

	# Choose CPU vs GPU ONNX Runtime. GPU only for linux/windows (NVIDIA).
	ort_kind=""
	if [ "$WITH_GPU" = "1" ] && { [ "$os" = "linux" ] || [ "$os" = "windows" ]; }; then ort_kind="-gpu"; fi

	case "$os" in
		linux)   archive="onnxruntime-linux-x64${ort_kind}-${ORT_VERSION}.tgz" ;;
		windows) archive="onnxruntime-win-x64${ort_kind}-${ORT_VERSION}.zip" ;;
		macos)   archive="onnxruntime-osx-arm64-${ORT_VERSION}.tgz" ;;
	esac

	echo "  [sidecar] fetching ${archive}..."
	local tmp; tmp="$(mktemp -d)"
	if ! fetch "https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${archive}" "${tmp}/${archive}"; then
		echo "  [sidecar] WARN: could not download ${archive} — removing partial $os sidecar."
		rm -f "${dest}/${bin}"; rm -rf "$tmp"; return 0
	fi
	local x="${tmp}/x"; mkdir -p "$x"
	if [ "$ext" = zip ]; then unzip -q "${tmp}/${archive}" -d "$x"; else tar xzf "${tmp}/${archive}" -C "$x"; fi
	# Copy every ONNX Runtime shared lib (libonnxruntime + provider libs): .so on
	# Linux, .dylib on macOS, .dll on Windows.
	find "$x" \( -name 'libonnxruntime*.so*' -o -name 'libonnxruntime*.dylib' -o -name 'onnxruntime*.dll' \) -type f -exec cp -P {} "$dest/" \;
	# Ensure a stable unversioned name exists for the sidecar to load: the archives
	# ship a versioned real file (libonnxruntime.so.X.Y.Z on Linux,
	# libonnxruntime.X.Y.Z.dylib on macOS), but resolveORTLib() looks for the
	# unversioned name, so symlink it. Windows DLLs are already unversioned.
	local real
	case "$os" in
		linux)
			real="$(cd "$dest" && ls libonnxruntime.so.*.* 2>/dev/null | head -1)"
			[ -n "$real" ] && ln -sf "$real" "${dest}/libonnxruntime.so" ;;
		macos)
			real="$(cd "$dest" && ls libonnxruntime.*.dylib 2>/dev/null | head -1)"
			[ -n "$real" ] && ln -sf "$real" "${dest}/libonnxruntime.dylib" ;;
	esac
	rm -rf "$tmp"

	# Bundle the CUDA/cuDNN runtime for zero-setup GPU.
	if [ -n "$ort_kind" ]; then
		if ! command -v pip3 >/dev/null 2>&1; then
			echo "  [sidecar] WARN: pip3 missing — GPU libs not bundled for $os (will run CPU)."
		else
			echo "  [sidecar] bundling CUDA 12 + cuDNN 9 for ${os} (large)..."
			extract_wheels "$pip_platform" "$dest" || echo "  [sidecar] WARN: CUDA wheels missing for $os (will run CPU)."
		fi
	fi

	# Drop standalone libs we never load.
	(cd "$dest" && rm -f "${TRIM_LIBS[@]}" 2>/dev/null)

	echo "  [sidecar] ${os}: ready ($(du -sh "$dest" 2>/dev/null | cut -f1))."
}

if [ -z "$TARGETS" ] || [ "$TARGETS" = "all" ]; then TARGETS="linux windows macos"; fi
for os in $TARGETS; do build_one "$os"; done
