package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNextFreeName(t *testing.T) {
	taken := map[string]bool{"a.txt": true, "a (1).txt": true, "docs": true, "v1.2": true}
	if got := nextFreeName(taken, "a.txt", false); got != "a (2).txt" {
		t.Errorf("file: %q", got)
	}
	if got := nextFreeName(taken, "docs", true); got != "docs (1)" {
		t.Errorf("folder: %q", got)
	}
	if got := nextFreeName(taken, "v1.2", true); got != "v1.2 (1)" {
		t.Errorf("folder with a dot: %q", got)
	}
}

func TestPlanUpload(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(rel, content string) string {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	mustWrite("d/b.txt", "bb")
	mustWrite("d/sub/c.txt", "ccc")
	single := mustWrite("a.txt", "a")

	items, total, err := planUpload([]string{filepath.Join(root, "d"), single})
	if err != nil {
		t.Fatal(err)
	}
	if total != 6 {
		t.Errorf("total = %d, want 6", total)
	}
	type view struct {
		Group int
		Dir   string
		Name  string
		IsDir bool
		Top   bool
	}
	var got []view
	for _, it := range items {
		got = append(got, view{it.group, it.dir, it.name, it.isDir, it.top})
	}
	want := []view{
		{0, "", "d", true, true},
		{0, "", "b.txt", false, false},
		{0, "", "sub", true, false},
		{0, "sub", "c.txt", false, false},
		{1, "", "a.txt", false, true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("plan = %+v\nwant   %+v", got, want)
	}

	if _, _, err := planUpload([]string{"relative/path"}); err == nil {
		t.Error("relative local paths must be rejected")
	}
}

func TestPlaceDownloaded(t *testing.T) {
	dir := t.TempDir()
	mkTmp := func(content string) string {
		f, err := os.CreateTemp(dir, ".syne-part-*")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.WriteString(content)
		_ = f.Close()
		return f.Name()
	}
	read := func(p string) string {
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}

	p1, err := placeDownloaded(mkTmp("one"), dir, "", "x.txt")
	if err != nil || p1 != filepath.Join(dir, "x.txt") || read(p1) != "one" {
		t.Fatalf("first: %q, %v", p1, err)
	}
	p2, err := placeDownloaded(mkTmp("two"), dir, "", "x.txt")
	if err != nil || p2 != filepath.Join(dir, "x (1).txt") || read(p2) != "two" {
		t.Fatalf("second: %q, %v", p2, err)
	}
	// «Скачать как»: существующий файл заменяется
	p3, err := placeDownloaded(mkTmp("three"), dir, p1, "ignored")
	if err != nil || p3 != p1 || read(p1) != "three" {
		t.Fatalf("explicit path: %q, %v", p3, err)
	}
	// имя от сервера не может вывести за пределы папки
	p4, err := placeDownloaded(mkTmp("four"), dir, "", "../evil.txt")
	if err != nil || filepath.Dir(p4) != dir {
		t.Fatalf("traversal: %q, %v", p4, err)
	}
}
