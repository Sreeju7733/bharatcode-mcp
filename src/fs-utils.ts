import fs from "node:fs";

export const fsOps = {
  renameSync: (oldPath: string, newPath: string) => fs.renameSync(oldPath, newPath),
  copyFileSync: (src: string, dest: string) => fs.copyFileSync(src, dest),
  unlinkSync: (path: string) => fs.unlinkSync(path),
  existsSync: (path: string) => fs.existsSync(path),
  readFileSync: (path: string, encoding: any): string => fs.readFileSync(path, encoding).toString(),
};
