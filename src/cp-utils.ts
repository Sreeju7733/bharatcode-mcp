import child_process from "node:child_process";

export const cpOps = {
  execSync: (cmd: string, opts?: any) => child_process.execSync(cmd, opts),
  exec: (cmd: string, opts: any, callback: any) => child_process.exec(cmd, opts, callback),
  spawn: (cmd: string, args: string[], opts?: any) => child_process.spawn(cmd, args, opts),
};
