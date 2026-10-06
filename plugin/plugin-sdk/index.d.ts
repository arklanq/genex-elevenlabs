/**
 * Studio plugin SDK — the typed contract a plugin is written against.
 *
 * Self-contained on purpose: a plugin package is built outside this repository, so nothing here
 * imports from `src/shared` or any other Studio path. `PluginManifest` below is a mirror of
 * `src/shared/plugins.ts`; `tests/conformance/plugin-sdk-types.test.ts` compiles the two against
 * each other in both directions, so a change to one that is not mirrored fails the suite.
 *
 * API 2 is additive over API 1. New manifest sections arrive as further optional fields; nothing
 * documented here is removed.
 *
 * A backend written in JavaScript points its JSDoc at the copy of this file it ships beside:
 * `@type {import('./plugin-sdk/index.d.ts').Activate}` on `export const activate`. One in
 * TypeScript imports `Activate` from the same path. Either way the host-service names, the
 * activation shape and the panel bridge are checked before anyone installs the package.
 */

/** API 3. Runtime names and launch recipes come from reviewed plugin code, never tool inputs. */
export interface PluginNativeRuntime {
  id: string;
  label: string;
  candidates: string[];
  version: { args: string[]; pattern: string; minimum: string };
  install?: {
    action: string;
    url: string;
    sha256: string;
    bytes: number;
    unpackedBytes: number;
    format: "dmg" | "tar.gz";
    entry: string;
    executable: string;
    notices: string[];
  };
}
export type PluginNativeArg = string | { source: "package" | "input" | "output" | "value"; name: string };
export interface PluginNativeJob {
  id: string;
  runtime: string;
  args: PluginNativeArg[];
  inputs: string[];
  values: Record<string, { pattern: string; maxLength: number }>;
  outputs: string[];
  /** Integer milliseconds, 1000–300000. Expiry terminates the local process. */
  timeoutMs: number;
  /** Retained stdout/stderr tail per stream, 1–256000 bytes. This is not the asset size. */
  maxOutputBytes: number;
  /** Maximum aggregate bytes in declared generated files, 1–104857600. */
  maxAssetBytes: number;
  /** Needed for GPU rendering, including Blender EEVEE; permits the runtime's Metal cache. */
  gpu?: boolean;
}
export interface PluginNativeStatus {
  state: "ready" | "missing" | "incompatible" | "failed";
  path?: string;
  version?: string;
  detail: string;
}
export interface PluginRuntimeInstall {
  runtime: string;
  phase: "preflight" | "downloading" | "verifying" | "extracting" | "ready" | "failed" | "cancelled" | "interrupted";
  completed: number;
  total: number;
  active: boolean;
  updatedAt: string;
  error?: string;
}
export interface PluginNativeResult {
  inputs?: Record<string, { file: string; sha256: string }>;
  id: string;
  recipe: string;
  runtime: string;
  version?: string;
  state: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  project: string;
  output: string;
  files: string[];
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  reason?: string;
  createdAt: string;
  finishedAt?: string;
}

export type PluginApiVersion = 1 | 2 | 3;
export type PluginScalar = string | number | boolean;

/** Host services a manifest may declare. `export` is API 2. */
export type PluginCapability =
  | "settings"
  | "project.read"
  | "project.write"
  | "credentials"
  | "external-auth"
  | "observe"
  | "jobs"
  | "network"
  | "export"
  | "native-runtime";

export interface PluginTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; acceptJsonString?: boolean }>;
    required?: string[];
  };
  /** API 2: the tool needs the user's consent before it runs. 1–300 characters. */
  confirmation?: string;
}

/**
 * A program Studio itself runs for a manifest tool instead of your backend. Reserved for the
 * bundled Genex plugin on API 3; any other plugin that names one is refused.
 */
export type PluginHostTool = "genex-cli" | "genex-cli-paid" | "genex-package";

/** A tool as your manifest declares it. Agents see it as a plain `PluginTool`. */
export interface PluginManifestTool extends PluginTool {
  /** Reserved for the bundled Genex plugin. */
  host?: PluginHostTool;
}

/** A skill whose text sits in the manifest (1–16 000 characters); agents get all of it in their brief. */
export interface PluginInlineSkill {
  name: string;
  text: string;
}

/**
 * API 3: a skill whose text is a Markdown file in your package (at most 128 KiB, 1 MiB for all
 * skill files together). Agents get the summary in their brief and read the file, and its
 * references, on demand through the host's `<pluginId>__skill` tool, so a manifest with a file
 * skill may not declare a tool named `skill`. Paths are package-relative, end in `.md` and never
 * pass through a dot folder.
 */
export interface PluginFileSkill {
  name: string;
  /** 1–300 characters. */
  summary: string;
  file: string;
  /** At most 16, each distinct from `file`. */
  references?: string[];
}

/** One of at most 32 skills a plugin gives agents; names are unique. */
export type PluginSkill = PluginInlineSkill | PluginFileSkill;

