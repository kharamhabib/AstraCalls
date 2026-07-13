package main

import (
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
)

func wrapCall(from types.JID, inner *waBinary.Node) *waBinary.Node {
	content := []waBinary.Node{}
	if inner != nil {
		content = append(content, *inner)
	}
	return &waBinary.Node{
		Tag:     "call",
		Attrs:   waBinary.Attrs{"from": from},
		Content: content,
	}
}

func wrapCallWithPlatform(from types.JID, inner *waBinary.Node, platform, version string) *waBinary.Node {
	content := []waBinary.Node{}
	if inner != nil {
		content = append(content, *inner)
	}
	attrs := waBinary.Attrs{"from": from}
	if platform != "" {
		attrs["platform"] = platform
	}
	if version != "" {
		attrs["version"] = version
	}
	return &waBinary.Node{
		Tag:     "call",
		Attrs:   attrs,
		Content: content,
	}
}
