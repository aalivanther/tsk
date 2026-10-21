package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// minPasswordLength es la longitud mínima de contraseña aceptada.
const minPasswordLength = 8

// maxPasswordLength es la longitud máxima de contraseña aceptada, en BYTES.
//
// En español: bcrypt (el algoritmo con el que se guardan las contraseñas) solo mira los primeros 72
// bytes y descarta el resto SIN AVISAR. Si aceptáramos contraseñas más largas, dos contraseñas
// distintas que coincidieran en esos 72 bytes abrirían la misma cuenta, y nadie entendería por qué.
// Es mejor rechazarlas con un mensaje claro que fingir que se usan enteras.
const maxPasswordLength = 72

// userIDBytes es cuánta aleatoriedad lleva el identificador de una cuenta: 16 bytes = 128 bits.
// En español: suficiente para que dos cuentas jamás coincidan y para que un identificador no se
// pueda adivinar a partir de otro.
const userIDBytes = 16

// decoyPasswordHash es una huella bcrypt SEÑUELO: no corresponde a la contraseña de nadie.
//
// En español: se usa cuando alguien intenta entrar con un correo que no tiene cuenta. Comprobar una
// contraseña contra esta huella cuesta el mismo tiempo que comprobarla contra una real, así que el
// reloj no delata qué correos están registrados. Sin este truco, un atacante no necesitaría leer el
// mensaje de error: le bastaría con medir que las respuestas "no existe" llegan mucho más rápido.
var decoyPasswordHash = mustGenerateDecoyHash()

// mustGenerateDecoyHash crea la huella señuelo al arrancar el proceso.
// Si bcrypt fallara aquí (no ocurre con parámetros válidos), es preferible no arrancar a operar sin
// esa defensa, así que se detiene el programa con un mensaje explícito.
func mustGenerateDecoyHash() string {
	hash, err := bcrypt.GenerateFromPassword([]byte("tsk-decoy-password-no-real"), bcrypt.DefaultCost)
	if err != nil {
		panic(fmt.Sprintf("auth: no se pudo generar el hash señuelo: %v", err))
	}
	return string(hash)
}

// hashPassword calcula la huella bcrypt de una contraseña en texto plano.
// En español: bcrypt es lento a propósito (unas décimas de segundo). Esa lentitud es la defensa:
// hace que probar millones de contraseñas contra una base robada resulte inviable.
func hashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("auth: no se pudo hashear la contraseña: %w", err)
	}
	return string(hash), nil
}

// checkPassword compara una contraseña en texto plano contra su huella. Devuelve nil si coincide.
func checkPassword(hash, plain string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
}

// newUserID genera el identificador opaco y aleatorio de una cuenta nueva.
func newUserID() (string, error) {
	buffer := make([]byte, userIDBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("auth: no se pudo generar el identificador de la cuenta: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}
