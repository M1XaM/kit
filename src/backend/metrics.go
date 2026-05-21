package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

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
	GPU       gpuMetrics     `json:"gpu"`
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
	lastStats   gpuMetrics
}{
	lastStats: gpuMetrics{Status: "unavailable", Reason: "GPU metrics not collected yet"},
}

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

	gpu := getGPUStats()

	return systemMetrics{
		Timestamp: now,
		CPU: cpuMetrics{
			Usage: clampPercent(cpuUsage),
			Cores: coreCount,
		},
		Memory:  memory,
		Storage: storage,
		Network: network,
		GPU:     gpu,
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

func getGPUStats() gpuMetrics {
	gpuCache.Lock()
	if time.Since(gpuCache.lastFetched) < gpuCacheTTL {
		cached := gpuCache.lastStats
		gpuCache.Unlock()
		return cached
	}
	gpuCache.Unlock()

	stats := queryNvidiaSmi()

	gpuCache.Lock()
	gpuCache.lastFetched = time.Now()
	gpuCache.lastStats = stats
	gpuCache.Unlock()

	return stats
}

func queryNvidiaSmi() gpuMetrics {
	if runtime.GOOS == "darwin" {
		return gpuMetrics{Status: "unavailable", Reason: "GPU metrics are not supported on macOS"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 900*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu", "--format=csv,noheader,nounits")
	output, err := cmd.Output()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return gpuMetrics{Status: "unavailable", Reason: "nvidia-smi timed out"}
		}
		return gpuMetrics{Status: "unavailable", Reason: "nvidia-smi not available"}
	}

	stats, parseErr := parseNvidiaSmiOutput(string(output))
	if parseErr != nil {
		return gpuMetrics{Status: "unavailable", Reason: "Unable to parse nvidia-smi output"}
	}
	stats.Status = "ok"
	return stats
}

func parseNvidiaSmiOutput(output string) (gpuMetrics, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		return gpuMetrics{}, errors.New("empty output")
	}

	var (
		totalUtil     float64
		totalMemUtil  float64
		totalTemp     float64
		totalMemUsed  float64
		totalMemTotal float64
		names         []string
		count         int
	)

	for _, line := range lines {
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
		names = append(names, name)
		totalUtil += util
		totalMemUtil += memUtil
		totalMemTotal += memTotal
		totalMemUsed += memUsed
		totalTemp += temp
		count += 1
	}

	if count == 0 {
		return gpuMetrics{}, errors.New("no parsable gpu metrics")
	}

	name := names[0]
	if len(names) > 1 {
		name = name + " (+" + strconv.Itoa(len(names)-1) + ")"
	}

	memTotalBytes := uint64(totalMemTotal * 1024 * 1024)
	memUsedBytes := uint64(totalMemUsed * 1024 * 1024)

	return gpuMetrics{
		Name:              name,
		Utilization:       clampPercent(totalUtil / float64(count)),
		MemoryUtilization: clampPercent(totalMemUtil / float64(count)),
		MemoryTotal:       memTotalBytes,
		MemoryUsed:        memUsedBytes,
		Temperature:       totalTemp / float64(count),
	}, nil
}
