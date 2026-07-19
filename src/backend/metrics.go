package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"local-tools-hub/backend/features/shared"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
)

type systemMetrics struct {
	Timestamp time.Time      `json:"timestamp"`
	CPU       cpuMetrics     `json:"cpu"`
	Memory    memoryMetrics  `json:"memory"`
	Storage   storageMetrics `json:"storage"`
	Network   networkMetrics `json:"network"`
	// GPU is the primary adapter (kept for existing consumers); GPUs lists
	// every detected adapter — discrete NVIDIA/AMD and integrated GPUs.
	GPU  gpuMetrics   `json:"gpu"`
	GPUs []gpuMetrics `json:"gpus"`
}

type cpuMetrics struct {
	Usage float64 `json:"usage"`
	Cores int     `json:"cores"`
}

type memoryMetrics struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Available uint64  `json:"available"`
	Usage     float64 `json:"usage"`
}

type storageMetrics struct {
	Total            uint64  `json:"total"`
	Used             uint64  `json:"used"`
	Free             uint64  `json:"free"`
	Usage            float64 `json:"usage"`
	ReadBytesPerSec  uint64  `json:"readBytesPerSec"`
	WriteBytesPerSec uint64  `json:"writeBytesPerSec"`
}

type networkMetrics struct {
	BytesSentPerSec   uint64 `json:"bytesSentPerSec"`
	BytesRecvPerSec   uint64 `json:"bytesRecvPerSec"`
	PacketsSentPerSec uint64 `json:"packetsSentPerSec"`
	PacketsRecvPerSec uint64 `json:"packetsRecvPerSec"`
}

type gpuMetrics struct {
	Status            string  `json:"status"`
	Vendor            string  `json:"vendor,omitempty"` // nvidia | amd | intel
	Name              string  `json:"name,omitempty"`
	Utilization       float64 `json:"utilization,omitempty"`
	MemoryUsed        uint64  `json:"memoryUsed,omitempty"`
	MemoryTotal       uint64  `json:"memoryTotal,omitempty"`
	MemoryUtilization float64 `json:"memoryUtilization,omitempty"`
	Temperature       float64 `json:"temperature,omitempty"`
	Reason            string  `json:"reason,omitempty"`
}

type rateMetrics struct {
	diskRead       uint64
	diskWrite      uint64
	netSent        uint64
	netRecv        uint64
	netPacketsSent uint64
	netPacketsRecv uint64
}

type perfState struct {
	sync.Mutex
	lastSample         time.Time
	lastCPUTimes       *cpu.TimesStat
	lastDiskRead       uint64
	lastDiskWrite      uint64
	lastNetSent        uint64
	lastNetRecv        uint64
	lastNetPacketsSent uint64
	lastNetPacketsRecv uint64
}

var metricsState = &perfState{}

const gpuCacheTTL = 2 * time.Second

var gpuCache = struct {
	sync.Mutex
	lastFetched time.Time
	lastStats   []gpuMetrics
}{}

func handleSystemMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	metrics := collectSystemMetrics()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func collectSystemMetrics() systemMetrics {
	now := time.Now()
	cpuTimes, _ := cpu.Times(false)
	currentCPU := cpu.TimesStat{}
	if len(cpuTimes) > 0 {
		currentCPU = cpuTimes[0]
	}

	diskCounters, _ := disk.IOCounters()
	var diskRead uint64
	var diskWrite uint64
	for _, counter := range diskCounters {
		diskRead += counter.ReadBytes
		diskWrite += counter.WriteBytes
	}

	netCounters, _ := gnet.IOCounters(false)
	var netSent uint64
	var netRecv uint64
	var netPacketsSent uint64
	var netPacketsRecv uint64
	if len(netCounters) > 0 {
		netSent = netCounters[0].BytesSent
		netRecv = netCounters[0].BytesRecv
		netPacketsSent = netCounters[0].PacketsSent
		netPacketsRecv = netCounters[0].PacketsRecv
	}

	cpuUsage, rates := metricsState.update(now, currentCPU, diskRead, diskWrite, netSent, netRecv, netPacketsSent, netPacketsRecv)

	coreCount, err := cpu.Counts(true)
	if err != nil || coreCount == 0 {
		coreCount = runtime.NumCPU()
	}

	memInfo, _ := mem.VirtualMemory()
	memory := memoryMetrics{}
	if memInfo != nil {
		memory = memoryMetrics{
			Total:     memInfo.Total,
			Used:      memInfo.Used,
			Available: memInfo.Available,
			Usage:     clampPercent(memInfo.UsedPercent),
		}
	}

	diskUsage, _ := disk.Usage(systemDiskPath())
	storage := storageMetrics{}
	if diskUsage != nil {
		storage = storageMetrics{
			Total:            diskUsage.Total,
			Used:             diskUsage.Used,
			Free:             diskUsage.Free,
			Usage:            clampPercent(diskUsage.UsedPercent),
			ReadBytesPerSec:  rates.diskRead,
			WriteBytesPerSec: rates.diskWrite,
		}
	} else {
		storage = storageMetrics{
			ReadBytesPerSec:  rates.diskRead,
			WriteBytesPerSec: rates.diskWrite,
		}
	}

	network := networkMetrics{
		BytesSentPerSec:   rates.netSent,
		BytesRecvPerSec:   rates.netRecv,
		PacketsSentPerSec: rates.netPacketsSent,
		PacketsRecvPerSec: rates.netPacketsRecv,
	}

	gpus := getGPUStats()
	primary := gpuMetrics{Status: "unavailable", Reason: "No GPU detected (NVIDIA, AMD and Intel adapters are probed)"}
	for _, g := range gpus {
		if g.Status == "ok" {
			primary = g
			break
		}
	}

	return systemMetrics{
		Timestamp: now,
		CPU: cpuMetrics{
			Usage: clampPercent(cpuUsage),
			Cores: coreCount,
		},
		Memory:  memory,
		Storage: storage,
		Network: network,
		GPU:     primary,
		GPUs:    gpus,
	}
}

func (s *perfState) update(now time.Time, currentCPU cpu.TimesStat, diskRead, diskWrite, netSent, netRecv, packetsSent, packetsRecv uint64) (float64, rateMetrics) {
	s.Lock()
	defer s.Unlock()

	cpuUsage := 0.0
	if s.lastCPUTimes != nil {
		cpuUsage = calculateCPUUsage(*s.lastCPUTimes, currentCPU)
	}
	s.lastCPUTimes = &currentCPU

	if s.lastSample.IsZero() {
		s.lastSample = now
		s.lastDiskRead = diskRead
		s.lastDiskWrite = diskWrite
		s.lastNetSent = netSent
		s.lastNetRecv = netRecv
		s.lastNetPacketsSent = packetsSent
		s.lastNetPacketsRecv = packetsRecv
		return cpuUsage, rateMetrics{}
	}

	elapsed := now.Sub(s.lastSample).Seconds()
	if elapsed <= 0 {
		s.lastSample = now
		s.lastDiskRead = diskRead
		s.lastDiskWrite = diskWrite
		s.lastNetSent = netSent
		s.lastNetRecv = netRecv
		s.lastNetPacketsSent = packetsSent
		s.lastNetPacketsRecv = packetsRecv
		return cpuUsage, rateMetrics{}
	}

	rates := rateMetrics{
		diskRead:       rateFromDelta(diskRead, s.lastDiskRead, elapsed),
		diskWrite:      rateFromDelta(diskWrite, s.lastDiskWrite, elapsed),
		netSent:        rateFromDelta(netSent, s.lastNetSent, elapsed),
		netRecv:        rateFromDelta(netRecv, s.lastNetRecv, elapsed),
		netPacketsSent: rateFromDelta(packetsSent, s.lastNetPacketsSent, elapsed),
		netPacketsRecv: rateFromDelta(packetsRecv, s.lastNetPacketsRecv, elapsed),
	}

	s.lastSample = now
	s.lastDiskRead = diskRead
	s.lastDiskWrite = diskWrite
	s.lastNetSent = netSent
	s.lastNetRecv = netRecv
	s.lastNetPacketsSent = packetsSent
	s.lastNetPacketsRecv = packetsRecv

	return cpuUsage, rates
}

