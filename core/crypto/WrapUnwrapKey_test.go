package crypto

import (
	"bytes"
	"crypto/rand"
	"testing"
)

func TestWrapUnwrapKey(t *testing.T) {
	var key = []byte("this is a test key for wrapping and unwrapping")
	wrappingKey := make([]byte, SharedKeySize)
	if _, err := rand.Read(wrappingKey); err != nil {
		t.Fatalf("failed to generate random key: %v", err)
	}
	data, err := WrapKey(key, wrappingKey)
	if err != nil {
		t.Fatalf("failed to wrap key: %v", err)
	}

	unwrappedKey, err := UnwrapKey(data, wrappingKey)
	if err != nil {
		t.Fatalf("failed to unwrap key: %v", err)
	}

	if !bytes.Equal(unwrappedKey, key) {
		t.Fatalf("unwrapped key does not match original key")
	}
}
