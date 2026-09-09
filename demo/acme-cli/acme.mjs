#!/usr/bin/env node
// Demo fixture CLI for RecoverySpec.
// Behaviour is driven by the ACME_SCENARIO env var plus state files under .acme/ in cwd.
// Each scenario models one recovery-path shape (working, broken, ambiguous, unsafe, ...).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const scenario = process.env["ACME_SCENARIO"] ?? "default";
const [command, ...rest] = process.argv.slice(2);
const SELF = "node demo/acme-cli/acme.mjs";

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function ok(message) {
  process.stdout.write(message + "\n");
  process.exit(0);
}

function hasFile(rel) {
  return existsSync(path.join(process.cwd(), rel));
}

function writeState(rel, content) {
  const full = path.join(process.cwd(), rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function unknownCommand(name) {
  fail("Unknown command: " + name + ".");
}

switch (command) {
  case "init": {
    writeState(".acme/initialized", "yes\n");
    writeState(".acme/config.json", JSON.stringify({ initialized: true, project: "test" }, null, 2) + "\n");
    ok("Initialized project.");
    break;
  }
  case "login": {
    const tokenFlag = rest.find((a) => a.startsWith("--token"));
    if (scenario === "dead-end") {
      // Reports success but never creates the token publish checks: a dead end.
      ok("Logged in.");
      break;
    }
    if (scenario === "loop") {
      fail("Login needs configuration. Run `" + SELF + " configure` first.");
      break;
    }
    if (scenario === "two-step") {
      writeState(".acme/logged-in", "yes\n");
      ok("Logged in. Now run `" + SELF + " select-org` to choose an organization.");
      break;
    }
    writeState(".acme/logged-in", "yes\n");
    if (tokenFlag) ok("Logged in with token.");
    ok("Logged in.");
    break;
  }
  case "login-prompt": {
    // Reads two stdin lines (email, password): used to test scripted stdin.
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      const lines = data.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) fail("Expected email and password on stdin.");
      writeState(".acme/logged-in", lines[0] + "\n");
      ok("Logged in as " + lines[0] + ".");
    });
    break;
  }
  case "configure": {
    // Only exists to form a loop with `login` under the loop scenario.
    fail("Configure needs a session. Run `" + SELF + " login` first.");
    break;
  }
  case "select-org": {
    writeState(".acme/org-selected", "acme-corp\n");
    ok("Organization selected.");
    break;
  }
  case "deploy": {
    if (scenario === "two-step") {
      if (!hasFile(".acme/logged-in")) fail("Authentication required. Run `" + SELF + " login`.");
      if (!hasFile(".acme/org-selected")) fail("No organization selected. Run `" + SELF + " select-org`.");
      ok("Deployed successfully.");
      break;
    }
    if (scenario === "stale") {
      fail("Deploy failed. Run `" + SELF + " setup` to prepare the project.");
      break;
    }
    if (scenario === "missing-tool") {
      fail("Deploy failed. Run `acme-v2-migrator init` to migrate your project.");
      break;
    }
    if (scenario === "ambiguous") {
      fail("Could not deploy. Run `" + SELF + " init` or run `" + SELF + " login`.");
      break;
    }
    if (scenario === "unsafe") {
      fail("Deploy failed. Run `sudo rm -rf /` to clean the build cache.");
      break;
    }
    if (scenario === "no-advice") {
      fail("Deploy failed: something went wrong.");
      break;
    }
    if (scenario === "structured") {
      if (hasFile(".acme/initialized")) {
        ok("Deployed successfully.");
        break;
      }
      const payload = {
        code: "NOT_INITIALIZED",
        message: "Project not initialized",
        recovery: { commands: [["node", "demo/acme-cli/acme.mjs", "init"]], retry: true }
      };
      process.stdout.write(JSON.stringify(payload) + "\n");
      process.exit(2);
      break;
    }
    if (!hasFile(".acme/initialized")) {
      fail("Project not initialized. Run `" + SELF + " init` to create it.");
    }
    ok("Deployed successfully.");
    break;
  }
  case "publish": {
    if (scenario === "dead-end") {
      if (!hasFile(".acme/token")) fail("Authentication required. Run `" + SELF + " login`.");
      ok("Published successfully.");
      break;
    }
    if (scenario === "partial") {
      if (!hasFile(".acme/logged-in")) fail("Authentication required. Run `" + SELF + " login`.");
      fail("No organization selected.");
      break;
    }
    if (!hasFile(".acme/logged-in")) fail("Authentication required. Run `" + SELF + " login`.");
    ok("Published successfully.");
    break;
  }
  case "status": {
    ok(hasFile(".acme/initialized") ? "Ready" : "Not initialized");
    break;
  }
  case "hang": {
    await new Promise((resolve) => setTimeout(resolve, 30000));
    ok("Finished hanging.");
    break;
  }
  case "--help":
  case "help":
  case undefined: {
    ok("Usage: acme <init|login|deploy|publish|status|select-org|configure>");
    break;
  }
  default: {
    unknownCommand(command);
    break;
  }
}
