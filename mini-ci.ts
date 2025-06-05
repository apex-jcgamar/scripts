import simpleGit from 'simple-git';
import readline from 'readline';
import { execSync } from 'child_process'
import { writeFile, readFile } from 'fs/promises'

type StepStatus = 'success' | 'failed' | 'pending';

interface BuildState {
    plan: string[];
    stepDetails: Record<string, StepStatus>;
}

type DatabaseSchema = Record<string, BuildState | undefined>

const dbFile = '/home/jgama/workspace/scripts/mini-ci-db.json'
const baseDir = '/home/jgama/workspace/source'
const git = simpleGit({ baseDir });

function arraysEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((val, index) => val === arr2[index]);
}

const askQuestion = (question: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
}

const generateBffCommands = (files: string[]) => {
    const commands: string[] = []

    if(!files?.length) return commands
    if(files.some((f) => /\w+\.graphql/.test(f))) {
        commands.push("bazel build //apex-online:all_gql_types")
        commands.push("bazel run //apex-online:update_gql_types")
    }
    
    commands.push("bazel run //apex-online/apex-grql:lint_typescript")
    commands.push("bazel build //apex-online/apex-grql:compile_ts")

    return commands
}

const generateAscendUiCommands = (files: string[]) => {
    const commands: string[] = []

    if(!files?.length) return commands
    if(files.some((f) => /\w+\.graphql/.test(f))) {
        commands.push("bazel build //apex-online:all_gql_types")
        commands.push("bazel run //apex-online:update_gql_types")
        commands.push("bazel build //apex-online/apex-grql:operation_rpc_mapping")
        commands.push("bazel run //apex-online/apex-grql:update_operation_rpc_mapping")
    }

    commands.push("bazel run //ascend-ui/app:ts_lint_test")
    commands.push("bazel run //ascend-ui/app:ts_types_test")
    
    return commands;
}

const mergeCommands = (dbState: NonNullable<DatabaseSchema[string]>) => {
    const commands = Object.entries(dbState.stepDetails)
        .filter(([, status]) => status !== 'success')
        .map(([command]) => command)
    return commands;

}

const validateFiles = async (files: string[]): Promise<boolean> => {
    if (files.length > 30) {
        const ans = await askQuestion(`${files.length} files. continue? (yes/no) `);
        return ans === 'yes';
    }
    return true;
}

const initializeBuildState = (commands: string[]): BuildState => ({
    plan: commands,
    stepDetails: commands.reduce((acc, curr) => {
        acc[curr] = 'pending';
        return acc;
    }, {} as Record<string, StepStatus>)
})

const loadDatabase = async (): Promise<DatabaseSchema> => {
    try {
        const dbText = await readFile(dbFile, 'utf-8');
        return JSON.parse(dbText) as DatabaseSchema;
    } catch (error) {
        console.warn('Could not load database, starting fresh');
        return {};
    }
}

const main = async () => {
    const db = await loadDatabase();
    
    const { current: branch } = await git.status();
    if (!branch) throw new Error("No branch!");

    const diffBlock = await git.diff(['main', '--name-only']);
    const files = diffBlock.split("\n");

    if (!(await validateFiles(files))) {
        process.exit(0);
    }

    let commands = [
        ...generateBffCommands(files.filter((f) => f.startsWith("apex-online/apex-grql"))),
        ...generateAscendUiCommands(files.filter((f) => f.startsWith('ascend-ui/app'))),
    ];

    const dbState = db[branch] ?? initializeBuildState(commands);

    if (arraysEqual(dbState.plan, commands)) {
        const ans = await askQuestion("Restart from last checkpoint? (yes/no) ");
        if (ans === "yes") {
            console.log("Starting from checkpoint");
            commands = mergeCommands(dbState);
        }
    }

    let isShuttingDown = false;
    process.on('SIGINT', async () => {
        if (isShuttingDown) {
            process.exit(1);
        }
        console.log('\nGracefully shutting down...');
        isShuttingDown = true;
        await writeFile(dbFile, JSON.stringify(db, null, 2));
        process.exit(0);
    });

    console.log({ branch, plan: commands })

    for(const command of commands) {
        console.log(command);
        try {
            const output = execSync(command, { encoding: 'utf-8', cwd: baseDir });
            console.log(output);
            dbState.stepDetails[command] = 'success';
        } catch(error) {
            console.error(error)
            dbState.stepDetails[command] = 'failed';
            break;
        }   
    }

    await writeFile(dbFile, JSON.stringify({
        ...db,
        [branch]: dbState
    } satisfies DatabaseSchema, null, 2))

}

main();