func calculateCPUUsage(prev, current cpu.TimesStat) float64 {
	prevTotal := totalCPUTime(prev)
	currentTotal := totalCPUTime(current)
	deltaTotal := currentTotal - prevTotal
	if deltaTotal <= 0 {
		return 0
	}
	deltaIdle := current.Idle - prev.Idle
	usage := (deltaTotal - deltaIdle) / deltaTotal * 100
	return clampPercent(usage)
}

func totalCPUTime(t cpu.TimesStat) float64 {
	return t.User + t.System + t.Idle + t.Nice + t.Iowait + t.Irq + t.Softirq + t.Steal + t.Guest + t.GuestNice
}

func rateFromDelta(current, previous uint64, elapsed float64) uint64 {
	if current < previous || elapsed <= 0 {
		return 0
	}
	delta := current - previous
	return uint64(float64(delta) / elapsed)
}

func clampPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func systemDiskPath() string {
	if runtime.GOOS == "windows" {
		drive := os.Getenv("SystemDrive")
		if drive == "" {
			drive = "C:"
		}
		return drive + "\\"
	}
	return "/"
}

// getGPUStats returns every detected GPU: NVIDIA via nvidia-smi, AMD and Intel
// via the Linux DRM sysfs interface (built into the kernel drivers — no extra
// tools needed). Results are cached briefly since vendor tooling is slow.
func getGPUStats() []gpuMetrics {
	gpuCache.Lock()
	if time.Since(gpuCache.lastFetched) < gpuCacheTTL {
		cached := gpuCache.lastStats
		gpuCache.Unlock()
		return cached
	}
	gpuCache.Unlock()

	var stats []gpuMetrics
	stats = append(stats, queryNvidiaSmi()...)
	stats = append(stats, querySysfsGPUs()...)

	gpuCache.Lock()
	gpuCache.lastFetched = time.Now()
	gpuCache.lastStats = stats
	gpuCache.Unlock()

	return stats
}

func queryNvidiaSmi() []gpuMetrics {
	ctx, cancel := context.WithTimeout(context.Background(), 900*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu", "--format=csv,noheader,nounits")
	shared.HideConsole(cmd)
	output, err := cmd.Output()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return []gpuMetrics{{Status: "unavailable", Vendor: "nvidia", Reason: "nvidia-smi timed out"}}
		}
		// nvidia-smi missing simply means no NVIDIA GPU is set up — not an
		// error worth reporting as a card.
		return nil
	}

	return parseNvidiaSmiOutput(string(output))
}

// parseNvidiaSmiOutput returns one entry per GPU line.
func parseNvidiaSmiOutput(output string) []gpuMetrics {
	var gpus []gpuMetrics
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		parts := strings.Split(line, ",")
		if len(parts) < 6 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		util, err1 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		memUtil, err2 := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		memTotal, err3 := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64)
		memUsed, err4 := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64)
		temp, err5 := strconv.ParseFloat(strings.TrimSpace(parts[5]), 64)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil {
			continue
		}
		gpus = append(gpus, gpuMetrics{
			Status:            "ok",
			Vendor:            "nvidia",
			Name:              name,
			Utilization:       clampPercent(util),
			MemoryUtilization: clampPercent(memUtil),
			MemoryTotal:       uint64(memTotal * 1024 * 1024),
			MemoryUsed:        uint64(memUsed * 1024 * 1024),
			Temperature:       temp,
		})
	}
	return gpus
}

