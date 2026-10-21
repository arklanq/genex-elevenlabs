# ElevenLabs for Genex

A [Genex](https://github.com/genex-games/genex-desktop) plugin that makes speech, sound effects and music with your own ElevenLabs API key, instead of Genex credits.

## Install

1. In Genex, open **Plugins → Add → Install from GitHub** and paste `https://github.com/arklanq/genex-elevenlabs`.
2. Press **Connect** and paste your API key from elevenlabs.io (**Developers → API Keys**).

## Tools

| Tool | What it does |
| --- | --- |
| `arklanq-elevenlabs__status` | Shows your account, credit usage and recent files. Free. |
| `arklanq-elevenlabs__voices` | Searches the voices you can use. Free. |
| `arklanq-elevenlabs__generate` | Makes one audio file (`speech`, `sfx` or `music`) in `assets/arklanq-elevenlabs/`. Paid, and asks for consent each time. |

## Notes

- A call can take up to 180 s. A call that fails cannot be resumed.
- Music needs a paid ElevenLabs plan.

## Develop

```bash
npm test
```

To check the package, run this from a genex-desktop checkout:

```bash
npm run plugin:doctor -- /path/to/genex-elevenlabs/plugin
```

## Release

Bump `version` in `plugin/plugin.json` and `package.json`, commit, then push a matching tag, such as `v0.2.0`. The workflow publishes a GitHub release with `arklanq-elevenlabs-<version>.zip`.
