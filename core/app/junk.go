package app

import "strings"

// isJunkName — служебные имена macOS/Windows. В файловый менеджер не попадают.
func isJunkName(name string) bool {
	n := strings.ToLower(name)
	switch n {
	case ".ds_store", ".appledouble", "__macosx", "thumbs.db", "desktop.ini",
		".spotlight-v100", ".trashes", ".fseventsd", ".temporaryitems", ".documentrevisions-v100":
		return true
	}
	return strings.HasPrefix(n, "._")
}
