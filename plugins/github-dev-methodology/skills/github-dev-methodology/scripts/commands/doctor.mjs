import { UsageError } from "../lib/errors.mjs";
import { runDoctorChecks } from "../lib/doctor-checks.mjs";
import { parseFlags } from "../lib/setup-args.mjs";

function formatText(findings) {
  if (findings.length === 0) return "doctor: ok\n";
  return `${findings.map(({ level, message }) => `${level === "error" ? "error" : "warn"}: ${message}`).join("\n")}\n`;
}

export async function run(args, ctx) {
  const { positionals } = parseFlags(args);
  if (positionals.length > 0) throw new UsageError("usage: gdm doctor [--json]");
  const findings = await runDoctorChecks(ctx);
  const errors = findings.filter((item) => item.level === "error");
  if (ctx.json) {
    const report = {
      ok: errors.length === 0,
      errors: errors.map((item) => item.message),
      warnings: findings.filter((item) => item.level === "warn").map((item) => item.message),
    };
    ctx.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    ctx.stdout.write(formatText(findings));
  }
  return errors.length > 0 ? 1 : 0;
}
