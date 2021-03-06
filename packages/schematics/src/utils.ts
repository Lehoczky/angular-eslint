/**
 * Some utils taken from various parts of Nx:
 * https://github.com/nrwl/nx
 *
 * Thanks, Nrwl folks!
 */
import { join, normalize, Path } from '@angular-devkit/core';
import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import stripJsonComments from 'strip-json-comments';

/**
 * This method is specifically for reading JSON files in a Tree
 * @param host The host tree
 * @param path The path to the JSON file
 * @returns The JSON data in the file.
 */
export function readJsonInTree<T = any>(host: Tree, path: string): T {
  if (!host.exists(path)) {
    throw new Error(`Cannot find ${path}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const contents = stripJsonComments(host.read(path)!.toString('utf-8'));
  try {
    return JSON.parse(contents);
  } catch (e) {
    throw new Error(`Cannot parse ${path}: ${e.message}`);
  }
}

/**
 * This method is specifically for updating JSON in a Tree
 * @param path Path of JSON file in the Tree
 * @param callback Manipulation of the JSON data
 * @returns A rule which updates a JSON file file in a Tree
 */
export function updateJsonInTree<T = any, O = T>(
  path: string,
  callback: (json: T, context: SchematicContext) => O,
): Rule {
  return (host: Tree, context: SchematicContext): Tree => {
    if (!host.exists(path)) {
      host.create(path, serializeJson(callback({} as T, context)));
      return host;
    }
    host.overwrite(
      path,
      serializeJson(callback(readJsonInTree(host, path), context)),
    );
    return host;
  };
}

function getWorkspacePath(host: Tree) {
  const possibleFiles = ['/workspace.json', '/angular.json', '/.angular.json'];
  return possibleFiles.filter((path) => host.exists(path))[0];
}

export function getProjectConfig(host: Tree, name: string): any {
  const workspaceJson = readJsonInTree(host, getWorkspacePath(host));
  const projectConfig = workspaceJson.projects[name];
  if (!projectConfig) {
    throw new Error(`Cannot find project '${name}'`);
  } else {
    return projectConfig;
  }
}

export function offsetFromRoot(fullPathToSourceDir: string): string {
  const parts = normalize(fullPathToSourceDir).split('/');
  let offset = '';
  for (let i = 0; i < parts.length; ++i) {
    offset += '../';
  }
  return offset;
}

function serializeJson(json: any): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function updateWorkspaceInTree<T = any, O = T>(
  callback: (json: T, context: SchematicContext, host: Tree) => O,
): Rule {
  return (host: Tree, context: SchematicContext): Tree => {
    const path = getWorkspacePath(host);
    host.overwrite(
      path,
      serializeJson(callback(readJsonInTree(host, path), context, host)),
    );
    return host;
  };
}

export function addESLintTargetToProject(
  projectName: string,
  targetName: 'eslint' | 'lint',
): Rule {
  return updateWorkspaceInTree((workspaceJson) => {
    const existingProjectConfig = workspaceJson.projects[projectName];

    let lintFilePatternsRoot = '';

    // Default Angular CLI project at the root of the workspace
    if (existingProjectConfig.root === '') {
      lintFilePatternsRoot = 'src';
    } else {
      lintFilePatternsRoot = existingProjectConfig.root;
    }

    const eslintTargetConfig = {
      builder: '@angular-eslint/builder:lint',
      options: {
        lintFilePatterns: [
          `${lintFilePatternsRoot}/**/*.ts`,
          `${lintFilePatternsRoot}/**/*.html`,
        ],
      },
    };

    existingProjectConfig.architect[targetName] = eslintTargetConfig;

    return workspaceJson;
  });
}

function allFilesInDirInHost(
  host: Tree,
  path: Path,
  options: {
    recursive: boolean;
  } = { recursive: true },
): Path[] {
  const dir = host.getDir(path);
  const res: Path[] = [];
  dir.subfiles.forEach((p) => {
    res.push(join(path, p));
  });

  if (!options.recursive) {
    return res;
  }

  dir.subdirs.forEach((p) => {
    res.push(...allFilesInDirInHost(host, join(path, p)));
  });
  return res;
}

export function getAllSourceFilesForProject(
  host: Tree,
  projectName: string,
): Path[] {
  const workspaceJson = readJsonInTree(host, 'angular.json');
  const existingProjectConfig = workspaceJson.projects[projectName];

  let pathRoot = '';

  // Default Angular CLI project at the root of the workspace
  if (existingProjectConfig.root === '') {
    pathRoot = 'src';
  } else {
    pathRoot = existingProjectConfig.root;
  }

  return allFilesInDirInHost(host, normalize(pathRoot));
}

type ProjectType = 'application' | 'library';

export function setESLintProjectBasedOnProjectType(
  projectRoot: string,
  projectType: ProjectType,
) {
  let project;
  if (projectType === 'application') {
    project = [
      `${projectRoot}/tsconfig.app.json`,
      `${projectRoot}/tsconfig.spec.json`,
      `${projectRoot}/e2e/tsconfig.json`,
    ];
  }
  // Libraries don't have an e2e directory
  if (projectType === 'library') {
    project = [
      `${projectRoot}/tsconfig.lib.json`,
      `${projectRoot}/tsconfig.spec.json`,
    ];
  }
  return project;
}

export function createRootESLintConfig(prefix: string | null) {
  let codeRules;
  if (prefix) {
    codeRules = {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix, style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix, style: 'kebab-case' },
      ],
    };
  } else {
    codeRules = {};
  }

  return {
    root: true,
    ignorePatterns: ['projects/**/*'],
    overrides: [
      {
        files: ['*.ts'],
        parserOptions: {
          project: ['tsconfig.json', 'e2e/tsconfig.json'],
          createDefaultProgram: true,
        },
        extends: [
          'plugin:@angular-eslint/recommended',
          'plugin:@angular-eslint/template/process-inline-templates',
        ],
        rules: codeRules,
      },

      {
        files: ['*.html'],
        extends: ['plugin:@angular-eslint/template/recommended'],
        rules: {},
      },
    ],
  };
}

function createProjectESLintConfig(
  rootPath: string,
  projectRoot: string,
  projectType: ProjectType,
  prefix: string,
) {
  return {
    extends: `${offsetFromRoot(rootPath)}.eslintrc.json`,
    ignorePatterns: ['!**/*'],
    overrides: [
      {
        files: ['*.ts'],
        parserOptions: {
          project: setESLintProjectBasedOnProjectType(projectRoot, projectType),
          createDefaultProgram: true,
        },
        rules: {
          '@angular-eslint/directive-selector': [
            'error',
            { type: 'attribute', prefix, style: 'camelCase' },
          ],
          '@angular-eslint/component-selector': [
            'error',
            { type: 'element', prefix, style: 'kebab-case' },
          ],
        },
      },

      {
        files: ['*.html'],
        rules: {},
      },
    ],
  };
}

export function createESLintConfigForProject(projectName: string): Rule {
  return (tree: Tree) => {
    const angularJSON = readJsonInTree(tree, 'angular.json');
    const { root: projectRoot, projectType, prefix } = angularJSON.projects[
      projectName
    ];
    /**
     * If the root is an empty string it must be the initial project created at the
     * root by the Angular CLI's workspace schematic. We handle creating the root level
     * config in our own workspace schematic.
     */
    if (projectRoot === '') {
      return;
    }
    return updateJsonInTree(
      join(normalize(projectRoot), '.eslintrc.json'),
      () =>
        createProjectESLintConfig(
          tree.root.path,
          projectRoot,
          projectType,
          prefix,
        ),
    );
  };
}

export function removeTSLintJSONForProject(projectName: string): Rule {
  return (tree: Tree) => {
    const angularJSON = readJsonInTree(tree, 'angular.json');
    const { root: projectRoot } = angularJSON.projects[projectName];
    tree.delete(join(normalize(projectRoot || '/'), 'tslint.json'));
  };
}

export function createRootESLintConfigFile(workspaceName: string): Rule {
  return (tree) => {
    const angularJSON = readJsonInTree(
      tree,
      join(normalize(workspaceName), 'angular.json'),
    );
    let lintPrefix: string | null = null;
    if (angularJSON.projects?.[workspaceName]) {
      const { prefix } = angularJSON.projects[workspaceName];
      lintPrefix = prefix;
    }
    return updateJsonInTree(
      join(normalize(workspaceName), '.eslintrc.json'),
      () => createRootESLintConfig(lintPrefix),
    );
  };
}

export function sortObjectByKeys(obj: Record<string, unknown>) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      return {
        ...result,
        [key]: obj[key],
      };
    }, {});
}
