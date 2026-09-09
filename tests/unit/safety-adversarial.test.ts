import { describe, expect, it } from "vitest";
import { checkCommandSafety, checkRawCommandLine } from "../../src/safety/command-check.js";

function blocked(command: string, args: string[] = [], options: object = {}): string {
  const res = checkCommandSafety(command, args, options);
  expect(res.ok).toBe(false);
  return res.reason ?? "";
}

function allowed(command: string, args: string[] = [], options: object = {}): void {
  expect(checkCommandSafety(command, args, options)).toEqual({ ok: true });
}

describe("shell escape attempts are refused", () => {
  it("blocks every chaining operator", () => {
    blocked("acme", ["init", "&&", "deploy"]);
    blocked("acme", ["init", "||", "deploy"]);
    blocked("acme", ["init;deploy"]);
    blocked("acme", ["init", ";", "deploy"]);
  });

  it("blocks pipes, including into interpreters", () => {
    blocked("acme", ["a", "|", "b"]);
    blocked("curl", ["https://example.com/x", "|", "sh"]);
    blocked("curl", ["https://example.com/x", "|", "bash"]);
    blocked("wget", ["https://example.com/x", "|", "sh"]);
    blocked("curl", ["https://example.com/x", "|", "python3"]);
    blocked("fetch", ["x", "|", "pwsh", "-c", "y"]);
  });

  it("blocks redirection, including descriptor redirects", () => {
    blocked("acme", [">", "out.txt"]);
    blocked("acme", [">>", "out.txt"]);
    blocked("acme", ["<", "in.txt"]);
    blocked("acme", ["2>", "err.txt"]);
  });

  it("blocks command substitution", () => {
    expect(blocked("acme", ["$(whoami)"])).toMatch(/substitution/);
    expect(blocked("acme", ["`whoami`"])).toMatch(/substitution/);
  });

  it("blocks line-break and null-byte injection", () => {
    blocked("acme", ["line1\nline2"]);
    blocked("acme", ["line1\rline2"]);
    blocked("acme", ["line1\r\nline2"]);
    blocked("acme", ["a\0b"]);
  });

  it("blocks privilege escalation and disk destruction", () => {
    blocked("sudo", ["-u", "root", "acme"]);
    blocked("su", ["-", "root"]);
    blocked("su", ["-c", "acme"]);
    blocked("shutdown", ["now"]);
    blocked("mkfs", ["-t", "ext4", "/dev/sda1"]);
    blocked("dd", ["if=/dev/zero", "of=/dev/sda"]);
    blocked("diskpart", []);
    blocked("format", []);
    blocked("format", ["D:"]);
  });

  it("blocks shell code-string execution flags", () => {
    expect(blocked("sh", ["-c", "evil"])).toMatch(/code string/);
    blocked("bash", ["-c", "evil"]);
    blocked("powershell", ["-Command", "evil"]);
    blocked("powershell", ["-NoProfile", "-Command", "evil"]);
    blocked("pwsh", ["-EncodedCommand", "aGk="]);
    blocked("cmd", ["/c", "dir"]);
    blocked("cmd", ["/k", "dir"]);
  });

  it("blocks PowerShell invocation helpers", () => {
    expect(blocked("powershell", ["Invoke-Expression", "x"])).toMatch(/Invoke-Expression|code string/);
  });
});

describe("delete-family commands stay inside the workspace", () => {
  it("blocks absolute and traversal targets for rm/del/erase/rmdir/rd", () => {
    blocked("rm", ["-rf", "/tmp/foo"]);
    blocked("del", ["C:\\Windows\\Temp\\x"]);
    blocked("erase", ["/tmp/x"]);
    blocked("rmdir", ["C:\\proj\\build"]);
    blocked("rd", [".."]);
    blocked("rm", ["../other"]);
  });

  it("allows ordinary relative deletes", () => {
    allowed("rm", ["-rf", "./build"]);
    allowed("rm", ["-rf", "build"]);
    allowed("del", ["notes.txt"]);
    allowed("del", ["/s", "build"]);
    allowed("rmdir", ["/s", "/q", "build"]);
  });
});

describe("no unnecessary false positives", () => {
  it("allows innocuous punctuation in argv", () => {
    allowed("node", ["-e", "1+1"]);
    allowed("node", ["my dir/fix.mjs"]);
    allowed("npm", ["install", "foo@^1.2.3"]);
    allowed("acme", ["deploy", "--message", "hello"]);
    allowed("C:\\tools\\foo.exe", ["init"]);
    allowed("git", ["commit", "-m", "msg"]);
    allowed("foo", ["--flag=value"]);
  });

  it("passes env-style values through literally without a shell to expand them", () => {
    // Without shell:true there is no expansion step: these reach the child
    // as literal argv. Documented boundary, not a bypass.
    allowed("acme", ["--token", "$HOME"]);
    allowed("acme", ["%PATH%"]);
  });

  it("allows plain shell scripts without code-string flags", () => {
    allowed("sh", ["script.sh"]);
  });
});

describe("raw command lines", () => {
  it("refuses unparseable input instead of guessing", () => {
    expect(checkRawCommandLine("acme \"oops").ok).toBe(false);
    expect(checkRawCommandLine("   ").ok).toBe(false);
  });

  it("checks tokenized raw lines like argv", () => {
    expect(checkRawCommandLine("acme init && deploy").ok).toBe(false);
    expect(checkRawCommandLine("acme init").ok).toBe(true);
  });
});
