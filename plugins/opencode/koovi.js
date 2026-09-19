// Koovi plugin for OpenCode (https://github.com/anomalyco/opencode)
// Forwards session lifecycle events to Koovi to speak turn status and questions.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveLauncher() {
  const localSh = join(__dirname, "koovi.sh");
  if (existsSync(localSh)) return localSh;
  const parentSh = join(__dirname, "..", "koovi.sh");
  if (existsSync(parentSh)) return parentSh;
  return "koovi.sh";
}

function runKoovi(action, payload) {
  try {
    const launcher = resolveLauncher();
    const isWin = process.platform === "win32";
    const proc = isWin
      ? spawn("python", [launcher.replace(/\.sh$/, ".py"), action], {
          stdio: ["pipe", "ignore", "ignore"],
          shell: true,
          detached: true,
        })
      : spawn(launcher, [action], {
          stdio: ["pipe", "ignore", "ignore"],
          shell: true,
          detached: true,
        });

    proc.on("error", () => {});
    if (proc.stdin) {
      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    }
    proc.unref();
  } catch (err) {
    // Non-blocking: Koovi failures should never interrupt OpenCode
  }
}

function handleEvent(event) {
  if (!event || !event.type) return;

  const props = event.properties || {};
  const sessionID = props.sessionID || props.sessionId || props.session_id || "opencode";
  const cwd = props.cwd || process.cwd();
  const payload = {
    session_id: sessionID,
    cwd,
    ...props,
  };

  if (event.type === "message.created" && props.role === "user") {
    runKoovi("prompt", payload);
  } else if (event.type === "session.idle") {
    runKoovi("stop", payload);
  } else if (event.type === "permission.asked") {
    runKoovi("permission", payload);
  } else if (event.type === "session.deleted") {
    runKoovi("session_end", payload);
  }
}

// OpenCode v2 Plugin Definition
export const plugin = {
  id: "koovi",
  async setup(ctx) {
    if (ctx && ctx.event && typeof ctx.event.subscribe === "function") {
      ctx.event.subscribe((event) => {
        handleEvent(event);
      });
    }
    return {
      event: async ({ event }) => {
        handleEvent(event);
      },
    };
  },
};

export default plugin;
