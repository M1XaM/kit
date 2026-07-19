package features

import (
	"context"
	"os/exec"

	"local-tools-hub/backend/features/shared"
)

// hiddenCommand and hiddenCommandContext are drop-in replacements for
// exec.Command / exec.CommandContext that never flash a console window on
// Windows (Kit is built with -H=windowsgui there).
func hiddenCommand(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	shared.HideConsole(cmd)
	return cmd
}

func hiddenCommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	shared.HideConsole(cmd)
	return cmd
}
