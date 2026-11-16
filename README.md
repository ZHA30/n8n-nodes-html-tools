# n8n-nodes-html-tools

Detect the language of HTML or plain text and translate HTML with Google or Microsoft in n8n.

> [!NOTE]
> This package is intended for self-hosted n8n.

> [!WARNING]
> Translation sends content to undocumented Google or Microsoft endpoints that require no API key and may change or become unavailable.

## Install

Install `n8n-nodes-html-tools` through **Settings → Community Nodes** in self-hosted n8n, or use npm in your n8n community-node directory.

```sh
npm i n8n-nodes-html-tools
```

## Features

Use the two nodes independently or combine language detection with HTML translation.

- **Language Detect** identifies the primary language locally with tinyld, ignores HTML language declarations, and returns a language code or `und` when undetermined.
- **HTML Translate** translates body text while retaining links, images, inline formatting, and content excluded from translation.
- **Bilingual output** places translations after the original text within each paragraph, list item, or table cell.

## References

- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)
- [tinyld](https://github.com/komodojp/tinyld)
- [Lucide](https://lucide.dev/)
