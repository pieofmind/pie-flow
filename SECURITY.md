# Security notes

This document explains how OmniBoard handles untrusted input. It is meant for
reviewers and for anyone opening a `.board` file that was shared by someone else.

## Threat model

A board is plain JSON (`CanvasModel`) stored in a `.board` file or an embed. A
shared/malicious file is the untrusted input. Because nodes are rendered as HTML
inside an SVG `foreignObject` (set via X6's `content/html`, i.e. `innerHTML`),
any model-derived string that reaches the DOM must be neutralised so a crafted
file cannot inject active content (e.g. an `<img onerror=…>`).

> Note: `innerHTML` does not execute `<script>` tags, but it *does* fire inline
> event handlers (`onerror`, `onload`). So both element text **and HTML
> attributes** must be escaped.

## How untrusted data is rendered

| Path | Sink | Handling |
|---|---|---|
| Node title, ERD column name/type, UML field/method, lane/pool/sequence labels | `nodeHtml()` → `innerHTML` | `esc()` — escapes `& < > " '` (text **and** attribute safe) |
| ERD column key marker (`PK`/`FK`) | `class="kk …"` attribute | whitelisted to `PK`/`FK`/`""` — never interpolates raw model data |
| Node style (`fill`, `stroke`, `color`) | inline `style=""` | `cssSafe()` strips `" ' < > \` (quotes can't break out; `rgb()/hsl()` still work) |
| Font size, border width, label offset, node geometry | inline `style` / SVG attrs | coerced with `Number(v) || 0` |
| Edge label (read-mode embed) | SVG `<text>` | `esc()` (quote-aware) |

All HTML strings are built by the plugin; user data is only ever inserted
through `esc()`, `cssSafe()`, a numeric coercion, or an explicit whitelist.

The `el(tag, cls, html)` DOM helper is only ever called with internal, static
strings (icons, fixed UI labels) — never with model/user data.

## Network & data

- No network requests are made to third parties.
- No telemetry, analytics, or remote logging.
- No `eval`, no remote code loading.

## Reporting

Found something? Open an issue at
<https://github.com/pieofmind/obsidian-omniboard/issues>.
