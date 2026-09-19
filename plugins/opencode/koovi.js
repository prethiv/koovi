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
    const script = launcher.endsWith(".sh") ? launcher.replace(/\.sh$/, ".py") : launcher;
    const proc = isWin
      ? spawn("python", [script, action], {
          stdio: ["pipe", "ignore", "ignore"],
        })
      : spawn(launcher, [action], {
          stdio: ["pipe", "ignore", "ignore"],
        });

    proc.on("error", () => {});
    if (proc.stdin) {
      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    }
  } catch (err) {
    // Non-blocking: Koovi failures should never interrupt OpenCode
  }
}

let sessionLastText = {};

function handleEvent(event) {
  if (!event || !event.type) return;

  const props = event.properties || {};
  const sessionID = props.sessionID || props.sessionId || props.session_id || "opencode";
  const cwd = props.cwd || process.cwd();

  // Track assistant text so Koovi knows if it ended in a question
  if (event.type === "message.updated" || event.type === "message.created") {
    const info = props.info || props.message || props;
    if (info.role === "assistant" && (info.content || info.text)) {
      sessionLastText[sessionID] = info.content || info.text;
    } else if (info.role === "user") {
      runKoovi("prompt", { session_id: sessionID, cwd, ...props });
    }
  } else if (event.type === "message.part.updated" || event.type === "message.part.created") {
    const part = props.part || {};
    if (part.text) {
      sessionLastText[sessionID] = (sessionLastText[sessionID] || "") + (props.delta || part.text);
    }
  }

  const payload = {
    session_id: sessionID,
    cwd,
    last_assistant_message: sessionLastText[sessionID] || props.last_assistant_message || "",
    ...props,
  };

  const isIdle = event.type === "session.idle" ||
    (event.type === "session.status" && (props.status === "idle" || props.status === "stopped"));

  if (isIdle) {
    runKoovi("stop", payload);
    delete sessionLastText[sessionID];
  } else if (event.type === "permission.asked") {
    runKoovi("permission", payload);
  } else if (event.type === "session.deleted") {
    runKoovi("session_end", payload);
    delete sessionLastText[sessionID];
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
