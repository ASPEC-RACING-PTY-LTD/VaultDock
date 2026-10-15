//go:build !windows

package updater

import "errors"

func launch(path, args string) error { return errors.New("installing updates requires Windows") }
