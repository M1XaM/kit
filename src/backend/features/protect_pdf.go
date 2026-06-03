package features

import (
	"net/http"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// HandleProtectPDF adds (mode=encrypt) or removes (mode=decrypt) a password on a
// PDF. A single password is used for both the user and owner password.
func HandleProtectPDF(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	mode := strings.TrimSpace(r.FormValue("mode"))
	if mode == "" {
		mode = "encrypt"
	}
	password := r.FormValue("password")
	if password == "" {
		http.Error(w, "Password is required.", http.StatusBadRequest)
		return
	}

	switch mode {
	case "encrypt":
		conf := model.NewAESConfiguration(password, password, 256)
		runSinglePDFOp(w, inputPath, name, "encrypted",
			"Failed to encrypt PDF. Ensure it is a valid, unencrypted PDF.",
			func(in, out string) error {
				return api.EncryptFile(in, out, conf)
			})
	case "decrypt":
		conf := model.NewDefaultConfiguration()
		conf.UserPW = password
		conf.OwnerPW = password
		runSinglePDFOp(w, inputPath, name, "decrypted",
			"Failed to decrypt PDF. Check the password and that the file is encrypted.",
			func(in, out string) error {
				return api.DecryptFile(in, out, conf)
			})
	default:
		http.Error(w, "Invalid mode. Supported modes: encrypt, decrypt.", http.StatusBadRequest)
	}
}