// querySysfsGPUs detects AMD and Intel GPUs through /sys/class/drm on Linux.
// The amdgpu driver exposes busy percent, VRAM and temperature directly; the
// i915/xe drivers expose less, so Intel utilization is approximated from the
// current vs. max GPU clock when available.
func querySysfsGPUs() []gpuMetrics {
	if runtime.GOOS != "linux" {
		return nil
	}
	cards, err := filepath.Glob("/sys/class/drm/card[0-9]*")
	if err != nil {
		return nil
	}

	var gpus []gpuMetrics
	for _, card := range cards {
		// Skip render/connector nodes like card0-HDMI-A-1.
		if strings.Contains(filepath.Base(card), "-") {
			continue
		}
		device := filepath.Join(card, "device")
		vendorID := strings.TrimSpace(readSysfsFile(filepath.Join(device, "vendor")))
		switch vendorID {
		case "0x1002": // AMD
			gpus = append(gpus, readAmdGPU(device))
		case "0x8086": // Intel
			gpus = append(gpus, readIntelGPU(card, device))
		}
	}
	return gpus
}

func readSysfsFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func readSysfsUint(path string) (uint64, bool) {
	v, err := strconv.ParseUint(strings.TrimSpace(readSysfsFile(path)), 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func readAmdGPU(device string) gpuMetrics {
	gpu := gpuMetrics{Status: "ok", Vendor: "amd", Name: "AMD GPU"}
	if busy, ok := readSysfsUint(filepath.Join(device, "gpu_busy_percent")); ok {
		gpu.Utilization = clampPercent(float64(busy))
	}
	if total, ok := readSysfsUint(filepath.Join(device, "mem_info_vram_total")); ok {
		gpu.MemoryTotal = total
		if used, ok := readSysfsUint(filepath.Join(device, "mem_info_vram_used")); ok {
			gpu.MemoryUsed = used
			if total > 0 {
				gpu.MemoryUtilization = clampPercent(float64(used) / float64(total) * 100)
			}
		}
	}
	if temp, ok := readGPUHwmonTemp(device); ok {
		gpu.Temperature = temp
	}
	if name := pciDeviceName(device); name != "" {
		gpu.Name = name
	}
	return gpu
}

func readIntelGPU(card, device string) gpuMetrics {
	gpu := gpuMetrics{Status: "ok", Vendor: "intel", Name: "Intel GPU"}
	// i915 has no busy-percent file; approximate activity from the current
	// vs. max GPU clock. 0 MHz means the GPU is power-gated (idle).
	cur, okCur := readSysfsUint(filepath.Join(card, "gt_cur_freq_mhz"))
	max, okMax := readSysfsUint(filepath.Join(card, "gt_max_freq_mhz"))
	if okCur && okMax && max > 0 {
		gpu.Utilization = clampPercent(float64(cur) / float64(max) * 100)
	}
	if temp, ok := readGPUHwmonTemp(device); ok {
		gpu.Temperature = temp
	}
	if name := pciDeviceName(device); name != "" {
		gpu.Name = name
	}
	return gpu
}

// readGPUHwmonTemp finds the first temperature sensor under the device's hwmon
// directory (reported in millidegrees Celsius).
func readGPUHwmonTemp(device string) (float64, bool) {
	matches, err := filepath.Glob(filepath.Join(device, "hwmon", "hwmon*", "temp1_input"))
	if err != nil || len(matches) == 0 {
		return 0, false
	}
	if milli, ok := readSysfsUint(matches[0]); ok {
		return float64(milli) / 1000, true
	}
	return 0, false
}

// pciDeviceName resolves a marketing-ish name for a PCI GPU. The kernel
// itself only exposes vendor/device IDs; "label" or the uevent's DRIVER plus
// the ID is the best built-in option without shelling out to lspci.
func pciDeviceName(device string) string {
	// Some drivers expose a product string directly.
	for _, f := range []string{"product_name", "label"} {
		if name := strings.TrimSpace(readSysfsFile(filepath.Join(device, f))); name != "" {
			return name
		}
	}
	vendor := strings.TrimSpace(readSysfsFile(filepath.Join(device, "vendor")))
	dev := strings.TrimSpace(readSysfsFile(filepath.Join(device, "device")))
	vendorName := ""
	switch vendor {
	case "0x1002":
		vendorName = "AMD GPU"
	case "0x8086":
		vendorName = "Intel GPU"
	default:
		return ""
	}
	if dev != "" {
		return vendorName + " [" + strings.TrimPrefix(dev, "0x") + "]"
	}
	return vendorName
}
