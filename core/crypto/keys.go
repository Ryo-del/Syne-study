package crypto

import (
	"crypto/rand"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
)

const SharedKeySize = chacha20poly1305.KeySize

const (
	argonTime    = 1
	argonMemory  = 19 * 1024
	argonThreads = 1
)

type KeyPair struct {
	PublicKey  []byte
	PrivateKey []byte
}

func WrapKey(key, newX []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(newX)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}

	ciphertext := aead.Seal(nil, nonce, key, nil)

	result := make([]byte, 0, len(nonce)+len(ciphertext))
	result = append(result, nonce...)
	result = append(result, ciphertext...)

	return result, nil
}

func UnwrapKey(wrapped, newX []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(newX)
	if err != nil {
		return nil, err
	}

	nonceSize := chacha20poly1305.NonceSizeX
	if len(wrapped) < nonceSize {
		return nil, fmt.Errorf("wrapped key is too short")
	}

	nonce := wrapped[:nonceSize]
	ciphertext := wrapped[nonceSize:]

	key, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return key, nil
}
func DeriveLoginKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, SharedKeySize)
}

func DerivePasswordHash(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, 32)
}

func GenerateSalt() []byte {
	salt := make([]byte, 16)
	rand.Read(salt)
	return salt
}