export type PluginToolbarTarget =
  | { kind: "action"; name: string; args?: Record<string, PluginScalar> }
  | { kind: "panel"; id: string };

export interface PluginToolbarItem {
  id: string;
  /** 1–24 characters and not one of Studio's reserved stage-strip labels. */
  label: string;
  /** 1–60 characters, unique across the manifest. */
  ariaLabel: string;
  /** A glyph of at most 4 characters, or a host icon: globe, export, play, image, box, boxes. */
  icon?: string;
  /** Default true: the button waits for a loaded game. */
  requiresProject?: boolean;
  target: PluginToolbarTarget;
  /** Names a declared action without confirmation that returns a PluginToolbarStatus. */
  status?: string;
}

export interface PluginToolbarStatus {
  badge?: string;
  disabled?: boolean;
  title?: string;
  tone?: "ok" | "warn" | "err" | "info";
  /** The button's action is due now: Studio draws it in the accent fill, otherwise in the quiet one. */
  attention?: boolean;
}

/**
 * Where one environment variable of a plugin's MCP server gets its value. The manifest names a
 * source, never a value: `setting:<key>` a declared setting, `secret:<name>` a value the user
 * stored for this connector, `literal:<value>` a constant, and `credential-file` the plugin's own
 * credential. For a `node` server the variable is set to `/dev/fd/3`: Studio writes the bare token
 * (no `NAME=` framing, no trailing newline) to an anonymous pipe on file descriptor 3 and closes
 * it, so the token never travels in the environment. Read it once at start-up, for example
 * `readFileSync(process.env.MY_TOKEN_FILE, 'utf8')`; an empty read means the account is locked.
 */
export type PluginMcpEnvValue = `setting:${string}` | `secret:${string}` | `literal:${string}` | "credential-file";

/**
 * API 2: an MCP server the plugin ships. Studio runs it as a connector the plugin owns — started
 * with it, stopped with it, removed with it, and trusted by the plugin's own install dialog. Its
 * tools reach every coding path as `<pluginId>-<id>__<tool>`.
 */
export interface PluginMcpServer {
  /** Lowercase letters, digits and dashes, no `_`, at most 32 characters. */
  id: string;
  transport: "stdio";
  /** `node` runs a script inside your package; `host-cli` is reserved for the bundled Genex plugin. */
  command: "node" | "host-cli";
  /** For `node`, `args[0]` is the script, relative to the package root. */
  args: string[];
  /** Plugin storage, or a per-project folder inside it. HOME is set inside whichever you pick. */
  cwd: "storage" | "storage:project";
  env?: Record<string, PluginMcpEnvValue>;
  /** What must be true before the server is started; otherwise it is listed with the reason. */
  requires?: { credential?: boolean; settings?: string[] };
  /** Raw MCP tool names. Deny wins; Studio caps a connector at 64 tools regardless. */
  toolPolicy?: { allow?: string[]; deny?: string[] };
  maxTools?: number;
  /** At most 1 800 000. */
  callTimeoutMs?: number;
  description: string;
}

export interface PluginManifest {
  /** API 3: delivery limits enforced by the host per plugin and project. */
  assetLimits?: { fileBytes: number; projectBytes: number };
  nativeRuntimes?: PluginNativeRuntime[];
  nativeJobs?: PluginNativeJob[];
  apiVersion: PluginApiVersion;
  id: string;
  version: string;
  name: string;
  publisher: string;
  description: string;
  backend: string;
  capabilities: string[];
  tools: PluginManifestTool[];
  skills: PluginSkill[];
  panels: Array<{ id: string; title: string; file: string; placement: "settings" | "project" }>;
  settings: Array<{
    key: string;
    label: string;
    type: "string" | "boolean" | "number";
    default: string | boolean | number;
  }>;
  actions: Array<{ name: string; label: string; confirmation?: string }>;
  /** API 2: hosts the backend talks to, disclosed at install and checked by the static scan. */
  network?: { hosts: string[] };
  /** API 2: up to four buttons contributed beside Live/Builds. */
  toolbar?: PluginToolbarItem[];
  /** API 2: up to four MCP servers the plugin ships, run by the host as connectors it owns. */
  mcpServers?: PluginMcpServer[];
  /** Host-managed account flow. Status may finish a pending browser authorization. */
  account?: { connect: string; unlock: string; disconnect: string; status: string; cancel?: string };
  /**
   * The plugin's picture, like an app's in the Dock: a .png, .jpg, .webp or .svg file in the
   * package (at most 512 KiB), square and full-bleed; Studio rounds the corners. Without one
   * Studio shows the plugin's initial.
   */
  icon?: string;
}

/** What `export.stage` returns: Studio's public copy of the bound game. */
export interface PluginExportResult {
  dir: string;
  files: number;
  included: string[];
  excluded: string[];
}

/** Sanitized progress for Studio. `kind: 'toolbar'` updates a toolbar item's badge. */
export interface PluginEvent {
  kind?: string;
  item?: string;
  badge?: string;
  title?: string;
  tone?: PluginToolbarStatus["tone"];
  attention?: boolean;
  [key: string]: unknown;
}

