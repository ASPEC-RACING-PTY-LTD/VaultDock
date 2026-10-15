//go:build bindings

package main

// Wails builds the app with the "bindings" tag and runs it to generate the
// JavaScript bindings; nothing may touch the user's profile in that mode.
const generatingBindings = true
