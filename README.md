# ElevenLabs plugin for Genex

A [Genex](https://github.com/genex-games/genex-desktop) plugin that makes speech, sound effects and music with **your own ElevenLabs API key**, so generation is paid from your ElevenLabs plan instead of Genex credits.

The package lives in [`plugin/`](plugin). Tests live outside it, so they are not installed.

## What it adds

- `elevenlabs__status`: the account state, the plan's credit use and the recent files. Free.
- `elevenlabs__voices`: searches the voices your account can use. Free.
- `elevenlabs__generate`: one paid audio file, with the user's consent each time. Operations: `speech` (text and a voice id), `sfx` (a prompt, 0.5–30 s, optional loop) and `music` (a prompt, 3–600 s).

Files are copied into the game under `assets/elevenlabs/<id>/<name>.mp3` (`public/assets/…` for games with a build step). `output_format` may be `mp3_*`, `wav_*` or `opus_*`; the default is `mp3_44100_128`.

## Install

1. In Genex: **Plugins → Add → Install from GitHub** and paste `https://github.com/arklanq/genex-elevenlabs`. Studio installs the latest release. To install by hand instead, download `elevenlabs-<version>.zip` from [Releases](https://github.com/arklanq/genex-elevenlabs/releases), unpack it and choose its folder with **Plugins → Add → Load local plugin…**.
2. Press **Connect** on the ElevenLabs row, paste your key from elevenlabs.io (Developers → API Keys) and press **Connect**. The plugin checks the key with ElevenLabs before Studio saves it. A key restricted so it cannot read the plan is still accepted; the panel then shows no credit use.
3. Studio unlocks the saved key again after a restart. If the panel asks for a key anyway, paste it again.

## Limits

- One call may take at most 180 s (Studio ends plugin calls after 190 s). Long music can run out of time; ask for shorter tracks.
- ElevenLabs returns the audio in the same answer and has no job to resume, so a call that fails or times out is not recoverable. Read its error before asking again.
- Music needs a paid ElevenLabs plan.

## Develop

```bash
npm test
```

Check the package with Genex's doctor from a genex-desktop checkout:

```bash
npm run plugin:doctor -- /path/to/genex-elevenlabs/plugin
```

## Release

Bump `version` in `plugin/plugin.json` and `package.json`, commit, then push a matching tag:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The Release workflow runs the tests and publishes a GitHub release with `elevenlabs-<version>.zip` attached.