/**
 * The host services a plugin may call, each gated by the matching capability and answered only
 * during an active invocation. An unknown method name is a type error, not a runtime surprise.
 */
export interface PluginHostCall {
  (method: "runtime.detect", args: { runtime: string }): Promise<PluginNativeStatus>;
  (method: "runtime.install", args: { runtime: string }): Promise<PluginNativeStatus>;
  (method: "runtime.installation", args: { runtime: string }): Promise<PluginRuntimeInstall | null>;
  /** User setup actions only. Downloaded partial bytes remain available for retry. */
  (method: "runtime.cancelInstall", args: { runtime: string }): Promise<true>;
  (
    method: "native.run",
    args: { job: string; inputs: Record<string, string>; values: Record<string, string> },
  ): Promise<PluginNativeResult>;
  (method: "native.jobs"): Promise<PluginNativeResult[]>;
  (method: "native.result", args: { id: string }): Promise<PluginNativeResult | null>;
  /**
   * Every setting this version declares: the stored value when it has the declared type, else the
   * default. A key an earlier version declared, or stored under another type, is never returned.
   */
  (method: "settings.read"): Promise<Record<string, PluginScalar>>;
  (method: "storage.root"): Promise<string>;
  (method: "project.read", args: { path: string }): Promise<string>;
  (method: "project.write", args: { path: string; text: string }): Promise<{ file: string }>;
  (method: "assets.deliver", args: { output: string; jobId: string }): Promise<string[]>;
  (method: "export.stage"): Promise<PluginExportResult>;
  (method: "jobs.read", args: { id: string }): Promise<unknown>;
  (method: "jobs.write", args: { id: string; value: unknown }): Promise<true>;
  (method: "events.emit", args: PluginEvent): Promise<true>;
  (method: "observe", args: { project: string; root: string; files: string[] }): Promise<unknown>;
  /** Current plugin's explicitly unlocked memory lease; null never triggers OS access. */
  (method: "credentials.session"): Promise<string | null>;
  (method: "credentials.read"): Promise<string | null>;
  (method: "credentials.write", args: { token: string }): Promise<void>;
  (method: "credentials.clear"): Promise<void>;
}

/**
 * The object handed to `activate`. Activation must be side-effect-free and must not call the
 * host: an installation probe loads the backend with no account or project authority.
 */
export interface PluginHost {
  call: PluginHostCall;
}

/**
 * One invocation's binding. Never store it: concurrent calls can belong to different games and
 * different workers.
 */
export interface PluginContext {
  /** The bound game, when the call has one. */
  project?: string;
  /** The bound game's worktree. */
  directory?: string;
  threadId?: string;
  /** Aborted when the user stops the turn. Local waiting ends; remote work may continue. */
  signal: AbortSignal;
  callId: number;
  host: PluginHostCall;
}

/** What an optional `review` returns before a confirmed action reaches the native dialog. */
export interface PluginReview {
  message?: string;
  images?: Array<{ label: string; dataUrl: string }>;
}

export interface PluginActivation {
  /** Agent-invoked, named `<plugin>__<tool>` in engines. Parameters are scalars. */
  tool?(name: string, args: Record<string, PluginScalar>, context: PluginContext): Promise<unknown>;
  /** User-invoked from a panel, the Plugins dialog or a toolbar button. Never an agent tool. */
  action?(name: string, args: Record<string, unknown>, context: PluginContext): Promise<unknown>;
  /** Host-rendered evidence for a confirmed action. */
  review?(name: string, args: Record<string, unknown>, context: PluginContext): Promise<PluginReview>;
}

/** The backend module's single export. */
export type Activate = (host: PluginHost) => PluginActivation | Promise<PluginActivation>;

/** What `studioPlugin.call('context')` answers inside a panel frame. */
export interface PluginPanelContext {
  project: string | null;
  apiVersion: PluginApiVersion;
  theme: { background: string; foreground: string; accent: string };
}

/** The framework-free helpers `src/plugin-sdk/ui.js` installs on the bridge. */
export interface StudioPluginUi {
  text(tag: string, value: unknown): HTMLElement;
  status(label: string, value: unknown): HTMLElement;
  error(message: unknown): HTMLElement;
  job(job: Record<string, unknown>): HTMLElement;
}

/**
 * The only bridge a panel has. The frame is sandboxed with an opaque origin and no Studio
 * preload: there is no `window.studio`, no `require` and no direct IPC.
 */
export interface StudioPluginPanel {
  /** Host context changed; re-read status. No secrets are included in notifications. */
  onContextChanged(callback: () => void): () => void;
  call(method: "context"): Promise<PluginPanelContext>;
  call(method: "settings"): Promise<Record<string, PluginScalar>>;
  call(
    method: "action",
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs: number },
  ): Promise<unknown>;
  /** Present once `src/plugin-sdk/ui.js` is inlined after `panel.js`. */
  ui?: StudioPluginUi;
}

declare global {
  interface Window {
    studioPlugin: StudioPluginPanel;
  }
}
