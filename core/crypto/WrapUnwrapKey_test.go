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
func TestPasswordDerivedKeyRoundTrip(t *testing.T) {
	password := "correct horse battery staple"

	salt, err := GenerateSalt()
	if err != nil {
		t.Fatalf("failed to generate salt: %v", err)
	}

	masterKey := make([]byte, SharedKeySize)
	if _, err := rand.Read(masterKey); err != nil {
		t.Fatalf("failed to generate master key: %v", err)
	}

	loginKey := DeriveLoginKey(password, salt)
	wrapped, err := WrapKey(masterKey, loginKey)
	if err != nil {
		t.Fatalf("failed to wrap master key: %v", err)
	}

	// Симулируем вход на новом ПК: та же соль (пришла бы с сервера),
	// тот же пароль (ввёл пользователь) — должны получить тот же Login Key.
	loginKeyAgain := DeriveLoginKey(password, salt)
	unwrapped, err := UnwrapKey(wrapped, loginKeyAgain)
	if err != nil {
		t.Fatalf("failed to unwrap master key: %v", err)
	}

	if !bytes.Equal(unwrapped, masterKey) {
		t.Fatal("recovered master key does not match original")
	}

	// Неправильный пароль не должен позволять расшифровать
	wrongLoginKey := DeriveLoginKey("wrong password", salt)
	if _, err := UnwrapKey(wrapped, wrongLoginKey); err == nil {
		t.Fatal("expected error when unwrapping with wrong password, got nil")
	}
}
