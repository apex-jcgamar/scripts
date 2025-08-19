import simpleGit from 'simple-git';
import readline from 'readline';
import { execSync } from 'child_process'
import { writeFile, readFile } from 'fs/promises'
import { spawn } from "child_process";
import chalk from "chalk";

type StepStatus = "success" | "failed" | "pending";

interface BuildState {
  plan: string[];
  stepDetails: Record<string, StepStatus>;
}

type DatabaseSchema = Record<string, BuildState | undefined>;

const dbFile = "/home/jgama/workspace/scripts/mini-ci-db.json";
const baseDir = "/home/jgama/workspace/source";
const git = simpleGit({ baseDir });

const styles = {
  info: chalk.blue,
  warning: chalk.yellow,
  error: chalk.red,
  success: chalk.green,
  highlight: chalk.cyan,
  header: chalk.bold.magenta,
  command: chalk.cyan.dim,
  branch: chalk.green.bold,
};

function arraysEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((val, index) => val === arr2[index]);
}

const askQuestion = (question: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
};

const generateBffCommands = (files: string[]) => {
  const commands: string[] = [
    //   `grep console.log -r ${baseDir}/apex-online/apex-grql`,
  ];

  if (!files?.length) return commands;
  if (files.some((f) => /\w+\.graphql/.test(f))) {
    commands.push("bazel build //apex-online:all_gql_types");
    commands.push("bazel run //apex-online:update_gql_types");
  }

  // commands.push("bazel run //apex-online/apex-grql:lint_typescript");
  commands.push("bazel build //apex-online/apex-grql:compile_ts");

  return commands;
};

const generateAscendUiCommands = (files: string[]) => {
  const commands: string[] = [
    //   `grep console.log -r ${baseDir}/ascend-ui/app/src/client-config`,
  ];

  if (!files?.length) return commands;
  if (files.some((f) => /\w+\.graphql/.test(f))) {
    commands.push("bazel build //apex-online:all_gql_types");
    commands.push("bazel run //apex-online:update_gql_types");
    commands.push("bazel build //apex-online/apex-grql:operation_rpc_mapping");
    commands.push(
      "bazel run //apex-online/apex-grql:update_operation_rpc_mapping"
    );
  }

  // commands.push("bazel run //ascend-ui/app:ts_lint_test");
  commands.push("bazel run //ascend-ui/app:ts_types_test");

  return commands;
};

const mergeCommands = (dbState: NonNullable<DatabaseSchema[string]>) => {
  const commands = Object.entries(dbState.stepDetails)
    .filter(([, status]) => status !== "success")
    .map(([command]) => command);
  return commands;
};

const validateFiles = async (files: string[]): Promise<boolean> => {
  if (files.length > 30) {
    const ans = await askQuestion(`${files.length} files. continue? (yes/no) `);
    return ans === "yes";
  }
  return true;
};

const initializeBuildState = (commands: string[]): BuildState => ({
  plan: commands,
  stepDetails: commands.reduce((acc, curr) => {
    acc[curr] = "pending";
    return acc;
  }, {} as Record<string, StepStatus>),
});

const loadDatabase = async (): Promise<DatabaseSchema> => {
  try {
    const dbText = await readFile(dbFile, "utf-8");
    return JSON.parse(dbText) as DatabaseSchema;
  } catch (error) {
    console.warn(styles.warning("Could not load database, starting fresh"));
    return {};
  }
};

const executeCommand = (command: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(" ");
    const childProcess = spawn(cmd, args, {
      cwd: baseDir,
      stdio: "inherit",
    });

    childProcess.on("close", (code: number | null) => {
      resolve(code === 0);
    });
  });
};

const main = async () => {
  // Show help if requested
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(styles.header("\n🛠️  Mini CI Runner"));
    console.log(styles.info("\nUsage:"));
    console.log("  ts-node mini-ci.ts [options]");
    console.log(styles.info("\nOptions:"));
    console.log(
      `  ${styles.highlight(
        "--full"
      )}    Execute the complete plan, skip checkpoint question`
    );
    console.log(`  ${styles.highlight("--help, -h")} Show this help message`);
    console.log("");
    process.exit(0);
  }

  const db = await loadDatabase();

  // Check for --full flag
  const executeFullPlan = process.argv.includes("--full");

  const { current: branch } = await git.status();
  if (!branch) throw new Error("No branch!");

  const diffBlock = await git.diff(["main", "--name-only"]);
  const files = diffBlock.split("\n");

  if (!(await validateFiles(files))) {
    process.exit(0);
  }

  let commands = [
    ...generateBffCommands(
      files.filter((f) => f.startsWith("apex-online/apex-grql"))
    ),
    ...generateAscendUiCommands(
      files.filter((f) => f.startsWith("ascend-ui/app"))
    ),
  ];

  const dbState = db[branch] ?? initializeBuildState(commands);

  if (arraysEqual(dbState.plan, commands) && !executeFullPlan) {
    const ans = await askQuestion(
      styles.info("Restart from last checkpoint? (yes/no) ")
    );
    if (ans === "yes") {
      console.log(styles.success("Starting from checkpoint"));
      commands = mergeCommands(dbState);
    }
  } else if (executeFullPlan && arraysEqual(dbState.plan, commands)) {
    console.log(styles.info("--full flag detected, executing complete plan"));
    // Reset all commands to pending for full execution
    commands.forEach((cmd) => {
      dbState.stepDetails[cmd] = "pending";
    });
  }

  let isShuttingDown = false;
  process.on("SIGINT", async () => {
    if (isShuttingDown) {
      process.exit(1);
    }
    console.log(styles.warning("\nGracefully shutting down..."));
    isShuttingDown = true;
    await writeFile(dbFile, JSON.stringify(db, null, 2));
    process.exit(0);
  });

  console.log(styles.header("\n📦 Build Plan"));
  console.log(styles.info("Branch:"), styles.branch(branch));
  console.log(styles.info("\nCommands:"));
  commands.forEach((cmd, i) => {
    console.log(
      `  ${styles.highlight((i + 1).toString().padStart(2))}. ${styles.command(
        cmd
      )}`
    );
  });

  for (const command of commands) {
    console.log(styles.header("\n▶ Executing:"), styles.command(command), "\n");
    try {
      const success = await executeCommand(command);
      dbState.stepDetails[command] = success ? "success" : "failed";
      if (!success) {
        console.log(styles.error(`\n✖ Command failed: ${command}\n`));
        break;
      }
      console.log(styles.success(`\n✓ Command succeeded: ${command}\n`));
    } catch (error) {
      console.error(styles.error("Error executing command:"), error);
      dbState.stepDetails[command] = "failed";
      break;
    }
  }

  await writeFile(
    dbFile,
    JSON.stringify(
      {
        ...db,
        [branch]: dbState,
      } satisfies DatabaseSchema,
      null,
      2
    )
  );
};

main();