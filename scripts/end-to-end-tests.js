const childProcess = require('child_process')
const { buildBinary, dirname, removeRecursiveSync, writeFileAtomic } = require('./esbuild.js')
const assert = require('assert')
const path = require('path')
const util = require('util')
const url = require('url')
const fs = require('fs').promises

const execFileAsync = util.promisify(childProcess.execFile)
const execAsync = util.promisify(childProcess.exec)

const nodeMajorVersion = +process.versions.node.split('.')[0]
const testDir = path.join(dirname, '.end-to-end-tests')
const errorIcon = process.platform !== 'win32' ? '✘' : 'X'
const esbuildPath = buildBinary()
const tests = []
let testCount = 0

// Tests for "--define"
tests.push(
  test(['--define:foo=null', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== null) throw 'fail'` }),
  test(['--define:foo=true', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== true) throw 'fail'` }),
  test(['--define:foo=false', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== false) throw 'fail'` }),
  test(['--define:foo="abc"', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== "abc") throw 'fail'` }),
  test(['--define:foo=123.456', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== 123.456) throw 'fail'` }),
  test(['--define:foo=-123.456', 'in.js', '--outfile=node.js'], { 'in.js': `if (foo !== -123.456) throw 'fail'` }),
  test(['--define:foo=global', 'in.js', '--outfile=node.js'], { 'in.js': `foo.bar = 123; if (bar !== 123) throw 'fail'` }),
  test(['--define:foo=bar', 'in.js', '--outfile=node.js'], { 'in.js': `let bar = {x: 123}; if (foo.x !== 123) throw 'fail'` }),
  test(['--define:a.x=1', 'in.js', '--outfile=node.js'], { 'in.js': `if (a.x !== 1) throw 'fail'` }),
  test(['--define:a.x=1', '--define:a.y=2', 'in.js', '--outfile=node.js'], { 'in.js': `if (a.x + a.y !== 3) throw 'fail'` }),
  test(['--define:a.x=1', '--define:b.y=2', 'in.js', '--outfile=node.js'], { 'in.js': `if (a.x + b.y !== 3) throw 'fail'` }),
  test(['--define:a.x=1', '--define:b.x=2', 'in.js', '--outfile=node.js'], { 'in.js': `if (a.x + b.x !== 3) throw 'fail'` }),
  test(['--define:x=y', '--define:y=x', 'in.js', '--outfile=node.js'], {
    'in.js': `eval('var x="x",y="y"'); if (x + y !== 'yx') throw 'fail'`,
  }),
)

// Test recursive directory creation
tests.push(
  test(['entry.js', '--outfile=a/b/c/d/index.js'], {
    'entry.js': `exports.foo = 123`,
    'node.js': `const ns = require('./a/b/c/d'); if (ns.foo !== 123) throw 'fail'`,
  }),
)

// Test bogus paths with a file as a parent directory (this happens when you use "pnpx esbuild")
tests.push(
  test(['entry.js', '--bundle'], {
    'entry.js': `import "./file.js/what/is/this"`,
    'file.js': `some file`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Could not resolve "./file.js/what/is/this"

    entry.js:1:7:
      1 │ import "./file.js/what/is/this"
        ╵        ~~~~~~~~~~~~~~~~~~~~~~~~

`,
  }),
)

// Test absolute paths in log messages
tests.push(
  test(['entry.js', '--bundle', '--abs-paths=log'], {
    'entry.js': `import "./foo"`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Could not resolve "./foo"

    $ABS_PATH_PREFIX$entry.js:1:7:
      1 │ import "./foo"
        ╵        ~~~~~~~

`,
  }),
)

// Test resolving paths with a question mark (an invalid path on Windows)
tests.push(
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `
      import x from "./file.js?ignore-me"
      if (x !== 123) throw 'fail'
    `,
    'file.js': `export default 123`,
  }),
)

// Test TypeScript enum stuff
tests.push(
  // Scope merging
  test(['entry.ts', '--bundle', '--minify', '--outfile=node.js'], {
    'entry.ts': `
      const id = x => x
      enum a { b = 1 }
      enum a { c = 2 }
      if (id(a).c !== 2 || id(a)[2] !== 'c' || id(a).b !== 1 || id(a)[1] !== 'b') throw 'fail'
    `,
  }),
  test(['entry.ts', '--bundle', '--minify', '--outfile=node.js'], {
    'entry.ts': `
      const id = x => x
      {
        enum a { b = 1 }
      }
      {
        enum a { c = 2 }
        if (id(a).c !== 2 || id(a)[2] !== 'c' || id(a).b !== void 0 || id(a)[1] !== void 0) throw 'fail'
      }
    `,
  }),
  test(['entry.ts', '--bundle', '--minify', '--outfile=node.js'], {
    'entry.ts': `
      const id = x => x
      enum a { b = 1 }
      namespace a {
        if (id(a).b !== 1 || id(a)[1] !== 'b') throw 'fail'
      }
    `,
  }),
  test(['entry.ts', '--bundle', '--minify', '--outfile=node.js'], {
    'entry.ts': `
      const id = x => x
      namespace a {
        export function foo() {
          if (id(a).b !== 1 || id(a)[1] !== 'b') throw 'fail'
        }
      }
      enum a { b = 1 }
      a.foo()
    `,
  }),
  test(['entry.ts', '--bundle', '--minify', '--outfile=node.js'], {
    'entry.ts': `
      import './enum-to-namespace'
      import './namespace-to-enum'
      import './namespace-to-namespace'
    `,
    'enum-to-namespace.ts': `
      let foo, bar, y = 2, z = 4
      enum x { y = 1 }
      namespace x { foo = y }
      enum x { z = y * 3 }
      namespace x { bar = z }
      if (foo !== 2 || bar !== 4) throw 'fail'
    `,
    'namespace-to-enum.ts': `
      let y = 2, z = 4
      namespace x { export let y = 1 }
      enum x { foo = y }
      namespace x { export let z = y * 3 }
      enum x { bar = z }
      if (x.foo !== 2 || x.bar !== 4) throw 'fail'
    `,
    'namespace-to-namespace.ts': `
      let foo, bar, y = 2, z = 4
      namespace x { export const y = 1 }
      namespace x { foo = y }
      namespace x { export const z = y * 3 }
      namespace x { bar = z }
      if (foo !== 1 || bar !== 3) throw 'fail'
    `,
  }),

  // https://github.com/evanw/esbuild/issues/3205
  test(['entry.ts', '--outfile=node.js'], {
    'entry.ts': `
      // Note: The parentheses are important here
      let x = (() => {
        const enum E { a = 123 }
        return () => E.a
      })
      if (x()() !== 123) throw 'fail'
    `,
  }),

  // https://github.com/evanw/esbuild/issues/3210
  test(['entry.ts', '--bundle', '--outfile=node.js'], {
    'entry.ts': `
      import { MyEnum } from './enums';
      enum MyEnum2 {
        'A.A' = 'a',
        'aa' = 'aa',
      }
      if (
        MyEnum['A.A'] !== 'a' || MyEnum2['A.A'] !== 'a' ||
        MyEnum.aa !== 'aa' || MyEnum2['aa'] !== 'aa' ||
        MyEnum['aa'] !== 'aa' || MyEnum2.aa !== 'aa'
      ) throw 'fail'
    `,
    'enums.ts': `
      export enum MyEnum {
        'A.A' = 'a',
        'aa' = 'aa',
      }
    `,
  }),
)

// Check "tsconfig.json" behavior
tests.push(
  // See: https://github.com/evanw/esbuild/issues/2481
  test(['main.ts', '--bundle', '--outfile=node.js'], {
    'main.ts': `
      import { foo } from 'js-pkg'
      import { bar } from 'ts-pkg'
      import { foo as shimFoo, bar as shimBar } from 'pkg'
      if (foo !== 'foo') throw 'fail: foo'
      if (bar !== 'bar') throw 'fail: bar'
      if (shimFoo !== 'shimFoo') throw 'fail: shimFoo'
      if (shimBar !== 'shimBar') throw 'fail: shimBar'
    `,
    'shim.ts': `
      export let foo = 'shimFoo'
      export let bar = 'shimBar'
    `,
    'tsconfig.json': `{
      "compilerOptions": {
        "paths": {
          "pkg": ["./shim"],
        },
      },
    }`,
    'node_modules/js-pkg/index.js': `
      import { foo as pkgFoo } from 'pkg'
      export let foo = pkgFoo
    `,
    'node_modules/ts-pkg/index.ts': `
      import { bar as pkgBar } from 'pkg'
      export let bar = pkgBar
    `,
    'node_modules/pkg/index.js': `
      export let foo = 'foo'
      export let bar = 'bar'
    `,
  }),

  // See: https://github.com/evanw/esbuild/issues/3767
  test(['apps/client/src/index.ts', '--bundle', '--outfile=node.js'], {
    'apps/client/src/index.ts': `
      import { foo } from '~/foo'
      if (foo !== 'foo') throw 'fail'
    `,
    'apps/client/src/foo.ts': `
      export const foo = 'foo'
    `,
    'apps/client/tsconfig.json': `{
      "extends": "@repo/tsconfig/base"
    }`,
    'apps/client/node_modules/@repo/tsconfig': {
      symlink: `../../../../tooling/typescript`,
    },
    'tooling/typescript/base.json': `{
      "compilerOptions": {
        "paths": {
          "~/*": ["../../apps/client/src/*"]
        }
      }
    }`,
  }),
)

// Test coverage for a special JSX error message
tests.push(
  test(['example.jsx', '--outfile=node.js'], {
    'example.jsx': `let button = <Button content="some so-called \\"button text\\"" />`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Unexpected backslash in JSX element

    example.jsx:1:58:
      1 │ let button = <Button content="some so-called \\"button text\\"" />
        ╵                                                           ^

  Quoted JSX attributes use XML-style escapes instead of JavaScript-style escapes:

    example.jsx:1:45:
      1 │ let button = <Button content="some so-called \\"button text\\"" />
        │                                              ~~
        ╵                                              &quot;

  Consider using a JavaScript string inside {...} instead of a quoted JSX attribute:

    example.jsx:1:29:
      1 │ let button = <Button content="some so-called \\"button text\\"" />
        │                              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        ╵                              {"some so-called \\"button text\\""}

`,
  }),
  test(['example.jsx', '--outfile=node.js'], {
    'example.jsx': `let button = <Button content='some so-called \\'button text\\'' />`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Unexpected backslash in JSX element

    example.jsx:1:58:
      1 │ let button = <Button content='some so-called \\'button text\\'' />
        ╵                                                           ^

  Quoted JSX attributes use XML-style escapes instead of JavaScript-style escapes:

    example.jsx:1:45:
      1 │ let button = <Button content='some so-called \\'button text\\'' />
        │                                              ~~
        ╵                                              &apos;

  Consider using a JavaScript string inside {...} instead of a quoted JSX attribute:

    example.jsx:1:29:
      1 │ let button = <Button content='some so-called \\'button text\\'' />
        │                              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        ╵                              {'some so-called \\'button text\\''}

`,
  }),
)

// Test the "browser" field in "package.json"
tests.push(
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('foo')`,
    'package.json': `{ "browser": { "./foo": "./file" } }`,
    'file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('foo')`,
    'package.json': `{ "browser": { "foo": "./file" } }`,
    'file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('./foo')`,
    'package.json': `{ "browser": { "./foo": "./file" } }`,
    'file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('./foo')`,
    'package.json': `{ "browser": { "foo": "./file" } }`,
    'file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg/foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "./foo/bar": "./file" } }`,
    'node_modules/pkg/foo/bar.js': `invalid syntax`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg/foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "foo/bar": "./file" } }`,
    'node_modules/pkg/foo/bar.js': `invalid syntax`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg/foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "./foo/bar": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg/foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "foo/bar": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/index.js': `require('foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "./foo/bar": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/index.js': `require('foo/bar')`,
    'node_modules/pkg/package.json': `{ "browser": { "foo/bar": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/index.js': `throw 'fail'`,
    'node_modules/pkg/package.json': `{ "browser": { "./index.js": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/package.json': `{ "browser": { "./index.js": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/index.js': `throw 'fail'`,
    'node_modules/pkg/package.json': `{ "browser": { "./index": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/package.json': `{ "browser": { "./index": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/main.js': `throw 'fail'`,
    'node_modules/pkg/package.json': `{ "main": "./main",\n  "browser": { "./main.js": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'node_modules/pkg/package.json': `{ "main": "./main",\n  "browser": { "./main.js": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'package.json': `{ "browser": { "pkg2": "pkg3" } }`,
    'node_modules/pkg/index.js': `require('pkg2')`,
    'node_modules/pkg/package.json': `{ "browser": { "pkg2": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'package.json': `{ "browser": { "pkg2": "pkg3" } }`,
    'node_modules/pkg/index.js': `require('pkg2')`,
    'node_modules/pkg2/index.js': `throw 'fail'`,
    'node_modules/pkg3/index.js': `var works = true`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `require('pkg')`,
    'package.json': `{ "browser": { "pkg2": "pkg3" } }`,
    'node_modules/pkg/index.js': `require('pkg2')`,
    'node_modules/pkg/package.json': `{ "browser": { "./pkg2": "./file" } }`,
    'node_modules/pkg/file.js': `var works = true`,
  }),
)

// Test arbitrary module namespace identifier names
// See https://github.com/tc39/ecma262/pull/2154
tests.push(
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {'*' as star} from './export.js'; if (star !== 123) throw 'fail'`,
    'export.js': `let foo = 123; export {foo as '*'}`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {'\\0' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
    'export.js': `let foo = 123; export {foo as '\\0'}`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {'\\uD800\\uDC00' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
    'export.js': `let foo = 123; export {foo as '\\uD800\\uDC00'}`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {'🍕' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
    'export.js': `let foo = 123; export {foo as '🍕'}`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {' ' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
    'export.js': `export let foo = 123; export {foo as ' '} from './export.js'`,
  }),
  test(['entry.js', '--bundle', '--outfile=node.js'], {
    'entry.js': `import {'' as ab} from './export.js'; if (ab.foo !== 123 || ab.bar !== 234) throw 'fail'`,
    'export.js': `export let foo = 123, bar = 234; export * as '' from './export.js'`,
  }),
)

// Tests for symlinks
//
// Note: These are disabled on Windows because they fail when run with GitHub
// Actions. I'm not sure what the issue is because they pass for me when run in
// my Windows VM (Windows 10 in VirtualBox on macOS).
if (process.platform !== 'win32') {
  tests.push(
    // Without preserve symlinks
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'registry/node_modules/bar/index.js': `export const bar = 123`,
      'node_modules/foo': { symlink: `../registry/node_modules/foo` },
    }),
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'registry/node_modules/bar/index.js': `export const bar = 123`,
      'node_modules/foo/index.js': { symlink: `../../registry/node_modules/foo/index.js` },
    }),
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'registry/node_modules/bar/index.js': `export const bar = 123`,
      'node_modules/foo': { symlink: `TEST_DIR_ABS_PATH/registry/node_modules/foo` },
    }),
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'registry/node_modules/bar/index.js': `export const bar = 123`,
      'node_modules/foo/index.js': { symlink: `TEST_DIR_ABS_PATH/registry/node_modules/foo/index.js` },
    }),

    // With preserve symlinks
    test(['--bundle', 'src/in.js', '--outfile=node.js', '--preserve-symlinks'], {
      'src/in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'src/node_modules/bar/index.js': `export const bar = 123`,
      'src/node_modules/foo': { symlink: `../../registry/node_modules/foo` },
    }),
    test(['--bundle', 'src/in.js', '--outfile=node.js', '--preserve-symlinks'], {
      'src/in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'src/node_modules/bar/index.js': `export const bar = 123`,
      'src/node_modules/foo/index.js': { symlink: `../../../registry/node_modules/foo/index.js` },
    }),
    test(['--bundle', 'src/in.js', '--outfile=node.js', '--preserve-symlinks'], {
      'src/in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'src/node_modules/bar/index.js': `export const bar = 123`,
      'src/node_modules/foo': { symlink: `TEST_DIR_ABS_PATH/registry/node_modules/foo` },
    }),
    test(['--bundle', 'src/in.js', '--outfile=node.js', '--preserve-symlinks'], {
      'src/in.js': `import {foo} from 'foo'; if (foo !== 123) throw 'fail'`,
      'registry/node_modules/foo/index.js': `export {bar as foo} from 'bar'`,
      'src/node_modules/bar/index.js': `export const bar = 123`,
      'src/node_modules/foo/index.js': { symlink: `TEST_DIR_ABS_PATH/registry/node_modules/foo/index.js` },
    }),

    // This is a test for https://github.com/evanw/esbuild/issues/222
    test(['--bundle', 'src/in.js', '--outfile=out/node.js', '--metafile=out/meta.json', '--platform=node', '--format=cjs'], {
      'a/b/src/in.js': `
        import {metafile} from './load'
        const assert = require('assert')
        assert.deepStrictEqual(Object.keys(metafile.inputs), ['src/load.js', 'src/in.js'])
        assert.strictEqual(metafile.inputs['src/in.js'].imports[0].path, 'src/load.js')
      `,
      'a/b/src/load.js': `
        export var metafile
        // Hide the import path from the bundler
        try {
          let path = './meta.json'
          metafile = require(path)
        } catch (e) {
        }
      `,
      'node.js': `
        require('./a/b/out/node')
      `,
      'c': { symlink: `a/b` },
    }, { cwd: 'c' }),

    // This is a test for https://github.com/evanw/esbuild/issues/766
    test(['--bundle', 'impl/index.mjs', '--outfile=node.js', '--format=cjs', '--resolve-extensions=.mjs'], {
      'config/yarn/link/@monorepo-source/a': { symlink: `../../../../monorepo-source/packages/a` },
      'config/yarn/link/@monorepo-source/b': { symlink: `../../../../monorepo-source/packages/b` },
      'impl/node_modules/@monorepo-source/b': { symlink: `../../../config/yarn/link/@monorepo-source/b` },
      'impl/index.mjs': `
        import { fn } from '@monorepo-source/b';
        if (fn() !== 123) throw 'fail';
      `,
      'monorepo-source/packages/a/index.mjs': `
        export function foo() { return 123; }
      `,
      'monorepo-source/packages/b/node_modules/@monorepo-source/a': { symlink: `../../../../../config/yarn/link/@monorepo-source/a` },
      'monorepo-source/packages/b/index.mjs': `
        import { foo } from '@monorepo-source/a';
        export function fn() { return foo(); }
      `,
    }),

    // These tests are for https://github.com/evanw/esbuild/issues/2773
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from './baz/bar/foo'; if (foo !== 444) throw 'fail'`,
      'foo/index.js': `import {qux} from '../qux'; export const foo = 123 + qux`,
      'qux/index.js': `export const qux = 321`,
      'bar/foo': { symlink: `../foo` },
      'baz/bar': { symlink: `../bar` },
    }),
    test(['--bundle', 'in.js', '--outfile=node.js'], {
      'in.js': `import {foo} from './baz/bar/foo'; if (foo !== 444) throw 'fail'`,
      'foo/index.js': `import {qux} from '../qux'; export const foo = 123 + qux`,
      'qux/index.js': `export const qux = 321`,
      'bar/foo': { symlink: `TEST_DIR_ABS_PATH/foo` },
      'baz/bar': { symlink: `TEST_DIR_ABS_PATH/bar` },
    }),
  )
}

// Test custom output paths
tests.push(
  test(['node=entry.js', '--outdir=.'], {
    'entry.js': ``,
  }),
)

// Make sure that the "asm.js" directive is removed
tests.push(
  test(['in.js', '--outfile=node.js'], {
    'in.js': `
      function foo() { 'use asm'; eval("/* not asm.js */") }
      let emitWarning = process.emitWarning
      let failed = false
      try {
        process.emitWarning = () => failed = true
        foo()
      } finally {
        process.emitWarning = emitWarning
      }
      if (failed) throw 'fail'
    `,
  }),
)

// Check async generator lowering
for (const flags of [[], ['--target=es6', '--target=es2017', '--supported:async-generator=false', '--supported:async-await=false']]) {
  tests.push(
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        function* x() {
          yield 1
          yield 2
          return 3
        }
        async function y(arg) {
          return -(await Promise.resolve(arg))
        }
        async function* z(arg) {
          yield 1
          yield Promise.resolve(2)
          yield* [3, Promise.resolve(4)]
          yield* {
            [Symbol.iterator]() {
              var value = 5
              return { next: () => ({ value, done: value++ > 6 }) }
            }
          }
          yield* {
            [Symbol.asyncIterator]() {
              var value = 7
              return { next: async () => ({ value, done: value++ > 8 }) }
            }
          }
          return -(await Promise.resolve(arg))
        }
        export let async = async () => {
          let state

          const X = x()
          if (X[Symbol.iterator]() !== X) throw 'fail: x Symbol.iterator'
          if (Symbol.asyncIterator in X) throw 'fail: x Symbol.asyncIterator'
          state = X.next(); if (state.done !== false || state.value !== 1) throw 'fail: x 1: ' + JSON.stringify(state)
          state = X.next(); if (state.done !== false || state.value !== 2) throw 'fail: x 2: ' + JSON.stringify(state)
          state = X.next(); if (state.done !== true || state.value !== 3) throw 'fail: x 3: ' + JSON.stringify(state)

          const Y = y(123)
          if (Symbol.iterator in Y) throw 'fail: y Symbol.iterator'
          if (Symbol.asyncIterator in Y) throw 'fail: y Symbol.asyncIterator'
          if (await Y !== -123) throw 'fail: y'

          const Z = z(123)
          if (Symbol.iterator in Z) throw 'fail: z Symbol.iterator'
          if (Z[Symbol.asyncIterator]() !== Z) throw 'fail: z Symbol.asyncIterator'
          state = await Z.next(); if (state.done !== false || state.value !== 1) throw 'fail: z 1: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 2) throw 'fail: z 2: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 3) throw 'fail: z 3: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 4) throw 'fail: z 4: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 5) throw 'fail: z 5: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 6) throw 'fail: z 6: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 7) throw 'fail: z 7: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== false || state.value !== 8) throw 'fail: z 8: ' + JSON.stringify(state)
          state = await Z.next(); if (state.done !== true || state.value !== -123) throw 'fail: z 123: ' + JSON.stringify(state)
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({ next() { throw 'f' } })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (err !== 'f') throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({ get next() { throw 'f' } })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (err !== 'f') throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({ async next() { throw 'f' } })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (err !== 'f') throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          try {
            yield* {
              [Symbol.asyncIterator]: () => ({
                next: () => ({
                  done: false,
                  get value() { throw 'f' }
                })
              }),
            }
          } catch (e) {
            return e
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next()
          if (state.done !== true || state.value !== 'f') throw 'fail: f: next'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* [
            Promise.reject('f.x'),
            'f.y',
          ]
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (err !== 'f.x') throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.iterator]: () => ({ next: () => 123 }),
          }
          return 'f'
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (!(err instanceof TypeError)) throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({ next: () => 123 }),
          }
          return 'f'
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next(); throw 'fail: f: next' } catch (err) { if (!(err instanceof TypeError)) throw err }
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* [
            'f.x',
            'f.y',
          ]
          return 'f'
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next()
          if (state.done !== false || state.value !== 'f.x') throw 'fail: f: next'
          try { await it.throw('f: throw') } catch (err) { var error = err }
          if (error !== 'f: throw') throw 'fail: f: ' + error
          state = await it.next()
          if (state.done !== true || state.value !== void 0) throw 'fail: f: done'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.iterator]: () => ({
              next: a => ({ value: 'f.x.' + a, done: false }),
              return: a => ({ value: 'f.y.' + a, done: true }),
            })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next('A')
          if (state.done !== false || state.value !== 'f.x.undefined') throw 'fail: f: next'
          state = await it.return('B')
          if (state.done !== true || state.value !== 'f.y.B') throw 'fail: f: return'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({
              next: a => Promise.resolve({ value: 'f.x.' + a, done: false }),
              return: a => Promise.resolve({ value: 'f.y.' + a, done: true }),
            })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next('A')
          if (state.done !== false || state.value !== 'f.x.undefined') throw 'fail: f: next'
          state = await it.return('B')
          if (state.done !== true || state.value !== 'f.y.B') throw 'fail: f: return'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.iterator]: () => ({
              next: a => ({ value: 'f.x.' + a, done: false }),
              throw: a => ({ value: 'f.y.' + a, done: true }),
            })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next('A')
          if (state.done !== false || state.value !== 'f.x.undefined') throw 'fail: f: next'
          state = await it.throw('B')
          if (state.done !== true || state.value !== undefined) throw 'fail: f: throw'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          yield* {
            [Symbol.asyncIterator]: () => ({
              next: a => Promise.resolve({ value: 'f.x.' + a, done: false }),
              throw: a => Promise.resolve({ value: 'f.y.' + a, done: true }),
            })
          }
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next('A')
          if (state.done !== false || state.value !== 'f.x.undefined') throw 'fail: f: next'
          state = await it.throw('B')
          if (state.done !== true || state.value !== undefined) throw 'fail: f: throw'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          var value = 0
          yield* {
            [Symbol.iterator]: () => ({ next: () => ({ done: value > 10, value: value += 100 }) }),
            get [Symbol.asyncIterator]() { value += 10; return undefined },
          }
          return value
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next(); if (state.done !== false || state.value !== 110) throw 'fail: f 110: ' + JSON.stringify(state)
          state = await it.next(); if (state.done !== true || state.value !== 210) throw 'fail: f 210: ' + JSON.stringify(state)
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          var value = 0
          yield* {
            [Symbol.iterator]: () => ({ next: () => ({ done: value > 10, value: value += 100 }) }),
            get [Symbol.asyncIterator]() { value += 10; return null },
          }
          return value
        }
        export let async = async () => {
          let it, state
          it = f()
          state = await it.next(); if (state.done !== false || state.value !== 110) throw 'fail: f 110: ' + JSON.stringify(state)
          state = await it.next(); if (state.done !== true || state.value !== 210) throw 'fail: f 210: ' + JSON.stringify(state)
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          var value = 0
          yield* {
            [Symbol.iterator]: () => ({ next: () => ({ done: value > 10, value: value += 100 }) }),
            get [Symbol.asyncIterator]() { value += 10; return false },
          }
          return value
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next() } catch (e) { var error = e }
          if (!(error instanceof TypeError)) throw 'fail: f'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        async function* f() {
          var value = 0
          yield* {
            [Symbol.iterator]: () => ({ next: () => ({ done: value > 10, value: value += 100 }) }),
            get [Symbol.asyncIterator]() { value += 10; return 0 },
          }
          return value
        }
        export let async = async () => {
          let it, state
          it = f()
          try { await it.next() } catch (e) { var error = e }
          if (!(error instanceof TypeError)) throw 'fail: f'
        }
      `,
    }, { async: true }),
  )
}

// Check "for await" lowering
for (const flags of [[], ['--target=es6', '--target=es2017', '--supported:for-await=false']]) {
  tests.push(
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        export let async = async () => {
          const log = []
          const it = {
            [Symbol.iterator]() { return this },
            next() { log.push(this === it && 'next'); return { value: 123, done: false } },
            return() { log.push(this === it && 'return') },
          }
          try {
            for await (const x of it) {
              if (x !== 123) throw 'fail: ' + x
              throw 'foo'
            }
          } catch (err) {
            if (err !== 'foo') throw err
          }
          if (log + '' !== 'next,return') throw 'fail: ' + log
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        export let async = async () => {
          const log = []
          const it = {
            [Symbol.asyncIterator]() { return this },
            async next() { log.push(this === it && 'next'); return { value: 123, done: false } },
            async return() { log.push(this === it && 'return') },
          }
          try {
            for await (const x of it) {
              if (x !== 123) throw 'fail: ' + x
              throw 'foo'
            }
          } catch (err) {
            if (err !== 'foo') throw err
          }
          if (log + '' !== 'next,return') throw 'fail: ' + log
        }
      `,
    }, { async: true }),

    // return() must not be called in this case (TypeScript has this bug: https://github.com/microsoft/TypeScript/issues/50525)
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let pass = true
        async function f() {
          const y = {
            [Symbol.asyncIterator]() {
              let count = 0
              return {
                async next() {
                  count++
                  if (count === 2) throw 'error'
                  return { value: count }
                },
                async return() {
                  pass = false
                },
              }
            },
          }
          for await (let x of y) {
          }
        }
        f().catch(() => {
          if (!pass) throw 'fail'
        })
      `,
    }),

    // return() must be called in this case
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let pass = false
        async function f() {
          const y = {
            [Symbol.asyncIterator]() {
              let count = 0
              return {
                async next() {
                  count++
                  return { value: count }
                },
                async return() {
                  pass = true
                },
              }
            },
          }
          for await (let x of y) {
            throw 'error'
          }
        }
        f().catch(() => {
          if (!pass) throw 'fail'
        })
      `,
    }),
  )
}

// Check object rest lowering
// https://github.com/evanw/esbuild/issues/956
tests.push(
  test(['in.js', '--outfile=node.js', '--target=es6'], {
    'in.js': `
      let v, o = {b: 3, c: 5}, e = ({b: v, ...o} = o);
      if (o === e || o.b !== void 0 || o.c !== 5 || e.b !== 3 || e.c !== 5 || v !== 3) throw 'fail'
    `,
  }),
)

// Check object spread lowering
// https://github.com/evanw/esbuild/issues/1017
const objectAssignSemantics = `
  var a, b, c, p, s = Symbol('s')

  // Getter
  a = { x: 1 }
  b = { get x() {}, ...a }
  if (b.x !== a.x) throw 'fail: 1'

  // Symbol getter
  a = {}
  a[s] = 1
  p = {}
  Object.defineProperty(p, s, { get: () => {} })
  b = { __proto__: p, ...a }
  if (b[s] !== a[s]) throw 'fail: 2'

  // Non-enumerable
  a = {}
  Object.defineProperty(a, 'x', { value: 1 })
  b = { ...a }
  if (b.x === a.x) throw 'fail: 3'

  // Symbol non-enumerable
  a = {}
  Object.defineProperty(a, s, { value: 1 })
  b = { ...a }
  if (b[s] === a[s]) throw 'fail: 4'

  // Prototype
  a = Object.create({ x: 1 })
  b = { ...a }
  if (b.x === a.x) throw 'fail: 5'

  // Symbol prototype
  p = {}
  p[s] = 1
  a = Object.create(p)
  b = { ...a }
  if (b[s] === a[s]) throw 'fail: 6'

  // Getter evaluation 1
  a = 1
  b = 10
  p = { get x() { return a++ }, ...{ get y() { return b++ } } }
  if (
    p.x !== 1 || p.x !== 2 || p.x !== 3 ||
    p.y !== 10 || p.y !== 10 || p.y !== 10
  ) throw 'fail: 7'

  // Getter evaluation 2
  a = 1
  b = 10
  p = { ...{ get x() { return a++ } }, get y() { return b++ } }
  if (
    p.x !== 1 || p.x !== 1 || p.x !== 1 ||
    p.y !== 10 || p.y !== 11 || p.y !== 12
  ) throw 'fail: 8'

  // Getter evaluation 3
  a = 1
  b = 10
  c = 100
  p = { ...{ get x() { return a++ } }, get y() { return b++ }, ...{ get z() { return c++ } } }
  if (
    p.x !== 1 || p.x !== 1 || p.x !== 1 ||
    p.y !== 10 || p.y !== 11 || p.y !== 12 ||
    p.z !== 100 || p.z !== 100 || p.z !== 100
  ) throw 'fail: 9'

  // Inline prototype property
  p = { ...{ __proto__: null } }
  if (Object.prototype.hasOwnProperty.call(p, '__proto__') || Object.getPrototypeOf(p) === null) throw 'fail: 10'
`
tests.push(
  test(['in.js', '--outfile=node.js'], {
    'in.js': objectAssignSemantics,
  }),
  test(['in.js', '--outfile=node.js', '--target=es6'], {
    'in.js': objectAssignSemantics,
  }),
  test(['in.js', '--outfile=node.js', '--target=es5'], {
    'in.js': objectAssignSemantics,
  }),
  test(['in.js', '--outfile=node.js', '--minify-syntax'], {
    'in.js': objectAssignSemantics,
  }),
)

// Check big integer lowering
for (const minify of [[], '--minify']) {
  for (const target of [[], ['--target=es6']]) {
    tests.push(test(['in.js', '--outfile=node.js', '--bundle', '--log-override:bigint=silent'].concat(target).concat(minify), {
      'in.js': `
        var BigInt = function() {
          throw 'fail: BigInt'
        };

        function check(a, b, c) {
          if (b[a] !== true) throw 'fail 1: ' + a
          if (c(b) !== true) throw 'fail 2: ' + a
        }

        check(0n, { 0n: true }, ({ 0n: x }) => x)
        check(0b100101n, { 0b100101n: true }, ({ 0b100101n: x }) => x)
        check(0B100101n, { 0B100101n: true }, ({ 0B100101n: x }) => x)
        check(0o76543210n, { 0o76543210n: true }, ({ 0o76543210n: x }) => x)
        check(0O76543210n, { 0O76543210n: true }, ({ 0O76543210n: x }) => x)
        check(0xFEDCBA9876543210n, { 0xFEDCBA9876543210n: true }, ({ 0xFEDCBA9876543210n: x }) => x)
        check(0XFEDCBA9876543210n, { 0XFEDCBA9876543210n: true }, ({ 0XFEDCBA9876543210n: x }) => x)
        check(0xb0ba_cafe_f00dn, { 0xb0ba_cafe_f00dn: true }, ({ 0xb0ba_cafe_f00dn: x }) => x)
        check(0xB0BA_CAFE_F00Dn, { 0xB0BA_CAFE_F00Dn: true }, ({ 0xB0BA_CAFE_F00Dn: x }) => x)
        check(102030405060708090807060504030201n, { 102030405060708090807060504030201n: true }, ({ 102030405060708090807060504030201n: x }) => x)
      `,
    }))
  }

  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!(a | b)) throw 'fail'"
        function foo(a, b) { if ((a | b) === 0) throw 'fail' }
        foo(0n, 0n)
        foo(1n, 1n)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!(a & b)) throw 'fail'"
        function foo(a, b) { if ((a & b) === 0) throw 'fail' }
        foo(0n, 0n)
        foo(1n, 1n)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!(a ^ b)) throw 'fail'"
        function foo(a, b) { if ((a ^ b) === 0) throw 'fail' }
        foo(0n, 0n)
        foo(0n, 1n)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!(a << b)) throw 'fail'"
        function foo(a, b) { if ((a << b) === 0) throw 'fail' }
        foo(0n, 0n)
        foo(1n, 1n)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!(a >> b)) throw 'fail'"
        function foo(a, b) { if ((a >> b) === 0) throw 'fail' }
        foo(1n, 0n)
        foo(1n, 1n)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        // Must not be minified to "if (!~a) throw 'fail'"
        function foo(a) { if (~a === 0) throw 'fail' }
        foo(-1n)
        foo(1n)
      `,
    }),
  )
}

// Check template literal lowering
for (const target of ['--target=es5', '--target=es6', '--target=es2020']) {
  tests.push(
    // Untagged template literals
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var obj = {
          toString: () => 'b',
          valueOf: () => 0,
        }
        if (\`\${obj}\` !== 'b') throw 'fail'
        if (\`a\${obj}\` !== 'ab') throw 'fail'
        if (\`\${obj}c\` !== 'bc') throw 'fail'
        if (\`a\${obj}c\` !== 'abc') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var obj = {}
        obj[Symbol.toPrimitive] = hint => {
          if (hint !== 'string') throw 'fail'
          return 'b'
        }
        if (\`\${obj}\` !== 'b') throw 'fail'
        if (\`a\${obj}\` !== 'ab') throw 'fail'
        if (\`\${obj}c\` !== 'bc') throw 'fail'
        if (\`a\${obj}c\` !== 'abc') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var list = []
        var trace = x => list.push(x)
        var obj2 = { toString: () => trace(2) };
        var obj4 = { toString: () => trace(4) };
        \`\${trace(1), obj2}\${trace(3), obj4}\`
        if (list.join('') !== '1234') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        x: {
          try {
            \`\${Symbol('y')}\`
          } catch {
            break x
          }
          throw 'fail'
        }
      `,
    }),

    // Tagged template literals
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => x[0] === 'y' && x.raw[0] === 'y')\`y\` !== true) throw 'fail'
        if ((x => x[0] === 'y' && x.raw[0] === 'y')\`y\${0}\` !== true) throw 'fail'
        if ((x => x[1] === 'y' && x.raw[1] === 'y')\`\${0}y\` !== true) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => x[0] === '\\xFF' && x.raw[0] === '\\\\xFF')\`\\xFF\` !== true) throw 'fail'
        if ((x => x[0] === '\\xFF' && x.raw[0] === '\\\\xFF')\`\\xFF\${0}\` !== true) throw 'fail'
        if ((x => x[1] === '\\xFF' && x.raw[1] === '\\\\xFF')\`\${0}\\xFF\` !== true) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => x[0] === void 0 && x.raw[0] === '\\\\u')\`\\u\` !== true) throw 'fail'
        if ((x => x[0] === void 0 && x.raw[0] === '\\\\u')\`\\u\${0}\` !== true) throw 'fail'
        if ((x => x[1] === void 0 && x.raw[1] === '\\\\u')\`\${0}\\u\` !== true) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => x !== x.raw)\`y\` !== true) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => (x.length = 2, x.length))\`y\` !== 1) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        if ((x => (x.raw.length = 2, x.raw.length))\`y\` !== 1) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var count = 0
        var foo = () => (() => ++count)\`y\`;
        if (foo() !== 1 || foo() !== 2) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var foo = () => (x => x)\`y\`;
        if (foo() !== foo()) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var foo = () => (x => x)\`y\`;
        var bar = () => (x => x)\`y\`;
        if (foo() === bar()) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', target], {
      'in.js': `
        var count = 0;
        var obj = {
          foo: function() {
            if (this === obj) count++;
          }
        };
        var bar = 'foo';
        (obj?.foo)\`\`;
        (obj?.[bar])\`\`;
        var other = { obj };
        (other?.obj.foo)\`\`;
        (other?.obj[bar])\`\`;
        if (count !== 4) throw 'fail';
      `,
    }),

    // Unused minified template literals. See this for more info:
    // https://github.com/terser/terser/issues/1128#issuecomment-994209801
    test(['in.js', '--outfile=node.js', '--minify', target], {
      'in.js': `
        var text = '';
        var foo = {
          toString: () => text += 'toString',
          valueOf: () => text += 'valueOf',
        };
        \`\${foo}\`;
        if (text !== 'toString') throw 'fail: ' + text + ' !== toString'
      `,
    }),
    test(['in.js', '--outfile=node.js', '--minify', target], {
      'in.js': `
        var text = '';
        var foo = {
          toString: () => text += 'toString',
        };
        \`abc \${text += 'A', foo} xyz \${text += 'B', foo} 123\`;
        if (text !== 'AtoStringBtoString') throw 'fail: ' + text + ' !== AtoStringBtoString'
      `,
    }),
  )
}

let simpleCyclicImportTestCase542 = {
  'in.js': `
    import {Test} from './lib';
    export function fn() {
      return 42;
    }
    export const foo = [Test];
    if (Test.method() !== 42) throw 'fail'
  `,
  'lib.js': `
    import {fn} from './in';
    export class Test {
      static method() {
        return fn();
      }
    }
  `,
}

// Test internal import order
tests.push(
  // See https://github.com/evanw/esbuild/issues/421
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `
      import {foo} from './cjs'
      import {bar} from './esm'
      if (foo !== 1 || bar !== 2) throw 'fail'
    `,
    'cjs.js': `exports.foo = 1; global.internal_import_order_test1 = 2`,
    'esm.js': `export let bar = global.internal_import_order_test1`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `
      if (foo !== 3 || bar !== 4) throw 'fail'
      import {foo} from './cjs'
      import {bar} from './esm'
    `,
    'cjs.js': `exports.foo = 3; global.internal_import_order_test2 = 4`,
    'esm.js': `export let bar = global.internal_import_order_test2`,
  }),

  // See https://github.com/evanw/esbuild/issues/542
  test(['--bundle', 'in.js', '--outfile=node.js'], simpleCyclicImportTestCase542),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=iife'], simpleCyclicImportTestCase542),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=iife', '--global-name=someName'], simpleCyclicImportTestCase542),
)

// Test CommonJS semantics
tests.push(
  // "module.require" should work with internal modules
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {foo, req} from './foo'`,
    'foo.js': `exports.req = module.require; exports.foo = module.require('./bar')`,
    'bar.js': `exports.bar = 123`,
    'node.js': `if (require('./out').foo.bar !== 123 || require('./out').req !== undefined) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {foo, req} from './foo'`,
    'foo.js': `exports.req = module['require']; exports.foo = module['require']('./bar')`,
    'bar.js': `exports.bar = 123`,
    'node.js': `if (require('./out').foo.bar !== 123 || require('./out').req !== undefined) throw 'fail'`,
  }),

  // "module.require" should work with external modules
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'in.js': `export {foo} from './foo'`,
    'foo.js': `exports.foo = module.require('fs').exists`,
    'node.js': `if (require('./out').foo !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {foo} from './foo'`,
    'foo.js': `let fn = (m, p) => m.require(p); exports.foo = fn(module, 'fs').exists`,
    'node.js': `try { require('./out') } catch (e) { return } throw 'fail'`,
  }),

  // "module.exports" should behave like a normal property
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {foo} from './foo'`,
    'foo.js': `exports.foo = module.exports`,
    'node.js': `if (require('./out').foo !== require('./out').foo.foo) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {default} from './foo'`,
    'foo.js': `module.exports = 123`,
    'node.js': `if (require('./out').default !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {default} from './foo'`,
    'foo.js': `let m = module; m.exports = 123`,
    'node.js': `if (require('./out').default !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `export {default} from './foo'`,
    'foo.js': `let fn = (m, x) => m.exports = x; fn(module, 123)`,
    'node.js': `if (require('./out').default !== 123) throw 'fail'`,
  }),

  // Deferred require shouldn't affect import
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      import { foo } from './a'
      import './b'
      if (foo !== 123) throw 'fail'
    `,
    'a.js': `
      export let foo = 123
    `,
    'b.js': `
      setTimeout(() => require('./a'), 0)
    `,
  }),

  // Test the run-time value of "typeof require"
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=iife'], {
    'in.js': `check(typeof require)`,
    'node.js': `
      const out = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const check = x => value = x
      let value
      new Function('check', 'require', out)(check)
      if (value !== 'function') throw 'fail'
    `,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `check(typeof require)`,
    'node.js': `
      import fs from 'fs'
      import path from 'path'
      import url from 'url'
      const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
      const out = fs.readFileSync(__dirname + '/out.js', 'utf8')
      const check = x => value = x
      let value
      new Function('check', 'require', out)(check)
      if (value !== 'function') throw 'fail'
    `,
  }),
  test(['--bundle', 'in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `check(typeof require)`,
    'node.js': `
      const out = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const check = x => value = x
      let value
      new Function('check', 'require', out)(check)
      if (value !== 'undefined') throw 'fail'
    `,
  }),
)

// Test internal CommonJS export
tests.push(
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
    'foo.js': `exports.foo = 123`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (out.__esModule || out !== 123) throw 'fail'`,
    'foo.js': `module.exports = 123`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
    'foo.js': `export const foo = 123`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
    'foo.js': `export default 123`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (!out.__esModule || out.default !== null) throw 'fail'`,
    'foo.js': `export default function x() {} x = null`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `const out = require('./foo'); if (!out.__esModule || out.default !== null) throw 'fail'`,
    'foo.js': `export default class x {} x = null`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `
      // This is the JavaScript generated by "tsc" for the following TypeScript:
      //
      //   import fn from './foo'
      //   if (typeof fn !== 'function') throw 'fail'
      //
      "use strict";
      var __importDefault = (this && this.__importDefault) || function (mod) {
        return (mod && mod.__esModule) ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      const foo_1 = __importDefault(require("./foo"));
      if (typeof foo_1.default !== 'function')
        throw 'fail';
    `,
    'foo.js': `export default function fn() {}`,
  }),

  // Self export
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `exports.foo = 123; const out = require('./in'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `module.exports = 123; const out = require('./in'); if (out.__esModule || out !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=cjs', '--minify'], {
    'in.js': `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `export default 123; const out = require('./in'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=esm', '--minify'], {
    'in.js': `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `export default 123; const out = require('./in'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
  }),

  // Test bundled and non-bundled double export star
  test(['node.ts', '--bundle', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a, b} from './re-export'
      if (a !== 'a' || b !== 'b') throw 'fail'
    `,
    're-export.ts': `
      export * from './a'
      export * from './b'
    `,
    'a.ts': `
      export let a = 'a'
    `,
    'b.ts': `
      export let b = 'b'
    `,
  }),
  test(['node.ts', '--bundle', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a, b} from './re-export'
      if (a !== 'a' || b !== 'b') throw 'fail'

      // Try forcing all of these modules to be wrappers
      require('./node')
      require('./re-export')
      require('./a')
      require('./b')
    `,
    're-export.ts': `
      export * from './a'
      export * from './b'
    `,
    'a.ts': `
      export let a = 'a'
    `,
    'b.ts': `
      export let b = 'b'
    `,
  }),
  test(['node.ts', '--bundle', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a, b, c, d} from './re-export'
      if (a !== 'a' || b !== 'b' || c !== 'c' || d !== 'd') throw 'fail'

      // Try forcing all of these modules to be wrappers
      require('./node')
      require('./re-export')
      require('./a')
      require('./b')
    `,
    're-export.ts': `
      export * from './a'
      export * from './b'
      export * from './d'
    `,
    'a.ts': `
      export let a = 'a'
    `,
    'b.ts': `
      exports.b = 'b'
    `,
    'c.ts': `
      exports.c = 'c'
    `,
    'd.ts': `
      export * from './c'
      export let d = 'd'
    `,
  }),
  test(['node.ts', 're-export.ts', 'a.ts', 'b.ts', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a, b} from './re-export'
      if (a !== 'a' || b !== 'b') throw 'fail'
    `,
    're-export.ts': `
      export * from './a'
      export * from './b'
    `,
    'a.ts': `
      export let a = 'a'
    `,
    'b.ts': `
      export let b = 'b'
    `,
  }),
  test(['entry1.js', 'entry2.js', '--splitting', '--bundle', '--format=esm', '--outdir=out'], {
    'entry1.js': `
      import { abc, def, xyz } from './a'
      export default [abc, def, xyz]
    `,
    'entry2.js': `
      import * as x from './b'
      export default x
    `,
    'a.js': `
      export let abc = 'abc'
      export * from './b'
    `,
    'b.js': `
      export * from './c'
      export const def = 'def'
    `,
    'c.js': `
      exports.xyz = 'xyz'
    `,
    'node.js': `
      import entry1 from './out/entry1.js'
      import entry2 from './out/entry2.js'
      if (entry1[0] !== 'abc' || entry1[1] !== 'def' || entry1[2] !== 'xyz') throw 'fail'
      if (entry2.def !== 'def' || entry2.xyz !== 'xyz') throw 'fail'
    `,
  }),

  // Complex circular bundled and non-bundled import case (https://github.com/evanw/esbuild/issues/758)
  test(['node.ts', '--bundle', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a} from './re-export'
      let fn = a()
      if (fn === a || fn() !== a) throw 'fail'
    `,
    're-export.ts': `
      export * from './a'
    `,
    'a.ts': `
      import {b} from './b'
      export let a = () => b
    `,
    'b.ts': `
      import {a} from './re-export'
      export let b = () => a
    `,
  }),
  test(['node.ts', '--bundle', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a} from './re-export'
      let fn = a()
      if (fn === a || fn() !== a) throw 'fail'

      // Try forcing all of these modules to be wrappers
      require('./node')
      require('./re-export')
      require('./a')
      require('./b')
    `,
    're-export.ts': `
      export * from './a'
    `,
    'a.ts': `
      import {b} from './b'
      export let a = () => b
    `,
    'b.ts': `
      import {a} from './re-export'
      export let b = () => a
    `,
  }),
  test(['node.ts', 're-export.ts', 'a.ts', 'b.ts', '--format=cjs', '--outdir=.'], {
    'node.ts': `
      import {a} from './re-export'
      let fn = a()
      if (fn === a || fn() !== a) throw 'fail'
    `,
    're-export.ts': `
      export * from './a'
    `,
    'a.ts': `
      import {b} from './b'
      export let a = () => b
    `,
    'b.ts': `
      import {a} from './re-export'
      export let b = () => a
    `,
  }),

  // Failure case due to a bug in https://github.com/evanw/esbuild/pull/2059
  test(['in.ts', '--bundle', '--format=cjs', '--outfile=out.js', '--external:*.cjs'], {
    'in.ts': `
      export * from './a.cjs'
      import * as inner from './inner.js'
      export { inner }
    `,
    'inner.ts': `export * from './b.cjs'`,
    'a.cjs': `exports.a = 'a'`,
    'b.cjs': `exports.b = 'b'`,
    'node.js': `
      const out = require('./out.js')
      if (out.a !== 'a' || out.inner === void 0 || out.inner.b !== 'b' || out.b !== void 0) throw 'fail'
    `,
  }),

  // Validate internal and external export correctness regarding "__esModule".
  // An ES module importing itself should not see "__esModule". But a CommonJS
  // module importing an ES module should see "__esModule".
  test(['in.ts', '--bundle', '--format=cjs', '--outfile=out.js', '--external:*.cjs'], {
    'in.ts': `
      export * from './a.cjs'
      import * as us from './in.js'
      if (us.a !== 'a' || us.__esModule !== void 0) throw 'fail'
    `,
    'a.cjs': `exports.a = 'a'`,
    'node.js': `
      const out = require('./out.js')
      if (out.a !== 'a' || out.__esModule !== true) throw 'fail'
    `,
  }),

  // Use "eval" to access CommonJS variables
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `if (require('./eval').foo !== 123) throw 'fail'`,
    'eval.js': `eval('exports.foo = 123')`,
  }),
  test(['--bundle', 'in.js', '--outfile=node.js'], {
    'in.js': `if (require('./eval').foo !== 123) throw 'fail'`,
    'eval.js': `eval('module.exports = {foo: 123}')`,
  }),
)

// Test internal ES6 export
for (const minify of [[], ['--minify']]) {
  for (const target of ['es5', 'es6']) {
    tests.push(
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.foo !== 123) throw 'fail'`,
        'foo.js': `exports.foo = 123`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.default !== 123) throw 'fail'`,
        'foo.js': `module.exports = 123`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.default !== null) throw 'fail'`,
        'foo.js': `module.exports = null`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.default !== void 0) throw 'fail'`,
        'foo.js': `module.exports = void 0`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.foo !== 123) throw 'fail'`,
        'foo.js': `export var foo = 123`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import * as out from './foo'; if (out.default !== 123) throw 'fail'`,
        'foo.js': `export default 123`,
      }),

      // Self export
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        // Exporting like this doesn't work, but that's ok
        'in.js': `exports.foo = 123; import * as out from './in'; if (out.foo !== undefined) throw 'fail'`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        // Exporting like this doesn't work, but that's ok
        'in.js': `module.exports = {foo: 123}; import * as out from './in'; if (out.foo !== undefined) throw 'fail'`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `export var foo = 123; import * as out from './in'; if (out.foo !== 123) throw 'fail'`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `export default 123; import * as out from './in'; if (out.default !== 123) throw 'fail'`,
      }),

      // Check the value of "this"
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import {foo} from './foo'; if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `export function foo() { return this }`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import foo from './foo'; if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `export default function() { return this }`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import {foo} from './foo'; require('./foo'); if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `export function foo() { return this }`,
      }),
      test(['--bundle', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import foo from './foo'; require('./foo'); if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `export default function() { return this }`,
      }),
      test(['--bundle', '--external:./foo', '--format=cjs', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import {foo} from './foo'; if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `exports.foo = function() { return this }`,
      }),
      test(['--bundle', '--external:./foo', '--format=cjs', 'in.js', '--outfile=node.js', '--target=' + target].concat(minify), {
        'in.js': `import foo from './foo'; if (foo() !== (function() { return this })()) throw 'fail'`,
        'foo.js': `module.exports = function() { return this }`,
      }),
    )
  }

  tests.push(
    // Make sure entry points where a dependency has top-level await are awaited
    test(['--bundle', 'in.js', '--outfile=out.js', '--format=esm'].concat(minify), {
      'in.js': `import './foo'; import('./in.js'); throw 'fail'`,
      'foo.js': `throw await 'stop'`,
      'node.js': `export let async = async () => { try { await import('./out.js') } catch (e) { if (e === 'stop') return } throw 'fail' }`,
    }, { async: true }),

    // Self export
    test(['--bundle', 'in.js', '--outfile=node.js', '--format=esm'].concat(minify), {
      'in.js': `export default 123; export let async = async () => { const out = await import('./in'); if (out.default !== 123) throw 'fail' }`,
    }, { async: true }),
    test(['--bundle', 'in.js', '--outfile=node.js', '--format=esm'].concat(minify), {
      'in.js': `export default 123; import * as out from './in'; export let async = async () => { await import('./in'); if (out.default !== 123) throw 'fail' }`,
    }, { async: true }),

    // Inject
    test(['--bundle', 'node.ts', 'node2.ts', '--outdir=.', '--format=esm', '--inject:foo.js', '--splitting'].concat(minify), {
      'node.ts': `if (foo.bar !== 123) throw 'fail'`,
      'node2.ts': `throw [foo.bar, require('./node2.ts')] // Force this file to be lazily initialized so foo.js is lazily initialized`,
      'foo.js': `export let foo = {bar: 123}`,
    }),

    // https://github.com/evanw/esbuild/issues/2793
    test(['--bundle', 'src/index.js', '--outfile=node.js', '--format=esm'].concat(minify), {
      'src/a.js': `
        export const A = 42;
      `,
      'src/b.js': `
        export const B = async () => (await import(".")).A
      `,
      'src/index.js': `
        export * from "./a"
        export * from "./b"
        import { B } from '.'
        export let async = async () => { if (42 !== await B()) throw 'fail' }
      `,
    }, { async: true }),
    test(['--bundle', 'src/node.js', '--outdir=.', '--format=esm', '--splitting'].concat(minify), {
      'src/a.js': `
        export const A = 42;
      `,
      'src/b.js': `
        export const B = async () => (await import("./node")).A
      `,
      'src/node.js': `
        export * from "./a"
        export * from "./b"
        import { B } from './node'
        export let async = async () => { if (42 !== await B()) throw 'fail' }
      `,
    }, { async: true }),
  )
}

// Check that duplicate top-level exports don't collide in the presence of "eval"
tests.push(
  test(['--bundle', '--format=esm', 'in.js', '--outfile=node.js'], {
    'in.js': `
      import a from './a'
      if (a !== 'runner1.js') throw 'fail'
      import b from './b'
      if (b !== 'runner2.js') throw 'fail'
    `,
    'a.js': `
      import { run } from './runner1'
      export default run()
    `,
    'runner1.js': `
      let data = eval('"runner1" + ".js"')
      export function run() { return data }
    `,
    'b.js': `
      import { run } from './runner2'
      export default run()
    `,
    'runner2.js': `
      let data = eval('"runner2" + ".js"')
      export function run() { return data }
    `,
  }, {
    // There are two possible output orders due to log output order non-determinism
    expectedStderr: [
      `▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner1.js:2:17:
      2 │       let data = eval('"runner1" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner2.js:2:17:
      2 │       let data = eval('"runner2" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

`, `▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner2.js:2:17:
      2 │       let data = eval('"runner2" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner1.js:2:17:
      2 │       let data = eval('"runner1" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

`,
    ],
  }),
  test(['--bundle', '--format=esm', '--splitting', 'in.js', 'in2.js', '--outdir=out'], {
    'in.js': `
      import a from './a'
      import b from './b'
      export default [a, b]
    `,
    'a.js': `
      import { run } from './runner1'
      export default run()
    `,
    'runner1.js': `
      let data = eval('"runner1" + ".js"')
      export function run() { return data }
    `,
    'b.js': `
      import { run } from './runner2'
      export default run()
    `,
    'runner2.js': `
      let data = eval('"runner2" + ".js"')
      export function run() { return data }
    `,
    'in2.js': `
      import { run } from './runner2'
      export default run()
    `,
    'node.js': `
      import ab from './out/in.js'
      if (ab[0] !== 'runner1.js' || ab[1] !== 'runner2.js') throw 'fail'
    `,
  }, {
    // There are two possible output orders due to log output order non-determinism
    expectedStderr: [
      `▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner1.js:2:17:
      2 │       let data = eval('"runner1" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner2.js:2:17:
      2 │       let data = eval('"runner2" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

`, `▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner2.js:2:17:
      2 │       let data = eval('"runner2" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

▲ [WARNING] Using direct eval with a bundler is not recommended and may cause problems [direct-eval]

    runner1.js:2:17:
      2 │       let data = eval('"runner1" + ".js"')
        ╵                  ~~~~

  You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval

`,
    ],
  }),
)

// Test "default" exports in ESM-to-CommonJS conversion scenarios
tests.push(
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import def from './foo'; if (def !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.default = 123`,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import * as ns from './foo'; if (ns.default !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.default = 123`,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import def from './foo'; if (def !== void 0) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.foo = 123`,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import * as ns from './foo'; if (ns.default !== void 0 || ns.foo !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.foo = 123`,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import def from './foo'; if (!def || def.foo !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = false; exports.foo = 123`,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `import * as ns from './foo'; if (!ns.default || ns.default.foo !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = false; exports.foo = 123`,
  }),
  test(['in.mjs', '--outfile=node.js', '--format=cjs'], {
    'in.mjs': `import def from './foo'; if (!def || def.foo !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.foo = 123`,
  }),
  test(['in.mjs', '--outfile=node.js', '--format=cjs'], {
    'in.mjs': `import * as ns from './foo'; if (!ns.default || ns.default.foo !== 123) throw 'fail'`,
    'foo.js': `exports.__esModule = true; exports.foo = 123`,
  }),

  // Make sure "import {} from; export {}" behaves like "export {} from"
  // https://github.com/evanw/esbuild/issues/1890
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import * as foo from './foo.js'; if (foo.bar !== 123) throw 'fail'`,
    'foo.ts': `import bar from './lib.js'; export { bar }`,
    'lib.js': `module.exports = 123`,
  }),
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import * as foo from './foo.js'; if (foo.bar !== 123) throw 'fail'`,
    'foo.ts': `import { default as bar } from './lib.js'; export { bar }`,
    'lib.js': `module.exports = 123`,
  }),
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import * as foo from './foo.js'; if (foo.bar !== 123) throw 'fail'`,
    'foo.ts': `export { default as bar } from './lib.js'`,
    'lib.js': `module.exports = 123`,
  }),
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import { foo } from './foo.js'; if (foo.default !== 123) throw 'fail'`,
    'foo.ts': `import * as foo from './lib.js'; export { foo }`,
    'lib.js': `module.exports = 123`,
  }),
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import { foo } from './foo.js'; if (foo.default !== 123) throw 'fail'`,
    'foo.ts': `export * as foo from './lib.js'`,
    'lib.js': `module.exports = 123`,
  }),
  test(['node.ts', 'foo.ts', '--outdir=.', '--format=cjs'], {
    'node.ts': `import * as foo from './foo.js'; if (foo.default !== void 0) throw 'fail'`,
    'foo.ts': `export * from './lib.js'`,
    'lib.js': `module.exports = 123`,
  }),
)

// Test external wildcards
tests.push(
  test(['--bundle', 'src/foo.js', '--outfile=node.js', '--external:./src/dir/*', '--format=cjs'], {
    'src/foo.js': `
      function foo() {
        require('./dir/bar')
      }
      let worked = false
      try {
        foo()
        worked = true
      } catch (e) {
      }
      if (worked) throw 'fail'
    `,
  }),
  test(['--bundle', 'src/foo.js', '--outfile=node.js', '--external:./src/dir/*', '--format=cjs'], {
    'src/foo.js': `
      require('./dir/bar')
    `,
    'src/dir/bar.js': ``,
  }),
)

// Test external CommonJS export
tests.push(
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs'], {
    'foo.js': `exports.foo = 123`,
    'node.js': `const out = require('./out'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs'], {
    'foo.js': `module.exports = 123`,
    'node.js': `const out = require('./out'); if (out.__esModule || out !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm'], {
    'foo.js': `exports.foo = 123`,
    'node.js': `import out from './out.js'; if (out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm'], {
    'foo.js': `module.exports = 123`,
    'node.js': `import out from './out.js'; if (out !== 123) throw 'fail'`,
  }),
)

// Test external ES6 export
tests.push(
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--platform=node'], {
    'foo.js': `export const foo = 123`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--platform=node'], {
    'foo.js': `export default 123`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--platform=node'], {
    'foo.js': `const something = 123; export { something as 'some name' }`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out['some name'] !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm'], {
    'foo.js': `export const foo = 123`,
    'node.js': `import {foo} from './out.js'; if (foo !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm'], {
    'foo.js': `export default 123`,
    'node.js': `import out from './out.js'; if (out !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm'], {
    'foo.js': `const something = 123; export { something as 'some name' }`,
    'node.js': `import { 'some name' as out } from './out.js'; if (out !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--platform=node'], {
    'foo.js': `
      export function confuseNode(exports) {
        // If this local is called "exports", node incorrectly
        // thinks this file has an export called "notAnExport".
        // We must make sure that it doesn't have that name
        // when targeting Node with CommonJS. See also:
        // https://github.com/evanw/esbuild/issues/3544
        exports.notAnExport = function() {
        };
      }
    `,
    'node.js': `
      exports.async = async () => {
        const foo = await import('./out.js')
        if (typeof foo.confuseNode !== 'function') throw 'fail: confuseNode'
        if ('notAnExport' in foo) throw 'fail: notAnExport'
      }
    `,
  }, { async: true }),

  // External package
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'foo.js': `import {exists} from "fs"; export {exists}`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.exists !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm', '--external:fs'], {
    'foo.js': `import {exists} from "fs"; export {exists}`,
    'node.js': `import {exists} from "./out.js"; import * as fs from "fs"; if (exists !== fs.exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'foo.js': `import * as fs from "fs"; export let exists = fs.exists`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.exists !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm', '--external:fs'], {
    'foo.js': `import * as fs from "fs"; export let exists = fs.exists`,
    'node.js': `import {exists} from "./out.js"; import * as fs from "fs"; if (exists !== fs.exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'foo.js': `export {exists} from "fs"`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.exists !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm', '--external:fs'], {
    'foo.js': `export {exists} from "fs"`,
    'node.js': `import {exists} from "./out.js"; import * as fs from "fs"; if (exists !== fs.exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'foo.js': `export * from "fs"`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.exists !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm', '--external:fs'], {
    'foo.js': `export * from "fs"`,
    'node.js': `import {exists} from "./out.js"; import * as fs from "fs"; if (exists !== fs.exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=cjs', '--external:fs'], {
    'foo.js': `export * as star from "fs"`,
    'node.js': `const out = require('./out'); if (!out.__esModule || out.star.exists !== require('fs').exists) throw 'fail'`,
  }),
  test(['--bundle', 'foo.js', '--outfile=out.js', '--format=esm', '--external:fs'], {
    'foo.js': `export * as star from "fs"`,
    'node.js': `import {star} from "./out.js"; import * as fs from "fs"; if (star.exists !== fs.exists) throw 'fail'`,
  }),
)

// ES6 export star of CommonJS module
tests.push(
  // Internal
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import * as ns from './re-export'; if (ns.foo !== 123) throw 'fail'`,
    're-export.js': `export * from './commonjs'`,
    'commonjs.js': `exports.foo = 123`,
  }),
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import {foo} from './re-export'; if (foo !== 123) throw 'fail'`,
    're-export.js': `export * from './commonjs'`,
    'commonjs.js': `exports.foo = 123`,
  }),

  // External
  test(['--bundle', 'entry.js', '--outfile=node.js', '--external:fs'], {
    'entry.js': `import * as ns from './re-export'; if (typeof ns.exists !== 'function') throw 'fail'`,
    're-export.js': `export * from 'fs'`,
  }),
  test(['--bundle', 'entry.js', '--outfile=node.js', '--external:fs'], {
    'entry.js': `import {exists} from './re-export'; if (typeof exists !== 'function') throw 'fail'`,
    're-export.js': `export * from 'fs'`,
  }),

  // External (masked)
  test(['--bundle', 'entry.js', '--outfile=node.js', '--external:fs'], {
    'entry.js': `import * as ns from './re-export'; if (ns.exists !== 123) throw 'fail'`,
    're-export.js': `export * from 'fs'; export let exists = 123`,
  }),
  test(['--bundle', 'entry.js', '--outfile=node.js', '--external:fs'], {
    'entry.js': `import {exists} from './re-export'; if (exists !== 123) throw 'fail'`,
    're-export.js': `export * from 'fs'; export let exists = 123`,
  }),

  // Export CommonJS export from ES6 module
  test(['--bundle', 'entry.js', '--outfile=out.js', '--format=cjs'], {
    'entry.js': `export {bar} from './foo'`,
    'foo.js': `exports.bar = 123`,
    'node.js': `const out = require('./out.js'); if (out.bar !== 123) throw 'fail'`,
  }),
  test(['--bundle', 'entry.js', '--outfile=out.js', '--format=esm'], {
    'entry.js': `export {bar} from './foo'`,
    'foo.js': `exports.bar = 123`,
    'node.js': `import {bar} from './out.js'; if (bar !== 123) throw 'fail'`,
  }),
)

// Test imports from modules without any imports
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg'
      if (ns.default === void 0) throw 'fail'
    `,
    'node_modules/pkg/index.js': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg/index.cjs'
      if (ns.default === void 0) throw 'fail'
    `,
    'node_modules/pkg/index.cjs': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg/index.cts'
      if (ns.default === void 0) throw 'fail'
    `,
    'node_modules/pkg/index.cts': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg/index.mjs'
      if (ns.default !== void 0) throw 'fail'
    `,
    'node_modules/pkg/index.mjs': ``,
  }, {
    expectedStderr: `▲ [WARNING] Import "default" will always be undefined because there is no matching export in "node_modules/pkg/index.mjs" [import-is-undefined]

    in.js:3:13:
      3 │       if (ns.default !== void 0) throw 'fail'
        ╵              ~~~~~~~

`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg/index.mts'
      if (ns.default !== void 0) throw 'fail'
    `,
    'node_modules/pkg/index.mts': ``,
  }, {
    expectedStderr: `▲ [WARNING] Import "default" will always be undefined because there is no matching export in "node_modules/pkg/index.mts" [import-is-undefined]

    in.js:3:13:
      3 │       if (ns.default !== void 0) throw 'fail'
        ╵              ~~~~~~~

`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg'
      if (ns.default === void 0) throw 'fail'
    `,
    'node_modules/pkg/package.json': `{
      "type": "commonjs"
    }`,
    'node_modules/pkg/index.js': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from 'pkg'
      if (ns.default !== void 0) throw 'fail'
    `,
    'node_modules/pkg/package.json': `{
      "type": "module"
    }`,
    'node_modules/pkg/index.js': ``,
  }, {
    expectedStderr: `▲ [WARNING] Import "default" will always be undefined because there is no matching export in "node_modules/pkg/index.js" [import-is-undefined]

    in.js:3:13:
      3 │       if (ns.default !== void 0) throw 'fail'
        ╵              ~~~~~~~

`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--external:pkg'], {
    'in.js': `
      import * as ns from 'pkg'
      if (ns.default === void 0) throw 'fail'
    `,
    'node_modules/pkg/index.js': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--external:pkg'], {
    'in.js': `
      import * as ns from 'pkg'
      if (ns.foo !== void 0) throw 'fail'
    `,
    'node_modules/pkg/index.js': ``,
  }),
)

// Test imports not being able to access the namespace object
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import {foo} from './esm'
      if (foo !== 123) throw 'fail'
    `,
    'esm.js': `Object.defineProperty(exports, 'foo', {value: 123, enumerable: false})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as ns from './esm'
      if (ns[Math.random() < 2 && 'foo'] !== 123) throw 'fail'
    `,
    'esm.js': `Object.defineProperty(exports, 'foo', {value: 123, enumerable: false})`,
  }),
)

// Test imports of properties from the prototype chain of "module.exports" for Webpack compatibility
tests.push(
  // Imports
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import def from './cjs-proto'
      import {prop} from './cjs-proto'
      if (def.prop !== 123 || prop !== 123) throw 'fail'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import def, {prop} from './cjs-proto' // The TypeScript compiler fails with this syntax
      if (def.prop !== 123 || prop !== 123) throw 'fail'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as star from './cjs-proto'
      if (!star.default || star.default.prop !== 123 || star.prop !== 123) throw 'fail'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),

  // Re-exports
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as test from './reexport'
      if (test.def.prop !== 123 || test.prop !== 123) throw 'fail'
    `,
    'reexport.js': `
      export {default as def} from './cjs-proto'
      export {prop} from './cjs-proto'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as test from './reexport'
      if (test.def.prop !== 123 || test.prop !== 123) throw 'fail'
    `,
    'reexport.js': `
      export {default as def, prop} from './cjs-proto' // The TypeScript compiler fails with this syntax
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as test from './reexport'
      // Note: the specification says to ignore default exports in "export * from"
      // Note: re-exporting prototype properties using "export * from" is not supported
      if (test.default || test.prop !== void 0) throw 'fail'
    `,
    'reexport.js': `
      export * from './cjs-proto'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import {star} from './reexport'
      if (!star.default || star.default.prop !== 123 || star.prop !== 123) throw 'fail'
    `,
    'reexport.js': `
      export * as star from './cjs-proto'
    `,
    'cjs-proto.js': `module.exports = Object.create({prop: 123})`,
  }),
)

// Test for format conversion without bundling
tests.push(
  // ESM => ESM
  test(['in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `
      import {exists} from 'fs'
      if (!exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `
      import fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `
      import * as fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `
      let fn = async () => {
        let fs = await import('fs')
        if (!fs.exists) throw 'fail'
      }
      export {fn as async}
    `,
  }, { async: true }),
  test(['in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `
      export let foo = 'abc'
      export default function() {
        return 123
      }
    `,
    'node.js': `
      import * as out from './out.js'
      if (out.foo !== 'abc' || out.default() !== 123) throw 'fail'
    `,
  }),

  // ESM => CJS
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      import {exists} from 'fs'
      if (!exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      import fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      import * as fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      let fn = async () => {
        let fs = await import('fs')
        if (!fs.exists) throw 'fail'
      }
      export {fn as async}
    `,
  }, { async: true }),
  test(['in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `
      export let foo = 'abc'
      export default function() {
        return 123
      }
    `,
    'node.js': `
      const out = require('./out.js')
      if (out.foo !== 'abc' || out.default() !== 123) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.cjs', '--format=cjs', '--platform=node'], {
    'in.js': `
      export let foo = 123
      let bar = 234
      export { bar as if }
      export default 345
    `,
    'node.js': `
      exports.async = async () => {
        let out = await import('./out.cjs')
        let keys = Object.keys(out)
        if (
          !keys.includes('default') || !keys.includes('foo') || !keys.includes('if') ||
          out.foo !== 123 || out.if !== 234 ||
          out.default.foo !== 123 || out.default.if !== 234 || out.default.default !== 345
        ) throw 'fail'
      }
    `,
  }, { async: true }),

  // https://github.com/evanw/esbuild/issues/3029
  test([
    'node_modules/util-ex/src/index.js',
    'node_modules/util-ex/src/fn1.js',
    'node_modules/util-ex/src/fn2.js',
    '--outdir=node_modules/util-ex/lib',
    '--format=cjs',
    '--platform=node',
  ], {
    'node_modules/util-ex/src/index.js': `
      export * from './fn1'
      export * from './fn2'
    `,
    'node_modules/util-ex/src/fn1.js': `
      export function fn1() { return 1 }
      export default fn1
    `,
    'node_modules/util-ex/src/fn2.js': `
      export function fn2() { return 2 }
      export default fn2
    `,
    'node_modules/util-ex/package.json': `{
      "main": "./lib/index.js",
      "type": "commonjs"
    }`,
    'node.js': `
      import { fn1, fn2 } from 'util-ex'
      if (fn1() !== 1) throw 'fail 1'
      if (fn2() !== 2) throw 'fail 2'
    `,
    'package.json': `{
      "type": "module"
    }`,
  }),

  // ESM => IIFE
  test(['in.js', '--outfile=node.js', '--format=iife'], {
    'in.js': `
      import {exists} from 'fs'
      if (!exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=iife'], {
    'in.js': `
      import fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=iife'], {
    'in.js': `
      import * as fs from 'fs'
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=iife', '--global-name=test'], {
    'in.js': `
      let fn = async () => {
        let fs = await import('fs')
        if (!fs.exists) throw 'fail'
      }
      export {fn as async}
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const out = new Function('require', code + '; return test')(require)
      exports.async = out.async
    `,
  }, { async: true }),
  test(['in.js', '--outfile=out.js', '--format=iife', '--global-name=test'], {
    'in.js': `
      export let foo = 'abc'
      export default function() {
        return 123
      }
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const out = new Function(code + '; return test')()
      if (out.foo !== 'abc' || out.default() !== 123) throw 'fail'
    `,
  }),

  // JSON
  test(['in.json', '--outfile=out.js', '--format=esm'], {
    'in.json': `{"foo": 123}`,
    'node.js': `
      import def from './out.js'
      import {foo} from './out.js'
      if (foo !== 123 || def.foo !== 123) throw 'fail'
    `,
  }),
  test(['in.json', '--outfile=out.js', '--format=cjs'], {
    'in.json': `{"foo": 123}`,
    'node.js': `
      const out = require('./out.js')
      if (out.foo !== 123) throw 'fail'
    `,
  }),
  test(['in.json', '--outfile=out.js', '--format=iife', '--global-name=test'], {
    'in.json': `{"foo": 123}`,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const out = new Function(code + '; return test')()
      if (out.foo !== 123) throw 'fail'
    `,
  }),

  // CJS => CJS
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      const {exists} = require('fs')
      if (!exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=cjs'], {
    'in.js': `
      const fs = require('fs')
      if (!fs.exists) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `
      module.exports = 123
    `,
    'node.js': `
      const out = require('./out.js')
      if (out !== 123) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=cjs'], {
    'in.js': `
      exports.foo = 123
    `,
    'node.js': `
      const out = require('./out.js')
      if (out.foo !== 123) throw 'fail'
    `,
  }),

  // CJS => IIFE
  test(['in.js', '--outfile=out.js', '--format=iife'], {
    'in.js': `
      const {exists} = require('fs')
      if (!exists) throw 'fail'
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      new Function('require', code)(require)
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=iife'], {
    'in.js': `
      const fs = require('fs')
      if (!fs.exists) throw 'fail'
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      new Function('require', code)(require)
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=iife', '--global-name=test'], {
    'in.js': `
      module.exports = 123
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const out = new Function(code + '; return test')()
      if (out !== 123) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=iife', '--global-name=test'], {
    'in.js': `
      exports.foo = 123
    `,
    'node.js': `
      const code = require('fs').readFileSync(__dirname + '/out.js', 'utf8')
      const out = new Function(code + '; return test')()
      if (out.foo !== 123) throw 'fail'
    `,
  }),

  // CJS => ESM
  test(['in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `
      const {exists} = require('fs')
      if (!exists) throw 'fail'
    `,
    'node.js': `
      let fn = async () => {
        let error
        await import('./out.js').catch(x => error = x)
        if (!error || !error.message.includes('require is not defined')) throw 'fail'
      }
      export {fn as async}
    `,
  }, {
    async: true,
    expectedStderr: `▲ [WARNING] Converting "require" to "esm" is currently not supported [unsupported-require-call]

    in.js:2:23:
      2 │       const {exists} = require('fs')
        ╵                        ~~~~~~~

`,
  }),
  test(['in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `
      const fs = require('fs')
      if (!fs.exists) throw 'fail'
    `,
    'node.js': `
      let fn = async () => {
        let error
        await import('./out.js').catch(x => error = x)
        if (!error || !error.message.includes('require is not defined')) throw 'fail'
      }
      export {fn as async}
    `,
  }, {
    async: true,
    expectedStderr: `▲ [WARNING] Converting "require" to "esm" is currently not supported [unsupported-require-call]

    in.js:2:17:
      2 │       const fs = require('fs')
        ╵                  ~~~~~~~

`,
  }),
  test(['in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `
      module.exports = 123
    `,
    'node.js': `
      import out from './out.js'
      if (out !== 123) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=out.js', '--format=esm'], {
    'in.js': `
      exports.foo = 123
    `,
    'node.js': `
      import out from './out.js'
      if (out.foo !== 123) throw 'fail'
    `,
  }),
)

// This shouldn't cause a syntax error
// https://github.com/evanw/esbuild/issues/1082
tests.push(
  test(['in.js', '--outfile=node.js', '--minify', '--bundle'], {
    'in.js': `
      return import('./in.js')
    `,
  }),
)

// Check for file names of wrapped modules in non-minified stack traces (for profiling)
// Context: https://github.com/evanw/esbuild/pull/1236
tests.push(
  test(['entry.js', '--outfile=node.js', '--bundle'], {
    'entry.js': `
      try {
        require('./src/a')
      } catch (e) {
        if (!e.stack.includes('at __require') || !e.stack.includes('at src/a.ts') || !e.stack.includes('at src/b.ts'))
          throw new Error(e.stack)
      }
    `,
    'src/a.ts': `require('./b')`,
    'src/b.ts': `throw new Error('fail')`,
  }),
  test(['entry.js', '--outfile=node.js', '--bundle', '--minify-identifiers'], {
    'entry.js': `
      try {
        require('./src/a')
      } catch (e) {
        if (e.stack.includes('at __require') || e.stack.includes('at src/a.ts') || e.stack.includes('at src/b.ts'))
          throw new Error(e.stack)
      }
    `,
    'src/a.ts': `require('./b')`,
    'src/b.ts': `throw new Error('fail')`,
  }),
  test(['entry.js', '--outfile=node.js', '--bundle'], {
    'entry.js': `
      try {
        require('./src/a')
      } catch (e) {
        if (!e.stack.includes('at __init') || !e.stack.includes('at src/a.ts') || !e.stack.includes('at src/b.ts'))
          throw new Error(e.stack)
      }
    `,
    'src/a.ts': `export let esm = true; require('./b')`,
    'src/b.ts': `export let esm = true; throw new Error('fail')`,
  }),
  test(['entry.js', '--outfile=node.js', '--bundle', '--minify-identifiers'], {
    'entry.js': `
      try {
        require('./src/a')
      } catch (e) {
        if (e.stack.includes('at __init') || e.stack.includes('at src/a.ts') || e.stack.includes('at src/b.ts'))
          throw new Error(e.stack)
      }
    `,
    'src/a.ts': `export let esm = true; require('./b')`,
    'src/b.ts': `export let esm = true; throw new Error('fail')`,
  }),
)

// This shouldn't crash
// https://github.com/evanw/esbuild/issues/1080
tests.push(
  // Various CommonJS cases
  test(['in.js', '--outfile=node.js', '--define:foo={"x":0}', '--bundle'], {
    'in.js': `if (foo.x !== 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo.bar={"x":0}', '--bundle'], {
    'in.js': `if (foo.bar.x !== 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module={"x":0}', '--bundle'], {
    'in.js': `if (module.x !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module.foo={"x":0}', '--bundle'], {
    'in.js': `if (module.foo !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports={"x":0}', '--bundle'], {
    'in.js': `if (exports.x !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports.foo={"x":0}', '--bundle'], {
    'in.js': `if (exports.foo !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo=["x"]', '--bundle'], {
    'in.js': `if (foo[0] !== 'x') throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo.bar=["x"]', '--bundle'], {
    'in.js': `if (foo.bar[0] !== 'x') throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module=["x"]', '--bundle'], {
    'in.js': `if (module[0] !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module.foo=["x"]', '--bundle'], {
    'in.js': `if (module.foo !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports=["x"]', '--bundle'], {
    'in.js': `if (exports[0] !== void 0) throw 'fail'; return`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports.foo=["x"]', '--bundle'], {
    'in.js': `if (exports.foo !== void 0) throw 'fail'; return`,
  }),

  // Various ESM cases
  test(['in.js', '--outfile=node.js', '--bundle', '--log-level=error'], {
    'in.js': `import "pkg"`,
    'node_modules/pkg/package.json': `{ "sideEffects": false }`,
    'node_modules/pkg/index.js': `module.exports = null; throw 'fail'`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo={"x":0}', '--bundle'], {
    'in.js': `if (foo.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo.bar={"x":0}', '--bundle'], {
    'in.js': `if (foo.bar.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module={"x":0}', '--bundle'], {
    'in.js': `if (module.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module.foo={"x":0}', '--bundle'], {
    'in.js': `if (module.foo.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports={"x":0}', '--bundle'], {
    'in.js': `if (exports.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports.foo={"x":0}', '--bundle'], {
    'in.js': `if (exports.foo.x !== 0) throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo=["x"]', '--bundle'], {
    'in.js': `if (foo[0] !== 'x') throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:foo.bar=["x"]', '--bundle'], {
    'in.js': `if (foo.bar[0] !== 'x') throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module=["x"]', '--bundle'], {
    'in.js': `if (module[0] !== 'x') throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:module.foo=["x"]', '--bundle'], {
    'in.js': `if (module.foo[0] !== 'x') throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports=["x"]', '--bundle'], {
    'in.js': `if (exports[0] !== 'x') throw 'fail'; export {}`,
  }),
  test(['in.js', '--outfile=node.js', '--define:exports.foo=["x"]', '--bundle'], {
    'in.js': `if (exports.foo[0] !== 'x') throw 'fail'; export {}`,
  }),
)

// Check for "sideEffects: false" wrapper handling
// https://github.com/evanw/esbuild/issues/1088
for (const pkgJSON of [`{}`, `{"sideEffects": false}`]) {
  for (const entry of [
    `export let async = async () => { if (require("pkg").foo() !== 123) throw 'fail' }`,
    `export let async = () => import("pkg").then(x => { if (x.foo() !== 123) throw 'fail' })`,
  ]) {
    for (const index of [`export {foo} from "./foo.js"`, `import {foo} from "./foo.js"; export {foo}`]) {
      for (const foo of [`export let foo = () => 123`, `exports.foo = () => 123`]) {
        tests.push(test(['in.js', '--outfile=node.js', '--bundle'], {
          'in.js': entry,
          'node_modules/pkg/package.json': pkgJSON,
          'node_modules/pkg/index.js': index,
          'node_modules/pkg/foo.js': foo,
        }, { async: true }))
      }
    }
  }
  for (const entry of [
    `export let async = async () => { try { require("pkg") } catch (e) { return } throw 'fail' }`,
    `export let async = () => import("pkg").then(x => { throw 'fail' }, () => {})`,
  ]) {
    tests.push(test(['in.js', '--outfile=node.js', '--bundle'], {
      'in.js': entry,
      'node_modules/pkg/package.json': pkgJSON,
      'node_modules/pkg/index.js': `
        export {foo} from './b.js'
      `,
      'node_modules/pkg/b.js': `
        export {foo} from './c.js'
        throw 'stop'
      `,
      'node_modules/pkg/c.js': `
        export let foo = () => 123
      `,
    }, { async: true }))
  }
}

// Tests for "arguments" scope issues
tests.push(
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      function arguments() {
        return arguments.length
      }
      if (arguments(0, 1) !== 2) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      let value = (function arguments() {
        return arguments.length
      })(0, 1)
      if (value !== 2) throw 'fail'
    `,
  }),
)

// Tests for catch scope issues
tests.push(
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var x = 0, y = []
      try {
        throw 1
      } catch (x) {
        y.push(x)
        var x = 2
        y.push(x)
      }
      y.push(x)
      if (y + '' !== '1,2,0') throw 'fail: ' + y
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var x = 0, y = []
      try {
        throw 1
      } catch (x) {
        y.push(x)
        var x = 2
        y.push(x)
      }
      finally { x = 3 }
      y.push(x)
      if (y + '' !== '1,2,3') throw 'fail: ' + y
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var y = []
      try {
        throw 1
      } catch (x) {
        y.push(x)
        var x = 2
        y.push(x)
      }
      y.push(x)
      if (y + '' !== '1,2,') throw 'fail: ' + y
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var y = []
      try {
        throw 1
      } catch (x) {
        y.push(x)
        x = 2
        y.push(x)
      }
      y.push(typeof x)
      if (y + '' !== '1,2,undefined') throw 'fail: ' + y
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var y = []
      try {
        throw 1
      } catch (x) {
        y.push(x)
        try {
          throw 2
        } catch (x) {
          y.push(x)
          var x = 3
          y.push(x)
        }
        y.push(x)
      }
      y.push(x)
      if (y + '' !== '1,2,3,1,') throw 'fail: ' + y
    `,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    'in.js': `
      var y = []
      try { x; y.push('fail') } catch (e) {}
      try {
        throw 1
      } catch (x) {
        y.push(x)
      }
      try { x; y.push('fail') } catch (e) {}
      if (y + '' !== '1') throw 'fail: ' + y
    `,
  }),

  // https://github.com/evanw/esbuild/issues/1812
  test(['in.js', '--outfile=node.js'], {
    'in.js': `
      let a = 1;
      let def = "PASS2";
      try {
        throw [ "FAIL2", "PASS1" ];
      } catch ({ [a]: b, 3: d = def }) {
        let a = 0, def = "FAIL3";
        if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
      }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      let a = 1;
      let def = "PASS2";
      try {
        throw [ "FAIL2", "PASS1" ];
      } catch ({ [a]: b, 3: d = def }) {
        let a = 0, def = "FAIL3";
        if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
      }
    `,
  }),
  test(['in.js', '--outfile=node.js'], {
    'in.js': `
      try {
        throw { x: 'z', z: 123 }
      } catch ({ x, [x]: y }) {
        if (y !== 123) throw 'fail'
      }
    `,
  }),
)

// Test cyclic import issues (shouldn't crash on evaluation)
tests.push(
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import * as foo from './foo'; export default {foo, bar: require('./bar')}`,
    'foo.js': `import * as a from './entry'; import * as b from './bar'; export default {a, b}`,
    'bar.js': `const entry = require('./entry'); export function foo() { return entry }`,
  }),
)

// Test import attributes
tests.push(
  test(['--bundle', 'entry.js', '--outfile=node.js', '--format=esm'], {
    'entry.js': `
      import * as foo from './package.json' with { type: 'json' }
      if (foo.default.type !== 'module' || 'type' in foo) throw 'fail: static'

      const bar = await import('./package.json', { with: { type: 'json' } })
      if (bar.default.type !== 'module' || 'type' in bar) throw 'fail: dynamic'
    `,
    'package.json': `{ "type": "module" }`,
  }),
)

// Test directive preservation
tests.push(
  // The "__pow" symbol must not be hoisted above "use strict"
  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      'use strict'
      function f(a) {
        a **= 2
        return [a, arguments[0]]
      }
      let pair = f(2)
      if (pair[0] !== 4 || pair[1] !== 2) throw 'fail'
    `,
  }),
  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      //! @legal comment
      'use strict'
      function f(a) {
        a **= 2
        return [a, arguments[0]]
      }
      let pair = f(2)
      if (pair[0] !== 4 || pair[1] !== 2) throw 'fail'
    `,
  }),
)

// Test comments inside expressions
tests.push(
  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      let foo;
      (
        /* x */
        {
          y() {
            foo = this.y.name
          }
        }
      ).y();
      if (foo !== 'y') throw 'fail'
    `,
  }),

  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      let foo;
      (
        /* x */
        function y() {
          foo = y.name
        }
      )();
      if (foo !== 'y') throw 'fail'
    `,
  }),

  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      let foo;
      (
        /* x */
        class y {
          static z() {
            foo = y.name
          }
        }
      ).z();
      if (foo !== 'y') throw 'fail'
    `,
  }),

  test(['entry.js', '--outfile=node.js', '--target=es6'], {
    'entry.js': `
      let foo;
      (/* @__PURE__ */ (() => foo = 'y')());
      if (foo !== 'y') throw 'fail'
    `,
  }),
)

// Test certain minification transformations
for (const minify of [[], ['--minify-syntax']]) {
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `let fn = (x) => { if (x && y) return; function y() {} throw 'fail' }; fn(fn)`,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `let fn = (a, b) => { if (a && (x = () => y) && b) return; var x; let y = 123; if (x() !== 123) throw 'fail' }; fn(fn)`,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        var x = { [-0]: 1 }; if (x['0'] !== 1 || x['-0'] !== void 0) throw 'fail: -0'
        var x = { [-1]: 1 }; if (x['-1'] !== 1) throw 'fail: -1'
        var x = { [NaN]: 1 }; if (x['NaN'] !== 1) throw 'fail: NaN'
        var x = { [Infinity]: 1 }; if (x['Infinity'] !== 1) throw 'fail: Infinity'
        var x = { [-Infinity]: 1 }; if (x['-Infinity'] !== 1) throw 'fail: -Infinity'
        var x = { [1e5]: 1 }; if (x['100000'] !== 1) throw 'fail: 1e5'
        var x = { [-1e5]: 1 }; if (x['-100000'] !== 1) throw 'fail: -1e5'
        var x = { [1e100]: 1 }; if (x['1e+100'] !== 1) throw 'fail: 1e100'
        var x = { [-1e100]: 1 }; if (x['-1e+100'] !== 1) throw 'fail: -1e100'
        var x = { [0xFFFF_FFFF_FFFF]: 1 }; if (x['281474976710655'] !== 1) throw 'fail: 0xFFFF_FFFF_FFFF'
        var x = { [-0xFFFF_FFFF_FFFF]: 1 }; if (x['-281474976710655'] !== 1) throw 'fail: -0xFFFF_FFFF_FFFF'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        var x = class { static [-0] = 1 }; if (x['0'] !== 1 || x['-0'] !== void 0) throw 'fail: -0'
        var x = class { static [-1] = 1 }; if (x['-1'] !== 1) throw 'fail: -1'
        var x = class { static [NaN] = 1 }; if (x['NaN'] !== 1) throw 'fail: NaN'
        var x = class { static [Infinity] = 1 }; if (x['Infinity'] !== 1) throw 'fail: Infinity'
        var x = class { static [-Infinity] = 1 }; if (x['-Infinity'] !== 1) throw 'fail: -Infinity'
        var x = class { static [1e5] = 1 }; if (x['100000'] !== 1) throw 'fail: 1e5'
        var x = class { static [-1e5] = 1 }; if (x['-100000'] !== 1) throw 'fail: -1e5'
        var x = class { static [1e100] = 1 }; if (x['1e+100'] !== 1) throw 'fail: 1e100'
        var x = class { static [-1e100] = 1 }; if (x['-1e+100'] !== 1) throw 'fail: -1e100'
        var x = class { static [0xFFFF_FFFF_FFFF] = 1 }; if (x['281474976710655'] !== 1) throw 'fail: 0xFFFF_FFFF_FFFF'
        var x = class { static [-0xFFFF_FFFF_FFFF] = 1 }; if (x['-281474976710655'] !== 1) throw 'fail: -0xFFFF_FFFF_FFFF'
      `,
    }),

    // See: https://github.com/evanw/esbuild/issues/3195
    test(['in.js', '--outfile=node.js', '--keep-names'].concat(minify), {
      'in.js': `
        const log = [];
        const sideEffect = x => log.push(x);
        (() => {
          function f() {}
          sideEffect(1, f());
        })();
        (() => {
          function g() {}
          debugger;
          sideEffect(2, g());
        })();
        if (log + '' !== '1,2') throw 'fail: ' + log;
      `,
    }),
  )

  // Check property access simplification
  for (const access of [['.a'], ['["a"]']]) {
    tests.push(
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({a: 1}${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({a: {a: 1}}${access}${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({a: {b: 1}}${access}.b !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({b: {a: 1}}.b${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js', '--log-level=error'].concat(minify), {
        'in.js': `if ({a: 1, a: 2}${access} !== 2) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js', '--log-level=error'].concat(minify), {
        'in.js': `if ({a: 1, [String.fromCharCode(97)]: 2}${access} !== 2) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `let a = {a: 1}; if ({...a}${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ get a() { return 1 } }${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ __proto__: {a: 1} }${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ __proto__: null, a: 1 }${access} !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ __proto__: null, b: 1 }${access} !== void 0) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ __proto__: null }.__proto__ !== void 0) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ ['__proto__']: null }.__proto__ !== null) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `let x = 100; if ({ b: ++x, a: 1 }${access} !== 1 || x !== 101) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ a: function() { return this.b }, b: 1 }${access}() !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({ a: function() { return this.b }, b: 1 }${access}\`\` !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if (({a: 2}${access} = 1) !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if ({a: 1}${access}++ !== 1) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `if (++{a: 1}${access} !== 2) throw 'fail'`,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `
          Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1})
          if ({}.MIN_OBJ_LIT !== 1) throw 'fail'
        `,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `
          let x = false
          function y() { x = true }
          if ({ b: y(), a: 1 }${access} !== 1 || !x) throw 'fail'
        `,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `
          try { new ({ a() {} }${access}); throw 'fail' }
          catch (e) { if (e === 'fail') throw e }
        `,
      }),
      test(['in.js', '--outfile=node.js'].concat(minify), {
        'in.js': `
          let x = 1;
          ({ set a(y) { x = y } }${access} = 2);
          if (x !== 2) throw 'fail'
        `,
      }),
    )
  }

  // Check try/catch simplification
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        try {
          try {
            throw 0
          } finally {
            var x = 1
          }
        } catch {
        }
        if (x !== 1) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        let y
        try {
          throw 1
        } catch (x) {
          eval('y = x')
        }
        if (y !== 1) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        try {
          throw 0
        } catch (x) {
          var x = 1
        }
        if (x !== void 0) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        let works
        try {
          throw { get a() { works = true } }
        } catch ({ a }) {}
        if (!works) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        let works
        try {
          throw { *[Symbol.iterator]() { works = true } }
        } catch ([x]) {
        }
        if (!works) throw 'fail'
      `,
    }),
  )

  // Check variable initializer inlining
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        function foo() {
          if (this !== globalThis) throw 'fail'
        }
        function main() {
          let obj = { bar: foo };
          let fn = obj.bar;
          (0, fn)();
        }
        main()
      `,
    }),
  );

  // Check global constructor behavior
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        const check = (before, after) => {
          if (Boolean(before) !== after) throw 'fail: Boolean(' + before + ') should not be ' + Boolean(before)
          if (new Boolean(before) === after) throw 'fail: new Boolean(' + before + ') should not be ' + new Boolean(before)
          if (new Boolean(before).valueOf() !== after) throw 'fail: new Boolean(' + before + ').valueOf() should not be ' + new Boolean(before).valueOf()
        }
        check(false, false); check(0, false); check(0n, false)
        check(true, true); check(1, true); check(1n, true)
        check(null, false); check(undefined, false)
        check('', false); check('x', true)

        const checkSpread = (before, after) => {
          if (Boolean(...before) !== after) throw 'fail: Boolean(...' + before + ') should not be ' + Boolean(...before)
          if (new Boolean(...before) === after) throw 'fail: new Boolean(...' + before + ') should not be ' + new Boolean(...before)
          if (new Boolean(...before).valueOf() !== after) throw 'fail: new Boolean(...' + before + ').valueOf() should not be ' + new Boolean(...before).valueOf()
        }
        checkSpread([0], false); check([1], true)
        checkSpread([], false)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        class ToPrimitive { [Symbol.toPrimitive]() { return '100.001' } }
        const someObject = { toString: () => 123, valueOf: () => 321 }

        const check = (before, after) => {
          if (Number(before) !== after) throw 'fail: Number(' + before + ') should not be ' + Number(before)
          if (new Number(before) === after) throw 'fail: new Number(' + before + ') should not be ' + new Number(before)
          if (new Number(before).valueOf() !== after) throw 'fail: new Number(' + before + ').valueOf() should not be ' + new Number(before).valueOf()
        }
        check(-1.23, -1.23)
        check('-1.23', -1.23)
        check(123n, 123)
        check(null, 0)
        check(false, 0)
        check(true, 1)
        check(someObject, 321)
        check(new ToPrimitive(), 100.001)

        const checkSpread = (before, after) => {
          if (Number(...before) !== after) throw 'fail: Number(...' + before + ') should not be ' + Number(...before)
          if (new Number(...before) === after) throw 'fail: new Number(...' + before + ') should not be ' + new Number(...before)
          if (new Number(...before).valueOf() !== after) throw 'fail: new Number(...' + before + ').valueOf() should not be ' + new Number(...before).valueOf()
        }
        checkSpread(['123'], 123)
        checkSpread([], 0)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        class ToPrimitive { [Symbol.toPrimitive]() { return 100.001 } }
        const someObject = { toString: () => 123, valueOf: () => 321 }

        const check = (before, after) => {
          if (String(before) !== after) throw 'fail: String(' + before + ') should not be ' + String(before)
          if (new String(before) === after) throw 'fail: new String(' + before + ') should not be ' + new String(before)
          if (new String(before).valueOf() !== after) throw 'fail: new String(' + before + ').valueOf() should not be ' + new String(before).valueOf()
        }
        check('', '')
        check('x', 'x')
        check(null, 'null')
        check(false, 'false')
        check(1.23, '1.23')
        check(-123n, '-123')
        check(someObject, '123')
        check(new ToPrimitive(), '100.001')

        const checkSpread = (before, after) => {
          if (String(...before) !== after) throw 'fail: String(...' + before + ') should not be ' + String(...before)
          if (new String(...before) === after) throw 'fail: new String(...' + before + ') should not be ' + new String(...before)
          if (new String(...before).valueOf() !== after) throw 'fail: new String(...' + before + ').valueOf() should not be ' + new String(...before).valueOf()
        }
        checkSpread([123], '123')
        checkSpread([], '')

        const checkAndExpectNewToThrow = (before, after) => {
          if (String(before) !== after) throw 'fail: String(...) should not be ' + String(before)
          try {
            new String(before)
          } catch (e) {
            return
          }
          throw 'fail: new String(...) should not succeed'
        }
        checkAndExpectNewToThrow(Symbol('abc'), 'Symbol(abc)')
      `,
    }),
  );

  // https://github.com/evanw/esbuild/issues/3125
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(minify), {
      'in.js': `
        let y
        {
          // There was a bug where this incorrectly turned into "y = (() => x)()"
          const f = () => x;
          const x = 0;
          y = f()
        }
        if (y !== 0) throw 'fail'
      `,
    }),
  )

  // https://github.com/evanw/esbuild/issues/3700
  tests.push(
    test(['in.js', '--bundle', '--outfile=node.js'].concat(minify), {
      'in.js': `
        import imported from './data.json'
        const native = JSON.parse(\`{
          "hello": "world",
          "__proto__": {
            "sky": "universe"
          }
        }\`)
        const literal1 = {
          "hello": "world",
          "__proto__": {
            "sky": "universe"
          }
        }
        const literal2 = {
          "hello": "world",
          ["__proto__"]: {
            "sky": "universe"
          }
        }
        if (Object.getPrototypeOf(native)?.sky) throw 'fail: native'
        if (!Object.getPrototypeOf(literal1)?.sky) throw 'fail: literal1'
        if (Object.getPrototypeOf(literal2)?.sky) throw 'fail: literal2'
        if (Object.getPrototypeOf(imported)?.sky) throw 'fail: imported'
      `,
      'data.json': `{
        "hello": "world",
        "__proto__": {
          "sky": "universe"
        }
      }`,
    }),
  )
}

// Test minification of top-level symbols
tests.push(
  test(['in.js', '--outfile=node.js', '--minify'], {
    // Top-level names should not be minified
    'in.js': `function foo() {} if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify'], {
    // Nested names should be minified
    'in.js': `(() => { function foo() {} if (foo.name === 'foo') throw 'fail: ' + foo.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--target=es6'], {
    // Importing the "__pow()" runtime function should not affect top-level name minification
    'in.js': `let _8 = 2 ** 3; function foo8() {} if (foo8.name !== 'foo' + _8) throw 'fail: ' + foo8.name`,
  }),
)

// Test name preservation
for (let flags of [[], ['--minify', '--keep-names']]) {
  tests.push(
    // Arrow functions
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn = () => {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; fn = () => {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let [fn = () => {}] = []; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; [fn = () => {}] = []; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {fn = () => {}} = {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {prop: fn = () => {}} = {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; ({fn = () => {}} = {}); if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; ({prop: fn = () => {}} = {}); if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj.fn = () => {}; if (obj.fn.name !== '') throw 'fail: ' + obj.fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj['fn'] = () => {}; if (obj.fn.name !== '') throw 'fail: ' + obj.fn.name })()`,
    }),

    // Functions
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { function foo() {} if (foo.name !== 'foo') throw 'fail: ' + foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn = function foo() {}; if (fn.name !== 'foo') throw 'fail' })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn = function() {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; fn = function() {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let [fn = function() {}] = []; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; [fn = function() {}] = []; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {fn = function() {}} = {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {prop: fn = function() {}} = {}; if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; ({fn = function() {}} = {}); if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let fn; ({prop: fn = function() {}} = {}); if (fn.name !== 'fn') throw 'fail: ' + fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj.fn = function() {}; if (obj.fn.name !== '') throw 'fail: ' + obj.fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj['fn'] = function() {}; if (obj.fn.name !== '') throw 'fail: ' + obj.fn.name })()`,
    }),

    // Classes
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class foo {} if (foo.name !== 'foo') throw 'fail: ' + foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls = class foo {}; if (cls.name !== 'foo') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls = class {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls; cls = class {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let [cls = class {}] = []; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls; [cls = class {}] = []; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {cls = class {}} = {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let {prop: cls = class {}} = {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls; ({cls = class {}} = {}); if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let cls; ({prop: cls = class {}} = {}); if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj.cls = class {}; if (obj.cls.name !== '') throw 'fail: ' + obj.cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = {}; obj['cls'] = class {}; if (obj.cls.name !== '') throw 'fail: ' + obj.cls.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static foo } if (Foo.name !== 'Foo') throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static name = 123 } if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static name() { return 123 } } if (Foo.name() !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static get name() { return 123 } } if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static ['name'] = 123 } if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class Bar { static foo }; if (Foo.name !== 'Bar') throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class Bar { static name = 123 }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class Bar { static name() { return 123 } }; if (Foo.name() !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class Bar { static get name() { return 123 } }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class Bar { static ['name'] = 123 }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static foo }; if (Foo.name !== 'Foo') throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static name = 123 }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static name() { return 123 } }; if (Foo.name() !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static get name() { return 123 } }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static ['name'] = 123 }; if (Foo.name !== 123) throw 'fail: ' + Foo.name })()`,
    }),

    // Methods
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = { foo() {} }; if (obj.foo.name !== 'foo') throw 'fail: ' + obj.foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = { foo: () => {} }; if (obj.foo.name !== 'foo') throw 'fail: ' + obj.foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { foo() {} }; if (new Foo().foo.name !== 'foo') throw 'fail: ' + new Foo().foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { class Foo { static foo() {} }; if (Foo.foo.name !== 'foo') throw 'fail: ' + Foo.foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { foo() {} }; if (new Foo().foo.name !== 'foo') throw 'fail: ' + new Foo().foo.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let Foo = class { static foo() {} }; if (Foo.foo.name !== 'foo') throw 'fail: ' + Foo.foo.name })()`,
    }),

    // See: https://github.com/evanw/esbuild/issues/3199
    test(['in.ts', '--outfile=node.js', '--target=es6'].concat(flags), {
      'in.ts': `
        namespace foo { export class Foo {} }
        if (foo.Foo.name !== 'Foo') throw 'fail: ' + foo.Foo.name
      `,
    }),
    test(['in.ts', '--outfile=node.js', '--target=esnext'].concat(flags), {
      'in.ts': `
        namespace foo { export class Foo {} }
        if (foo.Foo.name !== 'Foo') throw 'fail: ' + foo.Foo.name
      `,
    }),

    // See: https://github.com/evanw/esbuild/issues/3756
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = { fn() {} }; if (obj.fn.name !== 'fn') throw 'fail: ' + obj.fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = { *fn() {} }; if (obj.fn.name !== 'fn') throw 'fail: ' + obj.fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => { let obj = { async fn() {} }; if (obj.fn.name !== 'fn') throw 'fail: ' + obj.fn.name })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => {
        let obj = { get fn() {} }, { get } = Object.getOwnPropertyDescriptor(obj, 'fn')
        if (get.name !== 'get fn') throw 'fail: ' + get.name
      })()`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `(() => {
        let obj = { set fn(_) {} }, { set } = Object.getOwnPropertyDescriptor(obj, 'fn')
        if (set.name !== 'set fn') throw 'fail: ' + set.name
      })()`,
    }),
  )
}
tests.push(
  // Arrow functions
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default () => {}`,
  }),

  // Functions
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
    'other.js': `export default function foo() {}`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default function() {}`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default (function() {})`,
  }),

  // Classes
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
    'other.js': `export default class foo {}`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default class {}`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default (class {})`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
    'in.js': `export default class foo {}`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'in.js': `export default class {}`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'in.js': `export default (class {})`,
  }),

  // Class fields
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { class Foo { foo = () => {} } if (new Foo().foo.name !== 'foo') throw 'fail: ' + new Foo().foo.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { class Foo { static foo = () => {} } if (Foo.foo.name !== 'foo') throw 'fail: ' + Foo.foo.name })()`,
  }),

  // Private methods
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { class foo { a() { return this.#b } #b() {} } if (foo.name !== 'foo') throw 'fail: ' + foo.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls = class foo { a() { return this.#b } #b() {} }; if (cls.name !== 'foo') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls = class { a() { return this.#b } #b() {} }; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls; cls = class { a() { return this.#b } #b() {} }; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let [cls = class { a() { return this.#b } #b() {} }] = []; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls; [cls = class { a() { return this.#b } #b() {} }] = []; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let {cls = class { a() { return this.#b } #b() {} }} = {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let {prop: cls = class { a() { return this.#b } #b() {} }} = {}; if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls; ({cls = class { a() { return this.#b } #b() {} }} = {}); if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `(() => { let cls; ({prop: cls = class { a() { return this.#b } #b() {} }} = {}); if (cls.name !== 'cls') throw 'fail: ' + cls.name })()`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `import foo from './other'; if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
    'other.js': `export default class foo { a() { return this.#b } #b() {} }`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default class { a() { return this.#b } #b() {} }`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--bundle', '--target=es6'], {
    'in.js': `import foo from './other'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'other.js': `export default (class { a() { return this.#b } #b() {} })`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'foo') throw 'fail: ' + foo.name`,
    'in.js': `export default class foo { a() { return this.#b } #b() {} }`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'in.js': `export default class { a() { return this.#b } #b() {} }`,
  }),
  test(['in.js', '--outfile=out.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'node.js': `import foo from './out.js'; if (foo.name !== 'default') throw 'fail: ' + foo.name`,
    'in.js': `export default (class { a() { return this.#b } #b() {} })`,
  }),

  // Private fields
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { foo = this.#foo; #foo() {} } if (new Foo().foo.name !== '#foo') throw 'fail: ' + new Foo().foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { static foo = this.#foo; static #foo() {} } if (Foo.foo.name !== '#foo') throw 'fail: ' + Foo.foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { #foo = function() {}; foo = this.#foo } if (new Foo().foo.name !== '#foo') throw 'fail: ' + new Foo().foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { static #foo = function() {}; static foo = this.#foo } if (Foo.foo.name !== '#foo') throw 'fail: ' + Foo.foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { #foo = () => {}; foo = this.#foo } if (new Foo().foo.name !== '#foo') throw 'fail: ' + new Foo().foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { static #foo = () => {}; static foo = this.#foo } if (Foo.foo.name !== '#foo') throw 'fail: ' + Foo.foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { #foo = class {}; foo = this.#foo } if (new Foo().foo.name !== '#foo') throw 'fail: ' + new Foo().foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { static #foo = class {}; static foo = this.#foo } if (Foo.foo.name !== '#foo') throw 'fail: ' + Foo.foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { #foo = class { #bar = 123; bar = this.#bar }; foo = this.#foo } if (new Foo().foo.name !== '#foo') throw 'fail: ' + new Foo().foo.name`,
  }),
  test(['in.js', '--outfile=node.js', '--minify', '--keep-names', '--format=esm', '--target=es6'], {
    'in.js': `class Foo { static #foo = class { #bar = 123; bar = this.#bar }; static foo = this.#foo } if (Foo.foo.name !== '#foo') throw 'fail: ' + Foo.foo.name`,
  }),

  // https://github.com/evanw/esbuild/issues/2149
  test(['in.js', '--outfile=node.js', '--target=es6', '--keep-names'], {
    'in.js': `
      class Foo {
        static get #foo() { return Foo.name }
        static get foo() { return this.#foo }
      }
      let Bar = Foo
      if (Foo.name !== 'Foo') throw 'fail: ' + Foo.name
      if (Bar.foo !== 'Foo') throw 'fail: ' + Bar.foo
      Foo = { name: 'Bar' }
      if (Foo.name !== 'Bar') throw 'fail: ' + Foo.name
      if (Bar.foo !== 'Foo') throw 'fail: ' + Bar.foo
    `,
  }),
)

// Test minification of mangled properties (class and object) with a keyword before them
tests.push(
  test(['in.js', '--outfile=node.js', '--minify', '--mangle-props=.'], {
    'in.js': `
      class Foo {
        static bar = { get baz() { return 123 } }
      }
      if (Foo.bar.baz !== 123) throw 'fail'
    `,
  }),
)

// Test minification of hoisted top-level symbols declared in nested scopes.
// Previously this code was incorrectly transformed into this, which crashes:
//
//   var c = false;
//   var d = function a() {
//     b[a]();
//   };
//   for (var a = 0, b = [() => c = true]; a < b.length; a++) {
//     d();
//   }
//   export default c;
//
// The problem is that "var i" is declared in a nested scope but hoisted to
// the top-level scope. So it's accidentally assigned a nested scope slot
// even though it's a top-level symbol, not a nested scope symbol.
tests.push(
  test(['in.js', '--outfile=out.js', '--format=esm', '--minify', '--bundle'], {
    'in.js': `
      var worked = false
      var loop = function fn() {
        array[i]();
      };
      for (var i = 0, array = [() => worked = true]; i < array.length; i++) {
        loop();
      }
      export default worked
    `,
    'node.js': `
      import worked from './out.js'
      if (!worked) throw 'fail'
    `,
  }),
)

// Check for an obscure bug with minification, symbol renaming, and sloppy
// nested function declarations: https://github.com/evanw/esbuild/issues/2809.
// Previously esbuild generated the following code:
//
//   let f = 0;
//   for (let l of [1, 2]) {
//     let t = function(o) {
//       return o;
//     };
//     var f = t;
//     f += t(l);
//   }
//   if (f !== 3)
//     throw "fail";
//
// Notice how "f" is declared twice, leading to a syntax error.
for (const flags of [[], ['--minify']]) {
  tests.push(
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `
        let total = 0
        for (let value of [1, 2]) {
          function f(x) { return x }
          total += f(value)
        }
        if (total !== 3) throw 'fail'
      `,
    }),
  )
}

// Test hoisting variables inside for loop initializers outside of lazy ESM
// wrappers. Previously this didn't work due to a bug that considered for
// loop initializers to already be in the top-level scope. For more info
// see: https://github.com/evanw/esbuild/issues/1455.
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      if (require('./nested').foo() !== 10) throw 'fail'
    `,
    'nested.js': `
      for (var i = 0; i < 10; i++) ;
      export function foo() { return i }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      if (require('./nested').foo() !== 'c') throw 'fail'
    `,
    'nested.js': `
      for (var i in {a: 1, b: 2, c: 3}) ;
      export function foo() { return i }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      if (require('./nested').foo() !== 3) throw 'fail'
    `,
    'nested.js': `
      for (var i of [1, 2, 3]) ;
      export function foo() { return i }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--target=es6'], {
    'in.js': `
      if (JSON.stringify(require('./nested').foo()) !== '{"b":2,"c":3}') throw 'fail'
    `,
    'nested.js': `
      for (var {a, ...i} = {a: 1, b: 2, c: 3}; 0; ) ;
      export function foo() { return i }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--target=es6'], {
    'in.js': `
      if (JSON.stringify(require('./nested').foo()) !== '{"0":"c"}') throw 'fail'
    `,
    'nested.js': `
      for (var {a, ...i} in {a: 1, b: 2, c: 3}) ;
      export function foo() { return i }
    `,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--target=es6'], {
    'in.js': `
      if (JSON.stringify(require('./nested').foo()) !== '{"b":2,"c":3}') throw 'fail'
    `,
    'nested.js': `
      for (var {a, ...i} of [{a: 1, b: 2, c: 3}]) ;
      export function foo() { return i }
    `,
  }),
)

// Test tree shaking
tests.push(
  // Keep because used (ES6)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import * as foo from './foo'; if (global.dce0 !== 123 || foo.abc !== 'abc') throw 'fail'`,
    'foo/index.js': `global.dce0 = 123; export const abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": false }`,
  }),

  // Remove because unused (ES6)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import * as foo from './foo'; if (global.dce1 !== void 0) throw 'fail'`,
    'foo/index.js': `global.dce1 = 123; export const abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": false }`,
  }),

  // Keep because side effects (ES6)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import * as foo from './foo'; if (global.dce2 !== 123) throw 'fail'`,
    'foo/index.js': `global.dce2 = 123; export const abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": true }`,
  }),

  // Keep because used (CommonJS)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import foo from './foo'; if (global.dce3 !== 123 || foo.abc !== 'abc') throw 'fail'`,
    'foo/index.js': `global.dce3 = 123; exports.abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": false }`,
  }),

  // Remove because unused (CommonJS)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import foo from './foo'; if (global.dce4 !== void 0) throw 'fail'`,
    'foo/index.js': `global.dce4 = 123; exports.abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": false }`,
  }),

  // Keep because side effects (CommonJS)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import foo from './foo'; if (global.dce5 !== 123) throw 'fail'`,
    'foo/index.js': `global.dce5 = 123; exports.abc = 'abc'`,
    'foo/package.json': `{ "sideEffects": true }`,
  }),

  // Note: Tree shaking this could technically be considered incorrect because
  // the import is for a property whose getter in this case has a side effect.
  // However, this is very unlikely and the vast majority of the time people
  // would likely rather have the code be tree-shaken. This test case enforces
  // the technically incorrect behavior as documentation that this edge case
  // is being ignored.
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import {foo, bar} from './foo'; let unused = foo; if (bar) throw 'expected "foo" to be tree-shaken'`,
    'foo.js': `module.exports = {get foo() { module.exports.bar = 1 }, bar: 0}`,
  }),

  // Test for an implicit and explicit "**/" prefix (see https://github.com/evanw/esbuild/issues/1184)
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
    'foo/dir/x.js': `global.dce6 = 123`,
    'foo/package.json': `{ "main": "dir/x", "sideEffects": ["x.*"] }`,
  }),
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
    'foo/dir/x.js': `global.dce6 = 123`,
    'foo/package.json': `{ "main": "dir/x", "sideEffects": ["**/x.*"] }`,
  }),

  // Test side effect detection for destructuring
  test(['--bundle', 'entry.js', '--outfile=out.js'], {
    'entry.js': `
      let [a] = {}; // This must not be tree-shaken
    `,
    'node.js': `
      pass: {
        try {
          require('./out.js')
        } catch (e) {
          break pass
        }
        throw 'fail'
      }
    `,
  }),
  test(['--bundle', 'entry.js', '--outfile=node.js'], {
    'entry.js': `
      let sideEffect = false
      let { a } = { // This must not be tree-shaken
        get a() {
          sideEffect = true
        },
      };
      if (!sideEffect) throw 'fail'
    `,
  }),

  // Keep because side effects (decorators)
  test(['--bundle', 'entry.ts', '--outfile=node.js', '--target=es2022'], {
    'entry.ts': `
      import { order } from './decorator'
      import './class'
      import './field'
      import './method'
      import './accessor'
      import './parameter'
      import './static-field'
      import './static-method'
      import './static-accessor'
      import './static-parameter'
      if (order + '' !== ',field,method,accessor,parameter,staticField,staticMethod,staticAccessor,staticParameter') throw 'fail: ' + order
    `,
    'decorator.ts': `
      export const order = []
      export const fn = (_, name) => {
        order.push(name)
      }
    `,
    'class.ts': `import { fn } from './decorator'; @fn class Foo {}`,
    'field.ts': `import { fn } from './decorator'; class Foo { @fn field }`,
    'method.ts': `import { fn } from './decorator'; class Foo { @fn method() {} }`,
    'accessor.ts': `import { fn } from './decorator'; class Foo { @fn accessor accessor }`,
    'parameter.ts': `import { fn } from './decorator'; class Foo { parameter(@fn arg) {} }`,
    'static-field.ts': `import { fn } from './decorator'; class Foo { @fn static staticField }`,
    'static-method.ts': `import { fn } from './decorator'; class Foo { @fn static staticMethod() {} }`,
    'static-accessor.ts': `import { fn } from './decorator'; class Foo { @fn static accessor staticAccessor }`,
    'static-parameter.ts': `import { fn } from './decorator'; class Foo { static staticParameter(@fn arg) {} }`,
    'tsconfig.json': `{
      "compilerOptions": {
        "experimentalDecorators": true
      }
    }`,
  }),
)

// Test obscure CommonJS symbol edge cases
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `const ns = require('./foo'); if (ns.foo !== 123 || ns.bar !== 123) throw 'fail'`,
    'foo.js': `var exports, module; module.exports.foo = 123; exports.bar = exports.foo`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `require('./foo'); require('./bar')`,
    'foo.js': `let exports; if (exports !== void 0) throw 'fail'`,
    'bar.js': `let module; if (module !== void 0) throw 'fail'`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `const ns = require('./foo'); if (ns.foo !== void 0 || ns.default.foo !== 123) throw 'fail'`,
    'foo.js': `var exports = {foo: 123}; export default exports`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `const ns = require('./foo'); if (ns !== 123) throw 'fail'`,
    'foo.ts': `let module = 123; export = module`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `require('./foo')`,
    'foo.js': `var require; if (require !== void 0) throw 'fail'`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `require('./foo')`,
    'foo.js': `var require = x => x; if (require('does not exist') !== 'does not exist') throw 'fail'`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `const ns = require('./foo'); if (ns.a !== 123 || ns.b.a !== 123) throw 'fail'`,
    'foo.js': `exports.a = 123; exports.b = this`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--log-level=error'], {
    'in.js': `const ns = require('./foo'); if (ns.a !== 123 || ns.b !== void 0) throw 'fail'`,
    'foo.js': `export let a = 123, b = this`,
  }),
)

// Optional chain lowering tests
for (let [code, expected] of [
  ['array?.map?.(x => -x).filter', '[].filter'],
  ['array?.map?.(x => -x)["filter"]', '[].filter'],
  ['array?.map?.(x => -x).filter(x => x < -1)', '[-2, -3]'],
  ['array?.map?.(x => -x)["filter"](x => x < -1)', '[-2, -3]'],
]) {
  tests.push(
    test(['in.js', '--outfile=node.js', '--target=es6', '--format=esm'], {
      'in.js': `
        import * as assert from 'assert';
        let array = [1, 2, 3];
        let result = ${code};
        assert.deepStrictEqual(result, ${expected});
      `,
    }),
    test(['in.js', '--outfile=node.js', '--target=es6', '--format=esm'], {
      'in.js': `
        import * as assert from 'assert';
        function test(array, result = ${code}) {
          return result
        }
        assert.deepStrictEqual(test([1, 2, 3]), ${expected});
      `,
    }),
  )
}

// Class lowering tests
for (let flags of [['--target=es2022'], ['--target=es6'], ['--bundle', '--target=es2022'], ['--bundle', '--target=es6']]) {
  // Skip running these tests untransformed. I believe V8 actually has a bug
  // here and esbuild is correct, both because SpiderMonkey and JavaScriptCore
  // run this code fine and because the specification says that the left operand
  // of the assignment operator should be evaluated first but V8 appears to be
  // evaluating it later on. The bug with V8 has been filed here for reference:
  // https://bugs.chromium.org/p/v8/issues/detail?id=12352
  if (flags.includes('--target=es6')) {
    tests.push(
      test(['in.js', '--outfile=node.js'].concat(flags), {
        'in.js': `
          let bar
          class Foo {
            get #foo() { bar = new Foo; return this.result }
            set #foo(x) { this.result = x }
            bar() {
              bar = this
              bar.result = 2
              bar.#foo *= 3
            }
          }
          let foo = new Foo()
          foo.bar()
          if (foo === bar || foo.result !== 6 || bar.result !== void 0) throw 'fail'
        `,
      }),
      test(['in.js', '--outfile=node.js'].concat(flags), {
        'in.js': `
          let bar
          class Foo {
            get #foo() { bar = new Foo; return this.result }
            set #foo(x) { this.result = x }
            bar() {
              bar = this
              bar.result = 2
              bar.#foo **= 3
            }
          }
          let foo = new Foo()
          foo.bar()
          if (foo === bar || foo.result !== 8 || bar.result !== void 0) throw 'fail'
        `,
      }),
    )
  }

  // This log message is only an error during bundling
  const assignToConstantMessage = flags.includes('--bundle')
    ? `${errorIcon} [ERROR] Cannot assign to "Foo" because it is a constant`
    : `▲ [WARNING] This assignment will throw because "Foo" is a constant [assign-to-constant]`

  tests.push(
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          foo = 123
          self = this
          #method() {
            if (this.foo !== 123) throw 'fail'
          }
          bar() {
            let that = () => this
            that().#method()
            that().#method?.()
            that()?.#method()
            that()?.#method?.()
            that().self.#method()
            that().self.#method?.()
            that().self?.#method()
            that().self?.#method?.()
            that()?.self.#method()
            that()?.self.#method?.()
            that()?.self?.#method()
            that()?.self?.#method?.()
          }
        }
        new Foo().bar()
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          foo = 123
          get #bar() { return this.foo }
          set #bar(x) { this.foo = x }
          bar() {
            let that = () => this
            that().#bar **= 2
            if (this.foo !== 15129) throw 'fail'
          }
        }
        new Foo().bar()
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let bar
        class Foo {
          get #foo() { bar = new Foo; return this.result }
          set #foo(x) { this.result = x }
          bar() {
            bar = this
            bar.result = 2
            ++bar.#foo
          }
        }
        let foo = new Foo()
        foo.bar()
        if (foo === bar || foo.result !== 3 || bar.result !== void 0) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        function print(x) {
          return typeof x + ':' + x
        }

        function check(before, op, after) {
          let result = new Foo(before)[op]()
          if (result !== after) throw before + ' ' + op + ' should be ' + after + ' but was ' + result
        }

        class Foo {
          #foo
          constructor(foo) { this.#foo = foo }
          preInc = () => print(++this.#foo) + ' ' + print(this.#foo)
          preDec = () => print(--this.#foo) + ' ' + print(this.#foo)
          postInc = () => print(this.#foo++) + ' ' + print(this.#foo)
          postDec = () => print(this.#foo--) + ' ' + print(this.#foo)
        }

        check(123, 'preInc', 'number:124 number:124')
        check(123, 'preDec', 'number:122 number:122')
        check(123, 'postInc', 'number:123 number:124')
        check(123, 'postDec', 'number:123 number:122')

        check('123', 'preInc', 'number:124 number:124')
        check('123', 'preDec', 'number:122 number:122')
        check('123', 'postInc', 'number:123 number:124')
        check('123', 'postDec', 'number:123 number:122')

        check('x', 'preInc', 'number:NaN number:NaN')
        check('x', 'preDec', 'number:NaN number:NaN')
        check('x', 'postInc', 'number:NaN number:NaN')
        check('x', 'postDec', 'number:NaN number:NaN')

        check(BigInt(123), 'preInc', 'bigint:124 bigint:124')
        check(BigInt(123), 'preDec', 'bigint:122 bigint:122')
        check(BigInt(123), 'postInc', 'bigint:123 bigint:124')
        check(BigInt(123), 'postDec', 'bigint:123 bigint:122')
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        function print(x) {
          return typeof x + ':' + x
        }

        function check(before, op, after) {
          let result = new Foo(before)[op]()
          if (result !== after) throw before + ' ' + op + ' should be ' + after + ' but was ' + result
        }

        class Foo {
          get #foo() { return this.__foo }
          set #foo(x) { this.__foo = x }
          constructor(foo) { this.#foo = foo }
          preInc = () => print(++this.#foo) + ' ' + print(this.#foo)
          preDec = () => print(--this.#foo) + ' ' + print(this.#foo)
          postInc = () => print(this.#foo++) + ' ' + print(this.#foo)
          postDec = () => print(this.#foo--) + ' ' + print(this.#foo)
        }

        check(123, 'preInc', 'number:124 number:124')
        check(123, 'preDec', 'number:122 number:122')
        check(123, 'postInc', 'number:123 number:124')
        check(123, 'postDec', 'number:123 number:122')

        check('123', 'preInc', 'number:124 number:124')
        check('123', 'preDec', 'number:122 number:122')
        check('123', 'postInc', 'number:123 number:124')
        check('123', 'postDec', 'number:123 number:122')

        check('x', 'preInc', 'number:NaN number:NaN')
        check('x', 'preDec', 'number:NaN number:NaN')
        check('x', 'postInc', 'number:NaN number:NaN')
        check('x', 'postDec', 'number:NaN number:NaN')

        check(BigInt(123), 'preInc', 'bigint:124 bigint:124')
        check(BigInt(123), 'preDec', 'bigint:122 bigint:122')
        check(BigInt(123), 'postInc', 'bigint:123 bigint:124')
        check(BigInt(123), 'postDec', 'bigint:123 bigint:122')
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        function print(x) {
          return typeof x + ':' + x
        }

        function check(before, op, after) {
          Foo.setup(before)
          let result = Foo[op]()
          if (result !== after) throw before + ' ' + op + ' should be ' + after + ' but was ' + result
        }

        class Foo {
          static #foo
          static setup(x) { Foo.#foo = x }
          static preInc = () => print(++Foo.#foo) + ' ' + print(Foo.#foo)
          static preDec = () => print(--Foo.#foo) + ' ' + print(Foo.#foo)
          static postInc = () => print(Foo.#foo++) + ' ' + print(Foo.#foo)
          static postDec = () => print(Foo.#foo--) + ' ' + print(Foo.#foo)
        }

        check(123, 'preInc', 'number:124 number:124')
        check(123, 'preDec', 'number:122 number:122')
        check(123, 'postInc', 'number:123 number:124')
        check(123, 'postDec', 'number:123 number:122')

        check('123', 'preInc', 'number:124 number:124')
        check('123', 'preDec', 'number:122 number:122')
        check('123', 'postInc', 'number:123 number:124')
        check('123', 'postDec', 'number:123 number:122')

        check('x', 'preInc', 'number:NaN number:NaN')
        check('x', 'preDec', 'number:NaN number:NaN')
        check('x', 'postInc', 'number:NaN number:NaN')
        check('x', 'postDec', 'number:NaN number:NaN')

        check(BigInt(123), 'preInc', 'bigint:124 bigint:124')
        check(BigInt(123), 'preDec', 'bigint:122 bigint:122')
        check(BigInt(123), 'postInc', 'bigint:123 bigint:124')
        check(BigInt(123), 'postDec', 'bigint:123 bigint:122')
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        function print(x) {
          return typeof x + ':' + x
        }

        function check(before, op, after) {
          Foo.setup(before)
          let result = Foo[op]()
          if (result !== after) throw before + ' ' + op + ' should be ' + after + ' but was ' + result
        }

        class Foo {
          static get #foo() { return this.__foo }
          static set #foo(x) { this.__foo = x }
          static setup(x) { this.#foo = x }
          static preInc = () => print(++this.#foo) + ' ' + print(this.#foo)
          static preDec = () => print(--this.#foo) + ' ' + print(this.#foo)
          static postInc = () => print(this.#foo++) + ' ' + print(this.#foo)
          static postDec = () => print(this.#foo--) + ' ' + print(this.#foo)
        }

        check(123, 'preInc', 'number:124 number:124')
        check(123, 'preDec', 'number:122 number:122')
        check(123, 'postInc', 'number:123 number:124')
        check(123, 'postDec', 'number:123 number:122')

        check('123', 'preInc', 'number:124 number:124')
        check('123', 'preDec', 'number:122 number:122')
        check('123', 'postInc', 'number:123 number:124')
        check('123', 'postDec', 'number:123 number:122')

        check('x', 'preInc', 'number:NaN number:NaN')
        check('x', 'preDec', 'number:NaN number:NaN')
        check('x', 'postInc', 'number:NaN number:NaN')
        check('x', 'postDec', 'number:NaN number:NaN')

        check(BigInt(123), 'preInc', 'bigint:124 bigint:124')
        check(BigInt(123), 'preDec', 'bigint:122 bigint:122')
        check(BigInt(123), 'postInc', 'bigint:123 bigint:124')
        check(BigInt(123), 'postDec', 'bigint:123 bigint:122')
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        function expect(fn, msg) {
          try {
            fn()
          } catch (e) {
            ${flags.includes('--target=es6')
          // Only check the exact error message for esbuild
          ? `if (e instanceof TypeError && e.message === msg) return`
          // For node, just check whether a type error is thrown
          : `if (e instanceof TypeError) return`
        }
          }
          throw 'expected ' + msg
        }
        class Foo {
          #foo
          #method() {}
          get #getter() {}
          set #setter(x) {}
          bar() {
            let obj = {}
            expect(() => obj.#foo, 'Cannot read from private field')
            expect(() => obj.#foo = 1, 'Cannot write to private field')
            expect(() => obj.#getter, 'Cannot read from private field')
            expect(() => obj.#setter = 1, 'Cannot write to private field')
            expect(() => obj.#method, 'Cannot access private method')
            expect(() => obj.#method = 1, 'Cannot write to private field')
            expect(() => this.#setter, 'member.get is not a function')
            expect(() => this.#getter = 1, 'member.set is not a function')
            expect(() => this.#method = 1, 'member.set is not a function')
          }
        }
        new Foo().bar()
      `,
    }, {
      expectedStderr: `▲ [WARNING] Writing to read-only method "#method" will throw [private-name-will-throw]

    in.js:22:29:
      22 │             expect(() => obj.#method = 1, 'Cannot write to private...
         ╵                              ~~~~~~~

▲ [WARNING] Reading from setter-only property "#setter" will throw [private-name-will-throw]

    in.js:23:30:
      23 │             expect(() => this.#setter, 'member.get is not a functi...
         ╵                               ~~~~~~~

▲ [WARNING] Writing to getter-only property "#getter" will throw [private-name-will-throw]

    in.js:24:30:
      24 │             expect(() => this.#getter = 1, 'member.set is not a fu...
         ╵                               ~~~~~~~

▲ [WARNING] Writing to read-only method "#method" will throw [private-name-will-throw]

    in.js:25:30:
      25 │             expect(() => this.#method = 1, 'member.set is not a fu...
         ╵                               ~~~~~~~

`,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let setterCalls = 0
        class Foo {
          key
          set key(x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || !foo.hasOwnProperty('key') || foo.key !== void 0) throw 'fail'
      `,
    }, {
      expectedStderr: `▲ [WARNING] Duplicate member "key" in class body [duplicate-class-member]

    in.js:5:14:
      5 │           set key(x) { setterCalls++ }
        ╵               ~~~

  The original member "key" is here:

    in.js:4:10:
      4 │           key
        ╵           ~~~

`,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let setterCalls = 0
        class Foo {
          key = 123
          set key(x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || !foo.hasOwnProperty('key') || foo.key !== 123) throw 'fail'
      `,
    }, {
      expectedStderr: `▲ [WARNING] Duplicate member "key" in class body [duplicate-class-member]

    in.js:5:14:
      5 │           set key(x) { setterCalls++ }
        ╵               ~~~

  The original member "key" is here:

    in.js:4:10:
      4 │           key = 123
        ╵           ~~~

`,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let toStringCalls = 0
        let setterCalls = 0
        class Foo {
          [{toString() {
            toStringCalls++
            return 'key'
          }}]
          set key(x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || toStringCalls !== 1 || !foo.hasOwnProperty('key') || foo.key !== void 0) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let toStringCalls = 0
        let setterCalls = 0
        class Foo {
          [{toString() {
            toStringCalls++
            return 'key'
          }}] = 123
          set key(x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || toStringCalls !== 1 || !foo.hasOwnProperty('key') || foo.key !== 123) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let key = Symbol('key')
        let setterCalls = 0
        class Foo {
          [key]
          set [key](x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || !foo.hasOwnProperty(key) || foo[key] !== void 0) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let key = Symbol('key')
        let setterCalls = 0
        class Foo {
          [key] = 123
          set [key](x) { setterCalls++ }
        }
        let foo = new Foo()
        if (setterCalls !== 0 || !foo.hasOwnProperty(key) || foo[key] !== 123) throw 'fail'
      `,
    }),

    // Test class re-assignment
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          foo = () => this
        }
        let foo = new Foo()
        if (foo.foo() !== foo) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static foo = () => this
        }
        let old = Foo
        let foo = Foo.foo
        Foo = class Bar {}
        if (foo() !== old) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          bar = 'works'
          foo = () => class {
            [this.bar]
          }
        }
        let foo = new Foo().foo
        if (!('works' in new (foo()))) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static bar = 'works'
          static foo = () => class {
            [this.bar]
          }
        }
        let foo = Foo.foo
        Foo = class Bar {}
        if (!('works' in new (foo()))) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static foo() { return this.#foo }
          static #foo = Foo
        }
        let old = Foo
        Foo = class Bar {}
        if (old.foo() !== old) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static foo() { return this.#foo() }
          static #foo() { return Foo }
        }
        let old = Foo
        Foo = class Bar {}
        if (old.foo() !== old) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        try {
          class Foo {
            static foo() { return this.#foo }
            static #foo = Foo = class Bar {}
          }
          throw 'fail'
        } catch (e) {
          if (!(e instanceof TypeError))
            throw e
        }
      `,
    }, {
      expectedStderr: assignToConstantMessage + `

    in.js:5:26:
      5 │             static #foo = Foo = class Bar {}
        ╵                           ~~~

  The symbol "Foo" was declared a constant here:

    in.js:3:16:
      3 │           class Foo {
        ╵                 ~~~

`,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static foo() { return this.#foo() }
          static #foo() { Foo = class Bar{} }
        }
        try {
          Foo.foo()
          throw 'fail'
        } catch (e) {
          if (!(e instanceof TypeError))
            throw e
        }
      `,
    }, {
      expectedStderr: assignToConstantMessage + `

    in.js:4:26:
      4 │           static #foo() { Foo = class Bar{} }
        ╵                           ~~~

  The symbol "Foo" was declared a constant here:

    in.js:2:14:
      2 │         class Foo {
        ╵               ~~~

`,
    }),

    // Issue: https://github.com/evanw/esbuild/issues/901
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class A {
          pub = this.#priv;
          #priv() {
            return 'Inside #priv';
          }
        }
        if (new A().pub() !== 'Inside #priv') throw 'fail';
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class A {
          static pub = this.#priv;
          static #priv() {
            return 'Inside #priv';
          }
        }
        if (A.pub() !== 'Inside #priv') throw 'fail';
      `,
    }),

    // Issue: https://github.com/evanw/esbuild/issues/1066
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Test {
          #x = 2;
          #y = [];
          z = 2;

          get x() { return this.#x; }
          get y() { return this.#y; }

          world() {
            return [1,[2,3],4];
          }

          hello() {
            [this.#x,this.#y,this.z] = this.world();
          }
        }

        var t = new Test();
        t.hello();
        if (t.x !== 1 || t.y[0] !== 2 || t.y[1] !== 3 || t.z !== 4) throw 'fail';
      `,
    }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      'in.js': `
        import x from './class'
        if (x.bar !== 123) throw 'fail'
      `,
      'class.js': `
        class Foo {
          static foo = 123
        }
        export default class extends Foo {
          static #foo = super.foo
          static bar = this.#foo
        }
      `,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--keep-names'].concat(flags), {
      'in.js': `
        import x from './class'
        if (x.bar !== 123) throw 'fail'
        if (x.name !== 'default') throw 'fail: ' + x.name
      `,
      'class.js': `
        class Foo {
          static foo = 123
        }
        export default class extends Foo {
          static #foo = super.foo
          static bar = this.#foo
        }
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          #a
          #b
          #c
          foo() {
            [this.#a, this.#b, this.#c] = {
              [Symbol.iterator]() {
                let value = 0
                return {
                  next() {
                    return { value: ++value, done: false }
                  }
                }
              }
            }
            return [this.#a, this.#b, this.#c].join(' ')
          }
        }
        if (new Foo().foo() !== '1 2 3') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          #a
          #b
          #c
          #d
          #e
          #f
          foo() {
            [
              {x: this.#a},
              [[, this.#b, ,]],
              {y: this.#c = 3},
              {x: this.x, y: this.y, ...this.#d},
              [, , ...this.#e],
              [{x: [{y: [this.#f]}]}],
            ] = [
              {x: 1},
              [[1, 2, 3]],
              {},
              {x: 2, y: 3, z: 4, w: 5},
              [4, 5, 6, 7, 8],
              [{x: [{y: [9]}]}],
            ]
            return JSON.stringify([
              this.#a,
              this.#b,
              this.#c,
              this.#d,
              this.#e,
              this.#f,
            ])
          }
        }
        if (new Foo().foo() !== '[1,2,3,{"z":4,"w":5},[6,7,8],9]') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          values = []
          set #a(a) { this.values.push(a) }
          set #b(b) { this.values.push(b) }
          set #c(c) { this.values.push(c) }
          set #d(d) { this.values.push(d) }
          set #e(e) { this.values.push(e) }
          set #f(f) { this.values.push(f) }
          foo() {
            [
              {x: this.#a},
              [[, this.#b, ,]],
              {y: this.#c = 3},
              {x: this.x, y: this.y, ...this.#d},
              [, , ...this.#e],
              [{x: [{y: [this.#f]}]}],
            ] = [
              {x: 1},
              [[1, 2, 3]],
              {},
              {x: 2, y: 3, z: 4, w: 5},
              [4, 5, 6, 7, 8],
              [{x: [{y: [9]}]}],
            ]
            return JSON.stringify(this.values)
          }
        }
        if (new Foo().foo() !== '[1,2,3,{"z":4,"w":5},[6,7,8],9]') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          #a
          #b
          #c
          #d
          #e
          #f
          foo() {
            for ([
              {x: this.#a},
              [[, this.#b, ,]],
              {y: this.#c = 3},
              {x: this.x, y: this.y, ...this.#d},
              [, , ...this.#e],
              [{x: [{y: [this.#f]}]}],
            ] of [[
              {x: 1},
              [[1, 2, 3]],
              {},
              {x: 2, y: 3, z: 4, w: 5},
              [4, 5, 6, 7, 8],
              [{x: [{y: [9]}]}],
            ]]) ;
            return JSON.stringify([
              this.#a,
              this.#b,
              this.#c,
              this.#d,
              this.#e,
              this.#f,
            ])
          }
        }
        if (new Foo().foo() !== '[1,2,3,{"z":4,"w":5},[6,7,8],9]') throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          #a
          #b() {}
          get #c() {}
          set #d(x) {}
          bar(x) {
            return #a in x && #b in x && #c in x && #d in x
          }
        }
        let foo = new Foo()
        if (foo.bar(foo) !== true || foo.bar(Foo) !== false) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          #a
          #b() {}
          get #c() {}
          set #d(x) {}
          bar(x) {
            return #a in x && #b in x && #c in x && #d in x
          }
        }
        function mustFail(x) {
          let foo = new Foo()
          try {
            foo.bar(x)
          } catch (e) {
            if (e instanceof TypeError) return
            throw e
          }
          throw 'fail'
        }
        mustFail(null)
        mustFail(void 0)
        mustFail(0)
        mustFail('')
        mustFail(Symbol('x'))
      `,
    }),

    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        let b = 0
        class Foo {
          a
          [(() => ++b)()]
          declare c
          declare [(() => ++b)()]
        }
        const foo = new Foo
        if (b !== 1 || 'a' in foo || 1 in foo || 'c' in foo || 2 in foo) throw 'fail'
      `,
      'tsconfig.json': `{
				"compilerOptions": {
					"useDefineForClassFields": false
				}
			}`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        let b = 0
        class Foo {
          a
          [(() => ++b)()]
          declare c
          declare [(() => ++b)()]
        }
        const foo = new Foo
        if (b !== 1 || !('a' in foo) || !(1 in foo) || 'c' in foo || 2 in foo) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": true
        }
      }`
    }),

    // Validate "branding" behavior
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y = true; static is(z) { return z.#y } }
        const foo = {}
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        if (Derived.is(foo) !== true) throw 'fail 2'
        try { new Derived(foo); throw 'fail 3' } catch (e) { if (e === 'fail 3') throw e }
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y = true; static is(z) { return z.#y } }
        const foo = 123
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        try { Derived.is(foo); throw 'fail 2' } catch (e) { if (e === 'fail 2') throw e }
        new Derived(foo)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y = true; static is(z) { return z.#y } }
        const foo = null
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        try { Derived.is(foo); throw 'fail 2' } catch (e) { if (e === 'fail 2') throw e }
        new Derived(foo)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y() { return true } static is(z) { return z.#y } }
        const foo = {}
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        if (Derived.is(foo)() !== true) throw 'fail 2'
        try { new Derived(foo); throw 'fail 3' } catch (e) { if (e === 'fail 3') throw e }
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y() {} static is(z) { return z.#y } }
        const foo = 123
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        try { Derived.is(foo); throw 'fail 2' } catch (e) { if (e === 'fail 2') throw e }
        new Derived(foo)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Base { constructor(x) { return x } }
        class Derived extends Base { #y() {} static is(z) { return z.#y } }
        const foo = null
        try { Derived.is(foo); throw 'fail 1' } catch (e) { if (e === 'fail 1') throw e }
        new Derived(foo)
        try { Derived.is(foo); throw 'fail 2' } catch (e) { if (e === 'fail 2') throw e }
        new Derived(foo)
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let a, b, c, x = 123
        class Foo {
          #a() { a = { this: this, args: arguments } }
          get #b() { return function () { b = { this: this, args: arguments } } }
          #c = function () { c = { this: this, args: arguments } }
          bar() { (this.#a)\`a\${x}aa\`; (this.#b)\`b\${x}bb\`; (this.#c)\`c\${x}cc\` }
        }
        new Foo().bar()
        if (!(a.this instanceof Foo) || !(b.this instanceof Foo) || !(c.this instanceof Foo)) throw 'fail'
        if (JSON.stringify([...a.args, ...b.args, ...c.args]) !== JSON.stringify([['a', 'aa'], 123, ['b', 'bb'], 123, ['c', 'cc'], 123])) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let a, b, c, x = 123
        class Foo {
          #a() { a = { this: this, args: arguments } }
          get #b() { return function () { b = { this: this, args: arguments } } }
          #c = function () { c = { this: this, args: arguments } }
          bar() { (0, this.#a)\`a\${x}aa\`; (0, this.#b)\`b\${x}bb\`; (0, this.#c)\`c\${x}cc\` }
        }
        new Foo().bar()
        if (a.this instanceof Foo || b.this instanceof Foo || c.this instanceof Foo) throw 'fail'
        if (JSON.stringify([...a.args, ...b.args, ...c.args]) !== JSON.stringify([['a', 'aa'], 123, ['b', 'bb'], 123, ['c', 'cc'], 123])) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let it
        class Foo {
          constructor() { it = this; it = it.#fn\`\` }
          get #fn() { it = null; return function() { return this } }
        }
        new Foo
        if (!(it instanceof Foo)) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let it
        class Foo {
          constructor() { it = this; it = it.#fn() }
          get #fn() { it = null; return function() { return this } }
        }
        new Foo
        if (!(it instanceof Foo)) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        const order = []
        class Test {
          static first = order.push(1)
          static { order.push(2) }
          static third = order.push(3)
        }
        if ('' + order !== '1,2,3') throw 'fail: ' + order
      `,
    }),

    // Check side effect order of computed properties with assign semantics
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const order = []
        const check = x => {
          order.push(x)
          return x
        }
        class Foo {
          [check('a')]() {}
          [check('b')];
          [check('c')] = 1;
          [check('d')]() {}
          static [check('e')];
          static [check('f')] = 2;
          static [check('g')]() {}
          [check('h')];
        }
        class Bar {
          // Use a class with a single static field to check that the computed
          // key isn't deferred outside of the class body while the initializer
          // is left inside.
          static [check('i')] = 3
        }
        if (order + '' !== 'a,b,c,d,e,f,g,h,i') throw 'fail: ' + order
        const foo = new Foo
        if (typeof foo.a !== 'function') throw 'fail: a'
        if ('b' in foo) throw 'fail: b'
        if (foo.c !== 1) throw 'fail: c'
        if (typeof foo.d !== 'function') throw 'fail: d'
        if ('e' in Foo) throw 'fail: e'
        if (Foo.f !== 2) throw 'fail: f'
        if (typeof Foo.g !== 'function') throw 'fail: g'
        if ('h' in foo) throw 'fail: h'
        if (Bar.i !== 3) throw 'fail: i'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),

    // Check for the specific reference behavior of TypeScript's implementation
    // of "experimentalDecorators" with class decorators, which mutate the class
    // binding itself. This test passes on TypeScript's implementation.
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        let oldFoo: any
        let e: any
        let decorate = (foo: any): any => {
          oldFoo = foo
          return { foo }
        }
        @decorate
        class newFoo {
          a(): any { return [newFoo, () => newFoo] }
          b: any = [newFoo, () => newFoo]
          static c(): any { return [newFoo, () => newFoo] }
          static d: any = [newFoo, () => newFoo]
          static { e = [newFoo, () => newFoo] }
        }
        const fail: string[] = []
        if ((newFoo as any).foo !== oldFoo) fail.push('decorate')
        if (new oldFoo().a()[0] !== newFoo) fail.push('a[0]')
        if (new oldFoo().a()[1]() !== newFoo) fail.push('a[1]')
        if (new oldFoo().b[0] !== newFoo) fail.push('b[0]')
        if (new oldFoo().b[1]() !== newFoo) fail.push('b[1]')
        if (oldFoo.c()[0] !== newFoo) fail.push('c[0]')
        if (oldFoo.c()[1]() !== newFoo) fail.push('c[1]')
        if (oldFoo.d[0] !== oldFoo) fail.push('d[0]')
        if (oldFoo.d[1]() !== newFoo) fail.push('d[1]')
        if (e[0] !== oldFoo) fail.push('e[0]')
        if (e[1]() !== newFoo) fail.push('e[1]')
        if (fail.length) throw 'fail: ' + fail
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/2800
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Baz {
          static thing = "value"
          static {
            this.prototype.thing = "value"
          }
        }
        if (new Baz().thing !== 'value') throw 'fail'
      `,
    }),

    // https://github.com/evanw/esbuild/issues/2950
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class SomeClass {
          static { this.One = 1; }
          static { this.Two = SomeClass.One * 2; }
        }
        if (SomeClass.Two !== 2) throw 'fail'
      `,
    }),

    // https://github.com/evanw/esbuild/issues/3025
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo {
          static {
            Foo.prototype.foo = 'foo'
          }
        }
        if (new Foo().foo !== 'foo') throw 'fail'
      `,
    }),

    // https://github.com/evanw/esbuild/issues/2389
    test(['in.js', '--outfile=node.js', '--minify', '--keep-names'].concat(flags), {
      'in.js': `
        class DirectlyReferenced { static type = DirectlyReferenced.name }
        class ReferencedViaThis { static type = this.name }
        class StaticBlockViaThis { static { if (this.name !== 'StaticBlockViaThis') throw 'fail StaticBlockViaThis: ' + this.name } }
        class StaticBlockDirectly { static { if (StaticBlockDirectly.name !== 'StaticBlockDirectly') throw 'fail StaticBlockDirectly: ' + StaticBlockDirectly.name } }
        if (DirectlyReferenced.type !== 'DirectlyReferenced') throw 'fail DirectlyReferenced: ' + DirectlyReferenced.type
        if (ReferencedViaThis.type !== 'ReferencedViaThis') throw 'fail ReferencedViaThis: ' + ReferencedViaThis.type
      `,
    }),
    test(['in.js', '--outfile=node.js', '--minify', '--keep-names'].concat(flags), {
      'in.js': `
        let ReferencedViaThis = class { static type = this.name }
        let StaticBlockViaThis = class { static { if (this.name !== 'StaticBlockViaThis') throw 'fail StaticBlockViaThis: ' + this.name } }
        if (ReferencedViaThis.type !== 'ReferencedViaThis') throw 'fail ReferencedViaThis: ' + ReferencedViaThis.type
      `,
    }),
    test(['in.js', '--outfile=node.js', '--keep-names', '--format=esm'].concat(flags), {
      'in.js': `
        // Cause the names in the inner scope to be renamed
        if (
          typeof DirectlyReferenced !== 'undefined' ||
          typeof ReferencedViaThis !== 'undefined' ||
          typeof StaticBlockViaThis !== 'undefined' ||
          typeof StaticBlockDirectly !== 'undefined'
        ) {
          throw 'fail'
        }
        function innerScope() {
          class DirectlyReferenced { static type = DirectlyReferenced.name }
          class ReferencedViaThis { static type = this.name }
          class StaticBlockViaThis { static { if (this.name !== 'StaticBlockViaThis') throw 'fail StaticBlockViaThis: ' + this.name } }
          class StaticBlockDirectly { static { if (StaticBlockDirectly.name !== 'StaticBlockDirectly') throw 'fail StaticBlockDirectly: ' + StaticBlockDirectly.name } }
          if (DirectlyReferenced.type !== 'DirectlyReferenced') throw 'fail DirectlyReferenced: ' + DirectlyReferenced.type
          if (ReferencedViaThis.type !== 'ReferencedViaThis') throw 'fail ReferencedViaThis: ' + ReferencedViaThis.type
        }
        innerScope()
      `,
    }),

    // https://github.com/evanw/esbuild/issues/2629
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        // Stub out the decorator so TSC doesn't complain.
        const someDecorator = (): PropertyDecorator => () => {};

        class Foo {
          static message = 'Hello world!';
          static msgLength = Foo.message.length;

          @someDecorator()
          foo() {}
        }

        if (Foo.message !== 'Hello world!' || Foo.msgLength !== 12) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/2045
    test(['in.js', '--bundle', '--outfile=node.js', '--log-override:class-name-will-throw=silent'].concat(flags), {
      'in.js': `
        let A = {a: 'a'} // This should not be used

        let field
        try { class A { static a = 1; [A.a] = 2 } } catch (err) { field = err }
        if (!field) throw 'fail: field'

        let staticField
        try { class A { static a = 1; static [A.a] = 2 } } catch (err) { staticField = err }
        if (!staticField) throw 'fail: staticField'

        let method
        try { class A { static a = 1; [A.a]() { return 2 } } } catch (err) { method = err }
        if (!method) throw 'fail: method'

        let staticMethod
        try { class A { static a = 1; static [A.a]() { return 2 } } } catch (err) { staticMethod = err }
        if (!staticMethod) throw 'fail: staticMethod'
      `,
    }),
    test(['in.js', '--bundle', '--outfile=node.js', '--log-override:class-name-will-throw=silent'].concat(flags), {
      'in.js': `
        let A = {a: 'a'} // This should not be used

        let field
        try { class A { capture = () => A; static a = 1; [A.a] = 2 } } catch (err) { field = err }
        if (!field) throw 'fail: field'

        let staticField
        try { class A { capture = () => A; static a = 1; static [A.a] = 2 } } catch (err) { staticField = err }
        if (!staticField) throw 'fail: staticField'

        let method
        try { class A { capture = () => A; static a = 1; [A.a]() { return 2 } } } catch (err) { method = err }
        if (!method) throw 'fail: method'

        let staticMethod
        try { class A { capture = () => A; static a = 1; static [A.a]() { return 2 } } } catch (err) { staticMethod = err }
        if (!staticMethod) throw 'fail: staticMethod'
      `,
    }),
    test(['in.js', '--bundle', '--outfile=node.js', '--log-override:class-name-will-throw=silent'].concat(flags), {
      'in.js': `
        let A = {a: 'a'} // This should not be used
        let temp

        let field
        try { temp = (class A { static a = 1; [A.a] = 2 }) } catch (err) { field = err }
        if (!field) throw 'fail: field'

        let staticField
        try { temp = (class A { static a = 1; static [A.a] = 2 }) } catch (err) { staticField = err }
        if (!staticField) throw 'fail: staticField'

        let method
        try { temp = (class A { static a = 1; [A.a]() { return 2 } }) } catch (err) { method = err }
        if (!method) throw 'fail: method'

        let staticMethod
        try { temp = (class A { static a = 1; static [A.a]() { return 2 } }) } catch (err) { staticMethod = err }
        if (!staticMethod) throw 'fail: staticMethod'
      `,
    }),
    test(['in.js', '--bundle', '--outfile=node.js', '--log-override:class-name-will-throw=silent'].concat(flags), {
      'in.js': `
        let A = {a: 'a'} // This should not be used
        let temp

        let field
        try { temp = (class A { capture = () => A; static a = 1; [A.a] = 2 }) } catch (err) { field = err }
        if (!field) throw 'fail: field'

        let staticField
        try { temp = (class A { capture = () => A; static a = 1; static [A.a] = 2 }) } catch (err) { staticField = err }
        if (!staticField) throw 'fail: staticField'

        let method
        try { temp = (class A { capture = () => A; static a = 1; [A.a]() { return 2 } }) } catch (err) { method = err }
        if (!method) throw 'fail: method'

        let staticMethod
        try { temp = (class A { capture = () => A; static a = 1; static [A.a]() { return 2 } }) } catch (err) { staticMethod = err }
        if (!staticMethod) throw 'fail: staticMethod'
      `,
    }),

    // https://github.com/evanw/esbuild/issues/3326
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const log: string[] = []
        class Test1 {
          static deco(target: any, key: any, desc: any): any { log.push('Test1') }
          @Test1.deco static test(): void { }
        }
        class Test2 {
          static deco(target: any, key: any, desc: any): any { log.push('Test2') }
          @Test2.deco static test(): Test2 { return new Test2(); }
        }
        @Test3.deco
        class Test3 {
          static deco(target: any): any { log.push('Test3') }
        }
        if (log + '' !== 'Test1,Test2,Test3') throw 'fail: ' + log
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/3394
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const dec = (arg: number): ParameterDecorator => () => { answer = arg }
        let answer = 0

        class Foo {
          static #foo = 123
          static bar = 234
          method(@dec(Foo.#foo + Foo.bar) arg: any) {
          }
        }

        if (answer !== 357) throw 'fail: ' + answer
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/3538
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo extends Array {
          pass = false
          constructor() {
            let base = super()
            this.pass = base === this &&
              base instanceof Array &&
              base instanceof Foo
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo extends Array {
          pass: boolean = false
          constructor() {
            let base = super()
            this.pass = base === this &&
              base instanceof Array &&
              base instanceof Foo
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Bar {
          constructor(x) {
            return x
          }
        }
        class Foo extends Bar {
          pass = false
          constructor() {
            let base = super([])
            this.pass = base === this &&
              base instanceof Array &&
              !(base instanceof Foo)
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Bar {
          constructor(x) {
            return x
          }
        }
        class Foo extends Bar {
          pass: boolean = false
          constructor() {
            let base = super([])
            this.pass = base === this &&
              base instanceof Array &&
              !(base instanceof Foo)
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/3559
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo extends Array {
          #private: any
          pass: any
          constructor() {
            super()
            this.pass = true
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo extends Array {
          #private: any
          pass = true
          constructor() {
            super()
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo extends Array {
          #private = 123
          pass: any
          constructor() {
            super()
            this.pass = true
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo extends Array {
          #private = 123
          pass: any = true
          constructor() {
            super()
          }
        }
        if (!new Foo().pass) throw 'fail'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),

    // https://github.com/evanw/esbuild/issues/3913
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        function testDecorator(_value: unknown, context: DecoratorContext) {
          if (context.kind === "field") {
            return () => "dec-ok";
          }
        }

        class DecClass {
          @testDecorator
          decInit = "init";

          @testDecorator
          decNoInit: any;
        }

        const foo = new DecClass
        if (foo.decInit !== 'dec-ok') throw 'fail: decInit'
        if (foo.decNoInit !== 'dec-ok') throw 'fail: decNoInit'
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        },
      }`,
    }),

    // Check various combinations of flags
    test(['in.ts', '--outfile=node.js', '--supported:class-field=false'].concat(flags), {
      'in.ts': `
        class Foo {
          accessor foo = 1
          static accessor bar = 2
        }
        if (new Foo().foo !== 1 || Foo.bar !== 2) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js', '--supported:class-static-field=false'].concat(flags), {
      'in.ts': `
        class Foo {
          accessor foo = 1
          static accessor bar = 2
        }
        if (new Foo().foo !== 1 || Foo.bar !== 2) throw 'fail'
      `,
    }),

    // Make sure class body side effects aren't reordered
    test(['in.ts', '--outfile=node.js', '--supported:class-field=false'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo extends (log.push(1), Object) {
          [log.push(2)] = 123;
          [log.push(3)] = 123;
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
    }),
    test(['in.ts', '--outfile=node.js', '--supported:class-static-field=false'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo extends (log.push(1), Object) {
          static [log.push(2)] = 123;
          static [log.push(3)] = 123;
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
    }),
    test(['in.ts', '--outfile=node.js', '--supported:class-field=false'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo {
          static [log.push(1)]() {}
          [log.push(2)] = 123;
          static [log.push(3)]() {}
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
    }),
    test(['in.ts', '--outfile=node.js', '--supported:class-static-field=false'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo {
          [log.push(1)]() {}
          static [log.push(2)] = 123;
          [log.push(3)]() {}
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo {
          @(() => { log.push(3) }) [log.push(1)]() {}
          [log.push(2)] = 123;
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true
        }
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const log = []
        class Foo {
          @(() => { log.push(3) }) static [log.push(1)]() {}
          static [log.push(2)] = 123;
        }
        if (log + '' !== '1,2,3') throw 'fail: ' + log
      `,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true
        }
      }`,
    }),

    // Check "await" in computed property names
    test(['in.ts', '--outfile=node.js', '--format=cjs', '--supported:class-field=false'].concat(flags), {
      'in.ts': `
        exports.async = async () => {
          class Foo {
            [await Promise.resolve('foo')] = 123
          }
          if (new Foo().foo !== 123) throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.ts', '--outfile=node.js', '--format=cjs', '--supported:class-static-field=false'].concat(flags), {
      'in.ts': `
        exports.async = async () => {
          class Foo {
            static [await Promise.resolve('foo')] = 123
          }
          if (Foo.foo !== 123) throw 'fail'
        }
      `,
    }, { async: true }),
  )

  // https://github.com/evanw/esbuild/issues/3177
  const input3177 = `
    const props: Record<number, string> = {}
    const dec = (n: number) => (_: any, prop: string): void => {
      props[n] = prop
    }
    class Foo {
      @dec(1) prop1: any
      @dec(2) prop2_: any
      @dec(3) ['prop3']: any
      @dec(4) ['prop4_']: any
      @dec(5) [/* @__KEY__ */ 'prop5']: any
      @dec(6) [/* @__KEY__ */ 'prop6_']: any
    }
    if (props[1] !== 'prop1') throw 'fail 1: ' + props[1]
    if (props[2] !== /* @__KEY__ */ 'prop2_') throw 'fail 2: ' + props[2]
    if (props[3] !== 'prop3') throw 'fail 3: ' + props[3]
    if (props[4] !== 'prop4_') throw 'fail 4: ' + props[4]
    if (props[5] !== 'prop5') throw 'fail 5: ' + props[5]
    if (props[6] !== /* @__KEY__ */ 'prop6_') throw 'fail 6: ' + props[6]
  `
  tests.push(
    test(['in.ts', '--outfile=node.js', '--mangle-props=_'].concat(flags), {
      'in.ts': input3177,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
          "useDefineForClassFields": true,
        },
      }`,
    }),
    test(['in.ts', '--outfile=node.js', '--mangle-props=_'].concat(flags), {
      'in.ts': input3177,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
          "useDefineForClassFields": false,
        },
      }`,
    }),
  )

  // Test TypeScript experimental decorators and accessors
  const experimentalDecoratorsAndAccessors = `
    const log: string[] = []
    const decorate = (target: any, key: string, descriptor: PropertyDescriptor): any => {
      if (descriptor.get === void 0) throw 'fail: get ' + key
      if (descriptor.set === void 0) throw 'fail: set ' + key
      return {
        get() {
          const value = descriptor.get!.call(this)
          log.push('get ' + key + ' ' + value)
          return value
        },
        set(value: any) {
          descriptor.set!.call(this, value)
          log.push('set ' + key + ' ' + value)
        },
      }
    }

    // With esbuild's accessor syntax
    class Foo {
      @decorate accessor x = 1
      @decorate static accessor y = 2
    }
    const foo = new Foo
    if (++foo.x !== 2) throw 'fail: foo.x'
    if (++Foo.y !== 3) throw 'fail: foo.y'
    if (log + '' !== 'get x 1,set x 2,get y 2,set y 3') throw 'fail: foo ' + log

    log.length = 0

    // Without esbuild's accessor syntax (should be the same)
    class Bar {
      #x = 1
      @decorate get x() { return this.#x }
      set x(_) { this.#x = _ }
      static #y = 2
      @decorate static get y() { return this.#y }
      static set y(_) { this.#y = _ }
    }
    const bar = new Bar
    if (++bar.x !== 2) throw 'fail: bar.x'
    if (++Bar.y !== 3) throw 'fail: Bar.y'
    if (log + '' !== 'get x 1,set x 2,get y 2,set y 3') throw 'fail: bar ' + log
  `
  tests.push(
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': experimentalDecoratorsAndAccessors,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
          "useDefineForClassFields": true,
        },
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': experimentalDecoratorsAndAccessors,
      'tsconfig.json': `{
        "compilerOptions": {
          "experimentalDecorators": true,
          "useDefineForClassFields": false,
        },
      }`,
    }),
  )

  // Test class accessors
  const classAccessorTest = `
    const checkAccessor = (obj, key, value) => {
      if (obj[key] !== value) throw 'fail: ' + key + ' get'
      obj[key] = null
      if (obj[key] !== null) throw 'fail: ' + key + ' set'
    }

    checkAccessor(new class { accessor undef }, 'undef')
    checkAccessor(new class { accessor undef2; x = 0 }, 'undef2')
    checkAccessor(new class { accessor def = 123 }, 'def', 123)
    checkAccessor(new class { accessor def2 = 123; x = 0 }, 'def2', 123)

    checkAccessor(class { static accessor staticUndef }, 'staticUndef')
    checkAccessor(class { static accessor staticUndef2; x = 0 }, 'staticUndef2')
    checkAccessor(class { static accessor staticDef = 123 }, 'staticDef', 123)
    checkAccessor(class { static accessor staticDef2 = 123; x = 0 }, 'staticDef2', 123)

    checkAccessor(new class { accessor #x; get privateUndef() { return this.#x } set privateUndef(_) { this.#x = _ } }, 'privateUndef')
    checkAccessor(new class { accessor #x; get privateUndef2() { return this.#x } set privateUndef2(_) { this.#x = _ } x = 0 }, 'privateUndef2')
    checkAccessor(new class { accessor #x = 123; get privateDef() { return this.#x } set privateDef(_) { this.#x = _ } }, 'privateDef', 123)
    checkAccessor(new class { accessor #x = 123; get privateDef2() { return this.#x } set privateDef2(_) { this.#x = _ } x = 0 }, 'privateDef2', 123)

    checkAccessor(class { static accessor #x; static get staticPrivateUndef() { return this.#x } static set staticPrivateUndef(_) { this.#x = _ } }, 'staticPrivateUndef')
    checkAccessor(class { static accessor #x; static get staticPrivateUndef2() { return this.#x } static set staticPrivateUndef2(_) { this.#x = _ } x = 0 }, 'staticPrivateUndef2')
    checkAccessor(class { static accessor #x = 123; static get staticPrivateDef() { return this.#x } static set staticPrivateDef(_) { this.#x = _ } }, 'staticPrivateDef', 123)
    checkAccessor(class { static accessor #x = 123; static get staticPrivateDef2() { return this.#x } static set staticPrivateDef2(_) { this.#x = _ } x = 0 }, 'staticPrivateDef2', 123)

    const order = []
    const checkOrder = x => {
      order.push(x)
      return x
    }
    class Foo {
      a = checkOrder(8)
      #a = checkOrder(9)
      accessor b = checkOrder(10)
      accessor #b = checkOrder(11)
      accessor [checkOrder(1)] = checkOrder(12)
      static c = checkOrder(3)
      static #c = checkOrder(4)
      static accessor d = checkOrder(5)
      static accessor #d = checkOrder(6)
      static accessor [checkOrder(2)] = checkOrder(7)
      'get#a'() { return this.#a }
      'get#b'() { return this.#b }
      static 'get#c'() { return this.#c }
      static 'get#d'() { return this.#d }
    }
    const foo = new Foo
    if (order + '' !== '1,2,3,4,5,6,7,8,9,10,11,12') throw 'fail: ' + order
    if (foo.a !== 8) throw 'fail: a'
    if (foo['get#a']() !== 9) throw 'fail: #a'
    if (foo.b !== 10) throw 'fail: b'
    if (foo['get#b']() !== 11) throw 'fail: #b'
    if (foo[1] !== 12) throw 'fail: 1'
    if (Foo.c !== 3) throw 'fail: c'
    if (Foo['get#c']() !== 4) throw 'fail: #c'
    if (Foo.d !== 5) throw 'fail: d'
    if (Foo['get#d']() !== 6) throw 'fail: #d'
    if (Foo[2] !== 7) throw 'fail: 2'
  `
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': classAccessorTest,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': classAccessorTest,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": true,
        }
      }`,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': classAccessorTest,
      'tsconfig.json': `{
        "compilerOptions": {
          "useDefineForClassFields": false,
        }
      }`,
    }),
  )

  // https://github.com/evanw/esbuild/issues/3768
  tests.push(
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const bar = x => x
        class Foo {
          @bar baz() { return Foo }
        }
        if (new Foo().baz() !== Foo) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo {}
        const bar = x => x
        class Baz extends Foo {
          @bar baz() { return Baz }
        }
        if (new Baz().baz() !== Baz) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        const bar = () => x => x
        class Foo {
          @bar baz = Foo
        }
        if (new Foo().baz !== Foo) throw 'fail'
      `,
    }),
    test(['in.ts', '--outfile=node.js'].concat(flags), {
      'in.ts': `
        class Foo {}
        const bar = () => x => x
        class Baz extends Foo {
          @bar baz = Baz
        }
        if (new Baz().baz !== Baz) throw 'fail'
      `,
    }),
  )
}

// Async lowering tests
for (let flags of [[], ['--target=es2017'], ['--target=es6']]) {
  tests.push(
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        exports.async = async () => {
          const value = await Promise.resolve(123)
          if (value !== 123) throw 'fail'

          let uncaught = false
          let caught = false
          try {
            await Promise.reject(234)
            uncaught = true
          } catch (error) {
            if (error !== 234) throw 'fail'
            caught = true
          }
          if (uncaught || !caught) throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        async function throws() {
          throw 123
        }
        exports.async = () => throws().then(
          () => {
            throw 'fail'
          },
          error => {
            if (error !== 123) throw 'fail'
          }
        )
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        exports.async = async () => {
          "use strict"
          async function foo() {
            return [this, arguments]
          }
          let [t, a] = await foo.call(0, 1, 2, 3)
          if (t !== 0 || a.length !== 3 || a[0] !== 1 || a[1] !== 2 || a[2] !== 3) throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        let couldThrow = () => 'b'
        exports.async = async () => {
          "use strict"
          async function f0() {
            let bar = async (x, y) => [x, y, this, arguments]
            return await bar('a', 'b')
          }
          async function f1() {
            let bar = async (x, ...y) => [x, y[0], this, arguments]
            return await bar('a', 'b')
          }
          async function f2() {
            let bar = async (x, y = 'b') => [x, y, this, arguments]
            return await bar('a')
          }
          async function f3() {
            let bar = async (x, y = couldThrow()) => [x, y, this, arguments]
            return await bar('a')
          }
          async function f4() {
            let bar = async (x, y = couldThrow()) => (() => [x, y, this, arguments])()
            return await bar('a')
          }
          async function f5() {
            let bar = () => async (x, y = couldThrow()) => [x, y, this, arguments]
            return await bar()('a')
          }
          async function f6() {
            let bar = async () => async (x, y = couldThrow()) => [x, y, this, arguments]
            return await (await bar())('a')
          }
          for (let foo of [f0, f1, f2, f3, f4, f5, f6]) {
            let [x, y, t, a] = await foo.call(0, 1, 2, 3)
            if (x !== 'a' || y !== 'b' || t !== 0 || a.length !== 3 || a[0] !== 1 || a[1] !== 2 || a[2] !== 3) throw 'fail'
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // The async transform must not change the argument count
      'in.js': `
        async function a(x, y) {}
        if (a.length !== 2) throw 'fail: a'

        async function b(x, y = x(), z) {}
        if (b.length !== 1) throw 'fail: b'

        async function c(x, y, ...z) {}
        if (c.length !== 2) throw 'fail: c'

        let d = async function(x, y) {}
        if (d.length !== 2) throw 'fail: d'

        let e = async function(x, y = x(), z) {}
        if (e.length !== 1) throw 'fail: e'

        let f = async function(x, y, ...z) {}
        if (f.length !== 2) throw 'fail: f'

        let g = async (x, y) => {}
        if (g.length !== 2) throw 'fail: g'

        let h = async (x, y = x(), z) => {}
        if (h.length !== 1) throw 'fail: h'

        let i = async (x, y, ...z) => {}
        if (i.length !== 2) throw 'fail: i'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions must be able to access default arguments past the last non-default argument
      'in.js': `
        exports.async = async () => {
          async function a(x, y = 0) { return y }
          let b = async function(x, y = 0) { return y }
          let c = async (x, y = 0) => y
          for (let fn of [a, b, c]) {
            if ((await fn('x', 'y')) !== 'y') throw 'fail: ' + fn
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions must be able to access arguments past the argument count using "arguments"
      'in.js': `
        exports.async = async () => {
          async function a() { return arguments[2] }
          async function b(x, y) { return arguments[2] }
          async function c(x, y = x) { return arguments[2] }
          let d = async function() { return arguments[2] }
          let e = async function(x, y) { return arguments[2] }
          let f = async function(x, y = x) { return arguments[2] }
          for (let fn of [a, b, c, d, e, f]) {
            if ((await fn('x', 'y', 'z')) !== 'z') throw 'fail: ' + fn
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions must be able to access arguments past the argument count using a rest argument
      'in.js': `
        exports.async = async () => {
          async function a(...rest) { return rest[3] }
          async function b(x, y, ...rest) { return rest[1] }
          async function c(x, y = x, ...rest) { return rest[1] }
          let d = async function(...rest) { return rest[3] }
          let e = async function(x, y, ...rest) { return rest[1] }
          let f = async function(x, y = x, ...rest) { return rest[1] }
          let g = async (...rest) => rest[3]
          let h = async (x, y, ...rest) => rest[1]
          let i = async (x, y = x, ...rest) => rest[1]
          for (let fn of [a, b, c, d, e, f, g, h, i]) {
            if ((await fn(11, 22, 33, 44)) !== 44) throw 'fail: ' + fn
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions must be able to modify arguments using "arguments"
      'in.js': `
        exports.async = async () => {
          async function a(x) { let y = [x, arguments[0]]; arguments[0] = 'y'; return y.concat(x, arguments[0]) }
          let b = async function(x) { let y = [x, arguments[0]]; arguments[0] = 'y'; return y.concat(x, arguments[0]) }
          for (let fn of [a, b]) {
            let values = (await fn('x')) + ''
            if (values !== 'x,x,y,y') throw 'fail: ' + values
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Errors in the evaluation of async function arguments should reject the resulting promise
      'in.js': `
        exports.async = async () => {
          let expected = new Error('You should never see this error')
          let throws = () => { throw expected }
          async function a(x, y = throws()) {}
          async function b({ [throws()]: x }) {}
          let c = async function (x, y = throws()) {}
          let d = async function ({ [throws()]: x }) {}
          let e = async (x, y = throws()) => {}
          let f = async ({ [throws()]: x }) => {}
          for (let fn of [a, b, c, d, e, f]) {
            let promise = fn({})
            try {
              await promise
            } catch (e) {
              if (e === expected) continue
            }
            throw 'fail: ' + fn
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions handle "super" property accesses in classes
      'in.js': `
        exports.async = async () => {
          let counter = 0
          let returnsBar = () => (++counter, 'bar')
          class Base {
            foo(x, y) {
              return x + y
            }
            get bar() { return this._bar }
            set bar(x) { this._bar = x }
          }
          class Derived extends Base {
            get bar() { throw 'fail' }
            set bar(x) { throw 'fail' }
            async test(foo, bar) {
              return [
                await super.foo,
                await super[foo],

                ([super.bar] = [BigInt('1')])[0],
                ([super[bar]] = [BigInt('2')])[0],
                ([super[returnsBar()]] = [BigInt('3')])[0],

                (super.bar = BigInt('4')),
                (super.bar += BigInt('2')),
                super.bar++,
                ++super.bar,

                (super[bar] = BigInt('9')),
                (super[bar] += BigInt('2')),
                super[bar]++,
                ++super[bar],

                (super[returnsBar()] = BigInt('14')),
                (super[returnsBar()] += BigInt('2')),
                super[returnsBar()]++,
                ++super[returnsBar()],

                await super.foo.name,
                await super[foo].name,
                await super.foo?.name,
                await super[foo]?.name,
                await super._foo?.name,
                await super['_' + foo]?.name,

                await super.foo(1, 2),
                await super[foo](1, 2),
                await super.foo?.(1, 2),
                await super[foo]?.(1, 2),
                await super._foo?.(1, 2),
                await super['_' + foo]?.(1, 2),
              ]
            }
          }
          let d = new Derived
          let observed = await d.test('foo', 'bar')
          let expected = [
            d.foo, d.foo,
            BigInt('1'), BigInt('2'), BigInt('3'),
            BigInt('4'), BigInt('6'), BigInt('6'), BigInt('8'),
            BigInt('9'), BigInt('11'), BigInt('11'), BigInt('13'),
            BigInt('14'), BigInt('16'), BigInt('16'), BigInt('18'),
            d.foo.name, d.foo.name, d.foo.name, d.foo.name, void 0, void 0,
            3, 3, 3, 3, void 0, void 0,
          ]
          observed.push(d._bar, Base.prototype._bar, counter)
          expected.push(BigInt('18'), undefined, 5)
          for (let i = 0; i < expected.length; i++) {
            if (observed[i] !== expected[i]) {
              console.log(i, observed[i], expected[i])
              throw 'fail'
            }
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Functions handle "super" property accesses in objects
      'in.js': `
        exports.async = async () => {
          let counter = 0
          let returnsBar = () => (++counter, 'bar')
          let b = {
            foo(x, y) {
              return x + y
            },
            get bar() { return this._bar },
            set bar(x) { this._bar = x },
          }
          let d = {
            get bar() { throw 'fail' },
            set bar(x) { throw 'fail' },
            async test(foo, bar) {
              return [
                await super.foo,
                await super[foo],

                ([super.bar] = [BigInt('1')])[0],
                ([super[bar]] = [BigInt('2')])[0],
                ([super[returnsBar()]] = [BigInt('3')])[0],

                (super.bar = BigInt('4')),
                (super.bar += BigInt('2')),
                super.bar++,
                ++super.bar,

                (super[bar] = BigInt('9')),
                (super[bar] += BigInt('2')),
                super[bar]++,
                ++super[bar],

                (super[returnsBar()] = BigInt('14')),
                (super[returnsBar()] += BigInt('2')),
                super[returnsBar()]++,
                ++super[returnsBar()],

                await super.foo.name,
                await super[foo].name,
                await super.foo?.name,
                await super[foo]?.name,
                await super._foo?.name,
                await super['_' + foo]?.name,

                await super.foo(1, 2),
                await super[foo](1, 2),
                await super.foo?.(1, 2),
                await super[foo]?.(1, 2),
                await super._foo?.(1, 2),
                await super['_' + foo]?.(1, 2),
              ]
            },
          }
          Object.setPrototypeOf(d, b)
          let observed = await d.test('foo', 'bar')
          let expected = [
            d.foo, d.foo,
            BigInt('1'), BigInt('2'), BigInt('3'),
            BigInt('4'), BigInt('6'), BigInt('6'), BigInt('8'),
            BigInt('9'), BigInt('11'), BigInt('11'), BigInt('13'),
            BigInt('14'), BigInt('16'), BigInt('16'), BigInt('18'),
            d.foo.name, d.foo.name, d.foo.name, d.foo.name, void 0, void 0,
            3, 3, 3, 3, void 0, void 0,
          ]
          observed.push(d._bar, b._bar, counter)
          expected.push(BigInt('18'), undefined, 5)
          for (let i = 0; i < expected.length; i++) {
            if (observed[i] !== expected[i]) {
              console.log(i, observed[i], expected[i])
              throw 'fail'
            }
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Handle "super" property accesses in static class fields
      'in.js': `
        exports.async = async () => {
          let counter = 0
          let returnsBar = () => (++counter, 'bar')
          class Base {
            static foo(x, y) {
              return x + y
            }
            static get bar() { return this._bar }
            static set bar(x) { this._bar = x }
          }
          class Derived extends Base {
            static get bar() { throw 'fail' }
            static set bar(x) { throw 'fail' }
            static test = async (foo, bar) => {
              return [
                await super.foo,
                await super[foo],

                ([super.bar] = [BigInt('1')])[0],
                ([super[bar]] = [BigInt('2')])[0],
                ([super[returnsBar()]] = [BigInt('3')])[0],

                (super.bar = BigInt('4')),
                (super.bar += BigInt('2')),
                super.bar++,
                ++super.bar,

                (super[bar] = BigInt('9')),
                (super[bar] += BigInt('2')),
                super[bar]++,
                ++super[bar],

                (super[returnsBar()] = BigInt('14')),
                (super[returnsBar()] += BigInt('2')),
                super[returnsBar()]++,
                ++super[returnsBar()],

                await super.foo.name,
                await super[foo].name,
                await super.foo?.name,
                await super[foo]?.name,
                await super._foo?.name,
                await super['_' + foo]?.name,

                await super.foo(1, 2),
                await super[foo](1, 2),
                await super.foo?.(1, 2),
                await super[foo]?.(1, 2),
                await super._foo?.(1, 2),
                await super['_' + foo]?.(1, 2),
              ]
            }
          }
          let observed = await Derived.test('foo', 'bar')
          let expected = [
            Derived.foo, Derived.foo,
            BigInt('1'), BigInt('2'), BigInt('3'),
            BigInt('4'), BigInt('6'), BigInt('6'), BigInt('8'),
            BigInt('9'), BigInt('11'), BigInt('11'), BigInt('13'),
            BigInt('14'), BigInt('16'), BigInt('16'), BigInt('18'),
            Derived.foo.name, Derived.foo.name, Derived.foo.name, Derived.foo.name, void 0, void 0,
            3, 3, 3, 3, void 0, void 0,
          ]
          observed.push(Derived._bar, Base._bar, counter)
          expected.push(BigInt('18'), undefined, 5)
          for (let i = 0; i < expected.length; i++) {
            if (observed[i] !== expected[i]) {
              console.log(i, observed[i], expected[i])
              throw 'fail'
            }
          }
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Handle "super" property accesses in async arrow functions
      'in.js': `
        exports.async = async () => {
          const log = [];
          class Base {
            foo(x) { log.push(x) }
          }
          class Derived extends Base {
            foo1() { return async () => super.foo('foo1') }
            foo2() { return async () => () => super.foo('foo2') }
            foo3() { return () => async () => super.foo('foo3') }
            foo4() { return async () => async () => super.foo('foo4') }
            bar1 = async () => super.foo('bar1')
            bar2 = async () => () => super.foo('bar2')
            bar3 = () => async () => super.foo('bar3')
            bar4 = async () => async () => super.foo('bar4')
            async baz1() { return () => super.foo('baz1') }
            async baz2() { return () => () => super.foo('baz2') }

            #foo1() { return async () => super.foo('foo1') }
            #foo2() { return async () => () => super.foo('foo2') }
            #foo3() { return () => async () => super.foo('foo3') }
            #foo4() { return async () => async () => super.foo('foo4') }
            #bar1 = async () => super.foo('bar1')
            #bar2 = async () => () => super.foo('bar2')
            #bar3 = () => async () => super.foo('bar3')
            #bar4 = async () => async () => super.foo('bar4')
            async #baz1() { return () => super.foo('baz1') }
            async #baz2() { return () => () => super.foo('baz2') }

            async run() {
              await derived.foo1()();
              (await derived.foo2()())();
              await derived.foo3()()();
              await (await derived.foo4()())();
              await derived.bar1();
              (await derived.bar2())();
              await derived.bar3()();
              await (await derived.bar4())();
              (await derived.baz1())();
              (await derived.baz2())()();

              await this.#foo1()();
              (await this.#foo2()())();
              await this.#foo3()()();
              await (await this.#foo4()())();
              await this.#bar1();
              (await this.#bar2())();
              await this.#bar3()();
              await (await this.#bar4())();
              (await this.#baz1())();
              (await this.#baz2())()();
            }
          }
          let derived = new Derived;
          await derived.run();
          let observed = log.join(',');
          let expected = 'foo1,foo2,foo3,foo4,bar1,bar2,bar3,bar4,baz1,baz2';
          expected += ',' + expected;
          if (observed !== expected) throw 'fail: ' + observed + ' != ' + expected;
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Handle "super" property writes in async arrow functions
      'in.js': `
        exports.async = async () => {
          const log = [];
          class Base {
            set foo(x) { log.push(x) }
          }
          class Derived extends Base {
            foo1() { return async () => super.foo = 'foo1' }
            foo2() { return async () => () => super.foo = 'foo2' }
            foo3() { return () => async () => super.foo = 'foo3' }
            foo4() { return async () => async () => super.foo = 'foo4' }
            bar1 = async () => super.foo = 'bar1'
            bar2 = async () => () => super.foo = 'bar2'
            bar3 = () => async () => super.foo = 'bar3'
            bar4 = async () => async () => super.foo = 'bar4'
            async baz1() { return () => super.foo = 'baz1' }
            async baz2() { return () => () => super.foo = 'baz2' }

            #foo1() { return async () => super.foo = 'foo1' }
            #foo2() { return async () => () => super.foo = 'foo2' }
            #foo3() { return () => async () => super.foo = 'foo3' }
            #foo4() { return async () => async () => super.foo = 'foo4' }
            #bar1 = async () => super.foo = 'bar1'
            #bar2 = async () => () => super.foo = 'bar2'
            #bar3 = () => async () => super.foo = 'bar3'
            #bar4 = async () => async () => super.foo = 'bar4'
            async #baz1() { return () => super.foo = 'baz1' }
            async #baz2() { return () => () => super.foo = 'baz2' }

            async run() {
              await this.foo1()();
              (await this.foo2()())();
              await this.foo3()()();
              await (await this.foo4()())();
              await this.bar1();
              (await this.bar2())();
              await this.bar3()();
              await (await this.bar4())();
              (await this.baz1())();
              (await this.baz2())()();

              await this.#foo1()();
              (await this.#foo2()())();
              await this.#foo3()()();
              await (await this.#foo4()())();
              await this.#bar1();
              (await this.#bar2())();
              await this.#bar3()();
              await (await this.#bar4())();
              (await this.#baz1())();
              (await this.#baz2())()();
            }
          }
          let derived = new Derived;
          await derived.run();
          let observed = log.join(',');
          let expected = 'foo1,foo2,foo3,foo4,bar1,bar2,bar3,bar4,baz1,baz2';
          expected += ',' + expected;
          if (observed !== expected) throw 'fail: ' + observed + ' != ' + expected;
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Handle static "super" property accesses in async arrow functions
      'in.js': `
        exports.async = async () => {
          const log = [];
          class Base {
            static foo(x) { log.push(x) }
          }
          class Derived extends Base {
            static foo1() { return async () => super.foo('foo1') }
            static foo2() { return async () => () => super.foo('foo2') }
            static foo3() { return () => async () => super.foo('foo3') }
            static foo4() { return async () => async () => super.foo('foo4') }
            static bar1 = async () => super.foo('bar1')
            static bar2 = async () => () => super.foo('bar2')
            static bar3 = () => async () => super.foo('bar3')
            static bar4 = async () => async () => super.foo('bar4')
            static async baz1() { return () => super.foo('baz1') }
            static async baz2() { return () => () => super.foo('baz2') }

            static #foo1() { return async () => super.foo('foo1') }
            static #foo2() { return async () => () => super.foo('foo2') }
            static #foo3() { return () => async () => super.foo('foo3') }
            static #foo4() { return async () => async () => super.foo('foo4') }
            static #bar1 = async () => super.foo('bar1')
            static #bar2 = async () => () => super.foo('bar2')
            static #bar3 = () => async () => super.foo('bar3')
            static #bar4 = async () => async () => super.foo('bar4')
            static async #baz1() { return () => super.foo('baz1') }
            static async #baz2() { return () => () => super.foo('baz2') }

            static async run() {
              await this.foo1()();
              (await this.foo2()())();
              await this.foo3()()();
              await (await this.foo4()())();
              await this.bar1();
              (await this.bar2())();
              await this.bar3()();
              await (await this.bar4())();
              (await this.baz1())();
              (await this.baz2())()();

              await this.#foo1()();
              (await this.#foo2()())();
              await this.#foo3()()();
              await (await this.#foo4()())();
              await this.#bar1();
              (await this.#bar2())();
              await this.#bar3()();
              await (await this.#bar4())();
              (await this.#baz1())();
              (await this.#baz2())()();
            }
          }
          await Derived.run();
          let observed = log.join(',');
          let expected = 'foo1,foo2,foo3,foo4,bar1,bar2,bar3,bar4,baz1,baz2';
          expected += ',' + expected;
          if (observed !== expected) throw 'fail: ' + observed + ' != ' + expected;
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Handle static "super" property writes in async arrow functions
      'in.js': `
        exports.async = async () => {
          const log = [];
          class Base {
            static set foo(x) { log.push(x) }
          }
          class Derived extends Base {
            static foo1() { return async () => super.foo = 'foo1' }
            static foo2() { return async () => () => super.foo = 'foo2' }
            static foo3() { return () => async () => super.foo = 'foo3' }
            static foo4() { return async () => async () => super.foo = 'foo4' }
            static bar1 = async () => super.foo = 'bar1'
            static bar2 = async () => () => super.foo = 'bar2'
            static bar3 = () => async () => super.foo = 'bar3'
            static bar4 = async () => async () => super.foo = 'bar4'
            static async baz1() { return () => super.foo = 'baz1' }
            static async baz2() { return () => () => super.foo = 'baz2' }

            static #foo1() { return async () => super.foo = 'foo1' }
            static #foo2() { return async () => () => super.foo = 'foo2' }
            static #foo3() { return () => async () => super.foo = 'foo3' }
            static #foo4() { return async () => async () => super.foo = 'foo4' }
            static #bar1 = async () => super.foo = 'bar1'
            static #bar2 = async () => () => super.foo = 'bar2'
            static #bar3 = () => async () => super.foo = 'bar3'
            static #bar4 = async () => async () => super.foo = 'bar4'
            static async #baz1() { return () => super.foo = 'baz1' }
            static async #baz2() { return () => () => super.foo = 'baz2' }

            static async run() {
              await this.foo1()();
              (await this.foo2()())();
              await this.foo3()()();
              await (await this.foo4()())();
              await this.bar1();
              (await this.bar2())();
              await this.bar3()();
              await (await this.bar4())();
              (await this.baz1())();
              (await this.baz2())()();

              await this.#foo1()();
              (await this.#foo2()())();
              await this.#foo3()()();
              await (await this.#foo4()())();
              await this.#bar1();
              (await this.#bar2())();
              await this.#bar3()();
              await (await this.#bar4())();
              (await this.#baz1())();
              (await this.#baz2())()();
            }
          }
          await Derived.run();
          let observed = log.join(',');
          let expected = 'foo1,foo2,foo3,foo4,bar1,bar2,bar3,bar4,baz1,baz2';
          expected += ',' + expected;
          if (observed !== expected) throw 'fail: ' + observed + ' != ' + expected;
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Check various "super" edge cases
      'in.js': `
        exports.async = async () => {
          const log = [];
          let o, Base, Derived;

          ({
            __proto__: { foo() { log.push(1) } },
            bar() { super.foo() },
          }.bar());

          o = { bar() { super.foo() } };
          o.__proto__ = { foo() { log.push(2) } };
          o.bar();

          o = {
            __proto__: { foo() { log.push(3) } },
            bar() { super.foo() },
          };
          ({ bar: o.bar }).bar();

          Base = class { foo() { log.push(4) } };
          Derived = class extends Base { bar() { super.foo() } };
          new Derived().bar();

          Base = class {};
          Derived = class extends Base { bar() { super.foo() } };
          Derived.prototype.__proto__ = { foo() { log.push(5) } };
          new Derived().bar();

          Base = class { foo() { log.push(6) } };
          Derived = class extends Base { bar() { super.foo() } };
          ({ bar: Derived.prototype.bar }).bar();

          Base = class { foo() { log.push(7) } };
          Derived = class extends Base { bar() { super.foo() } };
          Derived.prototype.foo = () => log.push(false);
          new Derived().bar();

          Base = class { foo() { log.push(8) } };
          Derived = class extends Base { bar = () => super.foo() };
          new Derived().bar();

          Base = class { foo() { log.push(9) } };
          Derived = class extends Base { bar = () => super.foo() };
          o = new Derived();
          o.__proto__ = {};
          o.bar();

          Base = class { static foo() { log.push(10) } };
          Derived = class extends Base { static bar() { super.foo() } };
          Derived.bar();

          Base = class { static foo() { log.push(11) } };
          Derived = class extends Base { static bar() { super.foo() } };
          ({ bar: Derived.bar }).bar();

          Base = class {};
          Derived = class extends Base { static bar() { super.foo() } };
          Derived.__proto__ = { foo() { log.push(12) } };
          Derived.bar();

          Base = class { static foo() { log.push(13) } };
          Derived = class extends Base { static bar = () => super.foo() };
          Derived.bar();

          Base = class { static foo() { log.push(14) } };
          Derived = class extends Base { static bar = () => super.foo() };
          ({ bar: Derived.bar }).bar();

          Base = class {};
          Derived = class extends Base { static bar = () => super.foo() };
          Derived.__proto__ = { foo() { log.push(15) } };
          Derived.bar();

          Base = class { foo() { return 'bar' } };
          Derived = class extends Base { async x() { return class { [super.foo()] = 123 } } };
          if (new (await new Derived().x())().bar === 123) log.push(16);

          Base = class { foo() { return 'bar' } };
          Derived = class extends Base { x = async () => class { [super.foo()] = 123 } };
          if (new (await new Derived().x())().bar === 123) log.push(17);

          Base = class { static foo() { return 'bar' } };
          Derived = class extends Base { static async x() { return class { [super.foo()] = 123 } } };
          if (new (await Derived.x())().bar === 123) log.push(18);

          Base = class { static foo() { return 'bar' } };
          Derived = class extends Base { static x = async () => class { [super.foo()] = 123 } };
          if (new (await Derived.x())().bar === 123) log.push(19);

          // Check that an captured temporary for object methods has the correct scope
          o = [];
          for (let i = 0; i < 3; i++) o.push({
            __proto__: { foo() { return i } },
            async bar() { return super.foo() },
          })
          for (const x of o) log.push(20 + await x.bar());

          const observed = log.join(',');
          const expected = '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22';
          if (observed !== expected) throw 'fail: ' + observed + ' != ' + expected;
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--bundle'].concat(flags), {
      // Check edge case in https://github.com/evanw/esbuild/issues/2158
      'in.js': `
      class Foo {
        constructor(x) {
          this.base = x
        }
      }
      class Bar extends Foo {
        static FOO = 1
        constructor() {
          super(2)
          this.derived = this.#foo + Bar.FOO
        }
        #foo = 3
      }
      let bar = new Bar
      if (bar.base !== 2 || bar.derived !== 4) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js', '--keep-names', '--bundle'].concat(flags), {
      // Check default export name preservation with lowered "super" inside lowered "async"
      'in.js': `
        import fn from './export'
        import pfn from './export-private'
        if (fn.name !== 'default') throw 'fail: ' + fn.name
        if (pfn.name !== 'default') throw 'fail: ' + pfn.name
      `,
      'export.js': `
        export default class extends Object {
          async foo() { super.bar() }
        }
      `,
      'export-private.js': `
        export default class extends Object {
          async #foo() { super.bar() }
        }
      `,
    }),
    test(['in.js', '--outfile=node.js', '--keep-names', '--bundle', '--minify'].concat(flags), {
      // (minified) Check default export name preservation with lowered "super" inside lowered "async"
      'in.js': `
        import fn from './export'
        import pfn from './export-private'
        if (fn.name !== 'default') throw 'fail: ' + fn.name
        if (pfn.name !== 'default') throw 'fail: ' + pfn.name
      `,
      'export.js': `
        export default class extends Object {
          async foo() { super.bar() }
        }
      `,
      'export-private.js': `
        export default class extends Object {
          async #foo() { super.bar() }
        }
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Test coverage for a TypeScript bug: https://github.com/microsoft/TypeScript/issues/46580
      'in.js': `
        class A {
          static x = 1
        }
        class B extends A {
          static y = () => super.x
        }
        class C {
          static x = 2
        }
        if (B.y() !== 1) throw 'fail'
        Object.setPrototypeOf(B, C)
        if (B.y() !== 2) throw 'fail'
      `,
    }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Check the behavior of method tear-off
      'in.js': `
        exports.async = async () => {
          class Base {
            set x(y) {
              this.foo = 'Base'
            }
          }
          class Derived extends Base {
            set x(y) {
              this.foo = 'Derived'
            }
            async set(z) {
              super.x = z
            }
          }
          let base = {
            set x(y) {
              this.foo = 'base'
            }
          }
          let derived = Object.create(base)
          derived.set = new Derived().set
          await derived.set(123)
          if (base.foo !== void 0 || derived.foo !== 'Base') throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Check the behavior of static method tear-off
      'in.js': `
        exports.async = async () => {
          class Base {
            static set x(y) {
              this.foo = 'Base'
            }
          }
          class Derived extends Base {
            static set x(y) {
              this.foo = 'Derived'
            }
            static async set(z) {
              super.x = z
            }
          }
          let base = {
            set x(y) {
              this.foo = 'base'
            }
          }
          let derived = Object.create(base)
          derived.set = Derived.set
          await derived.set(123)
          if (base.foo !== void 0 || derived.foo !== 'Base') throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Check the behavior of static field tear-off (no async)
      'in.js': `
        exports.async = async () => {
          class Base {
            static set x(y) {
              this.foo = 'Base'
            }
          }
          class Derived extends Base {
            static set x(y) {
              this.foo = 'Derived'
            }
            static set = z => {
              super.x = z
            }
          }
          let base = {
            set x(y) {
              this.foo = 'base'
            }
          }
          let derived = Object.create(base)
          derived.set = Derived.set
          derived.set(123)
          if (base.foo !== void 0 || Derived.foo !== 'Base') throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      // Check the behavior of static field tear-off (async)
      'in.js': `
        exports.async = async () => {
          class Base {
            static set x(y) {
              this.foo = 'Base'
            }
          }
          class Derived extends Base {
            static set x(y) {
              this.foo = 'Derived'
            }
            static set = async (z) => {
              super.x = z
            }
          }
          let base = {
            set x(y) {
              this.foo = 'base'
            }
          }
          let derived = Object.create(base)
          derived.set = Derived.set
          await derived.set(123)
          if (base.foo !== void 0 || Derived.foo !== 'Base') throw 'fail'
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        class Foo extends (class {
          foo() {
            return this
          }
        }) {
          x = async (foo) => [
            super.foo(),
            super.foo\`\`,
            super[foo](),
            super[foo]\`\`,
            super['foo'](),
            super['foo']\`\`,
            this.#bar(),
            this.#bar\`\`,
          ]
          #bar() {
            return this
          }
        }
        exports.async = async () => {
          const foo = new Foo
          for (const bar of await foo.x('foo'))
            if (foo !== bar)
              throw 'fail'
        }
      `,
    }, { async: true }),

    // https://github.com/arogozine/LinqToTypeScript/issues/29
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        exports.async = async () => {
          let total = 0
        outer:
          for await (const n of [Promise.resolve(1), Promise.resolve(2), Promise.resolve(5)]) {
            for (let i = 1; i <= n; i++) {
              if (i === 4) continue outer
              total += i
            }
          }
          if (total !== 1 + (1 + 2) + (1 + 2 + 3)) throw 'fail'
        }
      `,
    }, { async: true }),

    // https://github.com/evanw/esbuild/issues/4141
    test(['in.js', '--outfile=node.js'].concat(flags), {
      'in.js': `
        exports.async = () => new Promise((resolve, reject) => {
          new (class Foo extends class { } {
            constructor() {
              let x = 1;
              (async () => {
                if (x !== 1) reject('fail 1');  // (1) Sync phase
                await 1;
                if (x !== 2) reject('fail 2');  // (2) Async phase
                resolve();
              })();
              super();
              x = 2;
            }
          })();
        })
      `,
    }, { async: true }),
  )
}

// Function hoisting tests
tests.push(
  test(['in.js', '--outfile=node.js'], {
    'in.js': `
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js'], {
    'in.js': `
      'use strict'
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
  }),
  test(['in.js', '--outfile=node.js', '--format=esm'], {
    'in.js': `
      export {}
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      var f
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      'use strict'
      if (1) {
        function f() {
          return f
        }
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      export {}
      if (1) {
        function f() {
          return f
        }
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      var f = 1
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      'use strict'
      var f = 1
      if (1) {
        function f() {
          return f
        }
      }
      if (f !== 1) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      export {}
      var f = 1
      if (1) {
        function f() {
          return f
        }
      }
      if (f !== 1) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      import {f, g} from './other'
      if (f !== void 0 || g !== 'g') throw 'fail'
    `,
    'other.js': `
      'use strict'
      var f
      if (1) {
        function f() {
          return f
        }
      }
      exports.f = f
      exports.g = 'g'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      let f = 1
      // This should not be turned into "if (1) let f" because that's a syntax error
      if (1)
        function f() {
          return f
        }
      if (f !== 1) throw 'fail'
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js'], {
    'in.js': `
      x: function f() { return 1 }
      if (f() !== 1) throw 'fail'
    `,
  }),
  test(['in.ts', '--outfile=node.js'], {
    'in.ts': `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() { return 'f' }
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f() })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
  }),
  test(['in.ts', '--bundle', '--outfile=node.js'], {
    'in.ts': `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() { return 'f' }
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f() })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
  }),
  test(['in.js', '--outfile=node.js', '--keep-names'], {
    'in.js': `
      var f
      if (1) function f() { return f }
      if (typeof f !== 'function' || f.name !== 'f') throw 'fail: ' + f.name
    `,
  }),
  test(['in.js', '--bundle', '--outfile=node.js', '--keep-names'], {
    'in.js': `
      var f
      if (1) function f() { return f }
      if (typeof f !== 'function' || f.name !== 'f') throw 'fail: ' + f.name
    `,
  }),
  test(['in.ts', '--outfile=node.js', '--keep-names'], {
    'in.ts': `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() {}
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f.name })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
  }),
  test(['in.ts', '--bundle', '--outfile=node.js', '--keep-names'], {
    'in.ts': `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() {}
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f.name })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
  }),
)

// Object rest pattern tests
tests.push(
  // Test the correctness of side effect order for the TypeScript namespace exports
  test(['in.ts', '--outfile=node.js'], {
    'in.ts': `
      function fn() {
        let trail = []
        let t = k => (trail.push(k), k)
        let [
          { [t('a')]: a } = { a: t('x') },
          { [t('b')]: b, ...c } = { b: t('y') },
          { [t('d')]: d } = { d: t('z') },
        ] = [{ a: 1 }, { b: 2, bb: 3 }]
        return JSON.stringify({a, b, c, d, trail})
      }
      namespace ns {
        let trail = []
        let t = k => (trail.push(k), k)
        export let [
          { [t('a')]: a } = { a: t('x') },
          { [t('b')]: b, ...c } = { b: t('y') },
          { [t('d')]: d } = { d: t('z') },
        ] = [{ a: 1 }, { b: 2, bb: 3 }]
        export let result = JSON.stringify({a, b, c, d, trail})
      }
      if (fn() !== ns.result) throw 'fail'
    `,
  }),

  // Test the array and object rest patterns in TypeScript namespace exports
  test(['in.ts', '--outfile=node.js'], {
    'in.ts': `
      let obj = {};
      ({a: obj.a, ...obj.b} = {a: 1, b: 2, c: 3});
      [obj.c, , ...obj.d] = [1, 2, 3];
      ({e: obj.e, f: obj.f = 'f'} = {e: 'e'});
      [obj.g, , obj.h = 'h'] = ['g', 'gg'];
      namespace ns {
        export let {a, ...b} = {a: 1, b: 2, c: 3};
        export let [c, , ...d] = [1, 2, 3];
        export let {e, f = 'f'} = {e: 'e'};
        export let [g, , h = 'h'] = ['g', 'gg'];
      }
      if (JSON.stringify(obj) !== JSON.stringify(ns)) throw 'fail'
    `,
  }),

  // Test the initializer being overwritten
  test(['in.ts', '--outfile=node.js', '--target=es6'], {
    'in.ts': `
      var z = {x: {z: 'z'}, y: 'y'}, {x: z, ...y} = z
      if (y.y !== 'y' || z.z !== 'z') throw 'fail'
    `,
  }),
  test(['in.ts', '--outfile=node.js', '--target=es6'], {
    'in.ts': `
      var z = {x: {x: 'x'}, y: 'y'}, {[(z = {z: 'z'}, 'x')]: x, ...y} = z
      if (x.x !== 'x' || y.y !== 'y' || z.z !== 'z') throw 'fail'
    `,
  }),
)

// Code splitting tests
tests.push(
  // Code splitting via sharing
  test(['a.js', 'b.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'a.js': `
      import * as ns from './common'
      export let a = 'a' + ns.foo
    `,
    'b.js': `
      import * as ns from './common'
      export let b = 'b' + ns.foo
    `,
    'common.js': `
      export let foo = 123
    `,
    'node.js': `
      import {a} from './out/a.js'
      import {b} from './out/b.js'
      if (a !== 'a123' || b !== 'b123') throw 'fail'
    `,
  }),

  // Code splitting via sharing with name templates
  test([
    'a.js', 'b.js', '--outdir=out', '--splitting', '--format=esm', '--bundle',
    '--entry-names=[name][dir]x', '--chunk-names=[name]/[hash]',
  ], {
    'a.js': `
      import * as ns from './common'
      export let a = 'a' + ns.foo
    `,
    'b.js': `
      import * as ns from './common'
      export let b = 'b' + ns.foo
    `,
    'common.js': `
      export let foo = 123
    `,
    'node.js': `
      import {a} from './out/a/x.js'
      import {b} from './out/b/x.js'
      if (a !== 'a123' || b !== 'b123') throw 'fail'
    `,
  }),

  // Code splitting via sharing with name templates
  test([
    'pages/a/index.js', 'pages/b/index.js', '--outbase=.',
    '--outdir=out', '--splitting', '--format=esm', '--bundle',
    '--entry-names=[name][dir]y', '--chunk-names=[name]/[hash]',
  ], {
    'pages/a/index.js': `
      import * as ns from '../common'
      export let a = 'a' + ns.foo
    `,
    'pages/b/index.js': `
      import * as ns from '../common'
      export let b = 'b' + ns.foo
    `,
    'pages/common.js': `
      export let foo = 123
    `,
    'node.js': `
      import {a} from './out/index/pages/ay.js'
      import {b} from './out/index/pages/by.js'
      if (a !== 'a123' || b !== 'b123') throw 'fail'
    `,
  }),

  // Code splitting via ES6 module double-imported with sync and async imports
  test(['a.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'a.js': `
      import * as ns1 from './b'
      export default async function () {
        const ns2 = await import('./b')
        return [ns1.foo, -ns2.foo]
      }
    `,
    'b.js': `
      export let foo = 123
    `,
    'node.js': `
      export let async = async () => {
        const {default: fn} = await import('./out/a.js')
        const [a, b] = await fn()
        if (a !== 123 || b !== -123) throw 'fail'
      }
    `,
  }, { async: true }),

  // Code splitting via CommonJS module double-imported with sync and async imports
  test(['a.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'a.js': `
      import * as ns1 from './b.cjs'
      export default async function () {
        const ns2 = await import('./b.cjs')
        return [ns1.foo, -ns2.default.foo]
      }
    `,
    'b.cjs': `
      exports.foo = 123
    `,
    'node.js': `
      export let async = async () => {
        const {default: fn} = await import('./out/a.js')
        const [a, b] = await fn()
        if (a !== 123 || b !== -123) throw 'fail'
      }
    `,
  }, { async: true }),

  // Identical output chunks should not be shared
  test(['a.js', 'b.js', 'c.js', '--outdir=out', '--splitting', '--format=esm', '--bundle', '--minify'], {
    'a.js': `
      import {foo as common1} from './common1'
      import {foo as common2} from './common2'
      export let a = [common1, common2]
    `,
    'b.js': `
      import {foo as common2} from './common2'
      import {foo as common3} from './common3'
      export let b = [common2, common3]
    `,
    'c.js': `
      import {foo as common3} from './common3'
      import {foo as common1} from './common1'
      export let c = [common3, common1]
    `,
    'common1.js': `
      export let foo = {}
    `,
    'common2.js': `
      export let foo = {}
    `,
    'common3.js': `
      export let foo = {}
    `,
    'node.js': `
      import {a} from './out/a.js'
      import {b} from './out/b.js'
      import {c} from './out/c.js'
      if (a[0] === a[1]) throw 'fail'
      if (b[0] === b[1]) throw 'fail'
      if (c[0] === c[1]) throw 'fail'
    `,
  }),
  test(['a.js', 'b.js', 'c.js', '--outdir=out', '--splitting', '--format=esm', '--bundle', '--minify'], {
    'a.js': `
      export {a} from './common'
    `,
    'b.js': `
      export {b} from './common'
    `,
    'c.js': `
      export {a as ca, b as cb} from './common'
    `,
    'common.js': `
      export let a = {}
      export let b = {}
    `,
    'node.js': `
      import {a} from './out/a.js'
      import {b} from './out/b.js'
      import {ca, cb} from './out/c.js'
      if (a === b || ca === cb || a !== ca || b !== cb) throw 'fail'
    `,
  }),

  // "sideEffects": false
  // https://github.com/evanw/esbuild/issues/1081
  test(['entry.js', '--outdir=out', '--splitting', '--format=esm', '--bundle', '--chunk-names=[name]'], {
    'entry.js': `import('./a'); import('./b')`,
    'a.js': `import { bar } from './shared'; bar()`,
    'b.js': `import './shared'`,
    'shared.js': `import { foo } from './foo'; export let bar = foo`,
    'foo/index.js': `export let foo = () => {}`,
    'foo/package.json': `{ "sideEffects": false }`,
    'node.js': `
      import path from 'path'
      import url from 'url'
      const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

      // Read the output files
      import fs from 'fs'
      const a = fs.readFileSync(path.join(__dirname, 'out', 'a.js'), 'utf8')
      const chunk = fs.readFileSync(path.join(__dirname, 'out', 'chunk.js'), 'utf8')

      // Make sure the two output files don't import each other
      import assert from 'assert'
      assert.notStrictEqual(chunk.includes('a.js'), a.includes('chunk.js'), 'chunks must not import each other')
    `,
  }),
  test(['entry.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'entry.js': `await import('./a'); await import('./b')`,
    'a.js': `import { bar } from './shared'; bar()`,
    'b.js': `import './shared'`,
    'shared.js': `import { foo } from './foo'; export let bar = foo`,
    'foo/index.js': `export let foo = () => {}`,
    'foo/package.json': `{ "sideEffects": false }`,
    'node.js': `
      // This must not crash
      import './out/entry.js'
    `,
  }),

  // Code splitting where only one entry point uses the runtime
  // https://github.com/evanw/esbuild/issues/1123
  test(['a.js', 'b.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'a.js': `
      import * as foo from './shared'
      export default foo
    `,
    'b.js': `
      import {bar} from './shared'
      export default bar
    `,
    'shared.js': `
      export function foo() {
        return 'foo'
      }
      export function bar() {
        return 'bar'
      }
    `,
    'node.js': `
      import a from './out/a.js'
      import b from './out/b.js'
      if (a.foo() !== 'foo') throw 'fail'
      if (b() !== 'bar') throw 'fail'
    `,
  }),

  // Code splitting with a dynamic import that imports a CSS file
  // https://github.com/evanw/esbuild/issues/1125
  test(['parent.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'parent.js': `
      // This should import the primary JS chunk, not the secondary CSS chunk
      await import('./child')
    `,
    'child.js': `
      import './foo.css'
    `,
    'foo.css': `
      body {
        color: black;
      }
    `,
    'node.js': `
      import './out/parent.js'
    `,
  }),

  // Code splitting with an entry point that exports two different
  // symbols with the same original name (minified and not minified)
  // https://github.com/evanw/esbuild/issues/1201
  test(['entry1.js', 'entry2.js', '--outdir=out', '--splitting', '--format=esm', '--bundle'], {
    'test1.js': `export const sameName = { test: 1 }`,
    'test2.js': `export const sameName = { test: 2 }`,
    'entry1.js': `
      export { sameName } from './test1.js'
      export { sameName as renameVar } from './test2.js'
    `,
    'entry2.js': `export * from './entry1.js'`,
    'node.js': `
      import { sameName as a, renameVar as b } from './out/entry1.js'
      import { sameName as c, renameVar as d } from './out/entry2.js'
      if (a.test !== 1 || b.test !== 2 || c.test !== 1 || d.test !== 2) throw 'fail'
    `,
  }),
  test(['entry1.js', 'entry2.js', '--outdir=out', '--splitting', '--format=esm', '--bundle', '--minify'], {
    'test1.js': `export const sameName = { test: 1 }`,
    'test2.js': `export const sameName = { test: 2 }`,
    'entry1.js': `
      export { sameName } from './test1.js'
      export { sameName as renameVar } from './test2.js'
    `,
    'entry2.js': `export * from './entry1.js'`,
    'node.js': `
      import { sameName as a, renameVar as b } from './out/entry1.js'
      import { sameName as c, renameVar as d } from './out/entry2.js'
      if (a.test !== 1 || b.test !== 2 || c.test !== 1 || d.test !== 2) throw 'fail'
    `,
  }),

  // https://github.com/evanw/esbuild/issues/1252
  test(['client.js', 'utilities.js', '--splitting', '--bundle', '--format=esm', '--outdir=out'], {
    'client.js': `export { Observable } from './utilities'`,
    'utilities.js': `export { Observable } from './observable'`,
    'observable.js': `
      import Observable from './zen-observable'
      export { Observable }
    `,
    'zen-observable.js': `module.exports = 123`,
    'node.js': `
      import {Observable as x} from './out/client.js'
      import {Observable as y} from './out/utilities.js'
      if (x !== 123 || y !== 123) throw 'fail'
    `,
  })
)

// Test the binary loader
for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 256]) {
  const code = `
    import bytes from './data.bin'
    if (!(bytes instanceof Uint8Array)) throw 'not Uint8Array'
    if (bytes.length !== ${length}) throw 'Uint8Array.length !== ${length}'
    if (bytes.buffer.byteLength !== ${length}) throw 'ArrayBuffer.byteLength !== ${length}'
    for (let i = 0; i < ${length}; i++) if (bytes[i] !== (i ^ 0x55)) throw 'bad element ' + i
  `
  const data = Buffer.from([...' '.repeat(length)].map((_, i) => i ^ 0x55))
  tests.push(
    test(['entry.js', '--bundle', '--outfile=node.js', '--loader:.bin=binary', '--platform=browser'], {
      'entry.js': code,
      'data.bin': data,
    }),
    test(['entry.js', '--bundle', '--outfile=node.js', '--loader:.bin=binary', '--platform=node'], {
      'entry.js': code,
      'data.bin': data,
    }),
  )
}

// Test file handle errors other than ENOENT
{
  const errorText = process.platform === 'win32' ? 'Incorrect function.' : 'is a directory';
  tests.push(
    test(['src/entry.js', '--bundle', '--outfile=node.js', '--sourcemap'], {
      'src/entry.js': `
        //# sourceMappingURL=entry.js.map
      `,
      'src/entry.js.map/x': ``,
    }, {
      expectedStderr: `▲ [WARNING] Cannot read file "src/entry.js.map": ${errorText} [missing-source-map]

    src/entry.js:2:29:
      2 │         //# sourceMappingURL=entry.js.map
        ╵                              ~~~~~~~~~~~~

`,
    }),
    test(['src/entry.js', '--bundle', '--outfile=node.js'], {
      'src/entry.js': ``,
      'src/tsconfig.json': `{"extends": "./base.json"}`,
      'src/base.json/x': ``,
    }, {
      expectedStderr: `${errorIcon} [ERROR] Cannot read file "src/base.json": ${errorText}

    src/tsconfig.json:1:12:
      1 │ {"extends": "./base.json"}
        ╵             ~~~~~~~~~~~~~

`,
    }),
    test(['src/entry.js', '--bundle', '--outfile=node.js'], {
      'src/entry.js': ``,
      'src/tsconfig.json': `{"extends": "foo"}`,
      'node_modules/foo/tsconfig.json/x': ``,
    }, {
      expectedStderr: `▲ [WARNING] Cannot find base config file "foo" [tsconfig.json]

    src/tsconfig.json:1:12:
      1 │ {"extends": "foo"}
        ╵             ~~~~~

`,
    }),
    test(['src/entry.js', '--bundle', '--outfile=node.js'], {
      'src/entry.js': ``,

      // These missing directories shouldn't cause any errors on Windows
      'package.json': `{
        "main": "dist/cjs/index.js",
        "module": "dist/esm/index.js"
      }`,
    }),
    test(['src/entry.js', '--bundle', '--outfile=node.js'], {
      'src/entry.js': ``,
      'src/tsconfig.json': `{"extends": "./lib"}`,
      'src/lib.json': `{"compilerOptions": {"target": "1"}}`, // We should get a warning about this file
      'src/lib/index.json': `{"compilerOptions": {"target": "2"}}`, // Not about this file
    }, {
      expectedStderr: `▲ [WARNING] Unrecognized target environment "1" [tsconfig.json]

    src/lib.json:1:31:
      1 │ {"compilerOptions": {"target": "1"}}
        ╵                                ~~~

`,
    }),
  )
}

// Test a special-case error message for people trying to use "'--" on Windows
tests.push(
  test(['in.js', `'--define:process.env.NODE_ENV="production"'`], {
    'in.js': ``,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Unexpected single quote character before flag: '--define:process.env.NODE_ENV="production"'

  This typically happens when attempting to use single quotes to quote arguments with a shell that doesn't recognize single quotes. `+
      `Try using double quote characters to quote arguments instead.

`,
  }),
)

// Test injecting banner and footer
tests.push(
  test(['in.js', '--outfile=node.js', '--banner:js=const bannerDefined = true;'], {
    'in.js': `if (!bannerDefined) throw 'fail'`
  }),
  test(['in.js', '--outfile=node.js', '--footer:js=function footer() { }'], {
    'in.js': `footer()`
  }),
  test(['a.js', 'b.js', '--outdir=out', '--bundle', '--format=cjs', '--banner:js=const bannerDefined = true;', '--footer:js=function footer() { }'], {
    'a.js': `
      module.exports = { banner: bannerDefined, footer };
    `,
    'b.js': `
      module.exports = { banner: bannerDefined, footer };
    `,
    'node.js': `
      const a = require('./out/a');
      const b = require('./out/b');

      if (!a.banner || !b.banner) throw 'fail';
      a.footer();
      b.footer();
    `
  }),
)

// Test "imports" and "exports" in package.json
for (const flags of [[], ['--bundle']]) {
  tests.push(
    // "imports"
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '#pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{
        "type": "module",
        "imports": {
          "#pkg": "./foo.js"
        }
      }`,
      'foo.js': `export default 123`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '#pkg/bar.js'; if (abc !== 123) throw 'fail'`,
      'package.json': `{
        "type": "module",
        "imports": {
          "#pkg/*": "./foo/*"
        }
      }`,
      'foo/bar.js': `export default 123`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '#pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{
        "type": "module",
        "imports": {
          "#pkg": {
            "import": "./yes.js",
            "default": "./no.js"
          }
        }
      }`,
      'yes.js': `export default 123`,
    }),
    test(['in.js', '--outfile=node.js', '--format=cjs'].concat(flags), {
      'in.js': `const abc = require('#pkg'); if (abc !== 123) throw 'fail'`,
      'package.json': `{
        "type": "commonjs",
        "imports": {
          "#pkg": {
            "require": "./yes.js",
            "default": "./no.js"
          }
        }
      }`,
      'yes.js': `module.exports = 123`,
    }),

    // "exports"
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/subdir/foo.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          ".": "./subdir/foo.js"
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/subdir/foo.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          ".": {
            "default": "./subdir/foo.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/subdir/foo.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          "default": "./subdir/foo.js"
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '@scope/pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
      'node_modules/@scope/pkg/package.json': `{
        "type": "module",
        "exports": {
          ".": "./subdir/foo.js"
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '@scope/pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
      'node_modules/@scope/pkg/package.json': `{
        "type": "module",
        "exports": {
          ".": {
            "default": "./subdir/foo.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from '@scope/pkg'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
      'node_modules/@scope/pkg/package.json': `{
        "type": "module",
        "exports": {
          "default": "./subdir/foo.js"
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg/dirwhat'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/sub/what/dirwhat/foo.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          "./di*": "./nope.js",
          "./dir*": "./sub/*/dir*/foo.js",
          "./long*": "./nope.js",
          "./d*": "./nope.js"
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg/foo'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/yes.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          "./foo": [
            { "unused": "./no.js" },
            "./yes.js"
          ]
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg/foo'; if (abc !== 123) throw 'fail'`,
      'package.json': `{ "type": "module" }`,
      'node_modules/pkg/yes.js': `export default 123`,
      'node_modules/pkg/package.json': `{
        "type": "module",
        "exports": {
          "./foo": [
            { "default": "./yes.js" },
            "./no.js"
          ]
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=browser'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'module') throw 'fail'`,
      'node_modules/pkg/default.js': `module.exports = 'default'`,
      'node_modules/pkg/module.js': `export default 'module'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./module.js",
            "default": "./default.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=node', '--packages=bundle'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'module') throw 'fail'`,
      'node_modules/pkg/default.js': `module.exports = 'default'`,
      'node_modules/pkg/module.js': `export default 'module'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./module.js",
            "default": "./default.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=neutral'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'default') throw 'fail'`,
      'node_modules/pkg/default.js': `module.exports = 'default'`,
      'node_modules/pkg/module.js': `export default 'module'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./module.js",
            "default": "./default.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--conditions='].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'default') throw 'fail'`,
      'node_modules/pkg/default.js': `module.exports = 'default'`,
      'node_modules/pkg/module.js': `export default 'module'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./module.js",
            "default": "./default.js"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=node', '--packages=external', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'import') throw 'fail'`,
      'node_modules/pkg/fail.js': `TEST FAILED`, // This package should not be bundled
      'node_modules/pkg/require.cjs': `module.exports = 'require'`,
      'node_modules/pkg/import.mjs': `export default 'import'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./fail.js",
            "import": "./import.mjs",
            "require": "./require.cjs"
          }
        }
      }`,
    }),
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=node', '--packages=external', '--format=cjs'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'require') throw 'fail'`,
      'node_modules/pkg/fail.js': `TEST FAILED`, // This package should not be bundled
      'node_modules/pkg/require.cjs': `module.exports = 'require'`,
      'node_modules/pkg/import.mjs': `export default 'import'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./fail.js",
            "import": "./import.mjs",
            "require": "./require.cjs"
          }
        }
      }`,
    }),

    // Check the default behavior of "--platform=node"
    test(['in.js', '--outfile=node.js', '--bundle', '--platform=node', '--format=esm'].concat(flags), {
      'in.js': `import abc from 'pkg'; if (abc !== 'module') throw 'fail'`,
      'node_modules/pkg/module.js': `export default 'module'`,
      'node_modules/pkg/require.cjs': `module.exports = 'require'`,
      'node_modules/pkg/import.mjs': `export default 'import'`,
      'node_modules/pkg/package.json': `{
        "exports": {
          ".": {
            "module": "./module.js",
            "import": "./import.mjs",
            "require": "./require.cjs"
          }
        }
      }`,
    }),

    // This is an edge case for extensionless files. The file should be treated
    // as CommonJS even though package.json says "type": "module" because that
    // only applies to ".js" files in node, not to all JavaScript files.
    test(['in.js', '--outfile=node.js', '--bundle'], {
      'in.js': `
        const fn = require('yargs/yargs')
        if (fn() !== 123) throw 'fail'
      `,
      'node_modules/yargs/package.json': `{
        "main": "./index.cjs",
        "exports": {
          "./package.json": "./package.json",
          ".": [
            {
              "import": "./index.mjs",
              "require": "./index.cjs"
            },
            "./index.cjs"
          ],
          "./yargs": [
            {
              "import": "./yargs.mjs",
              "require": "./yargs"
            },
            "./yargs"
          ]
        },
        "type": "module",
        "module": "./index.mjs"
      }`,
      'node_modules/yargs/index.cjs': ``,
      'node_modules/yargs/index.mjs': ``,
      'node_modules/yargs/yargs.mjs': ``,
      'node_modules/yargs/yargs': `
        module.exports = function() {
          return 123
        }
      `,
    }),
  )

  // Node 17+ deliberately broke backward compatibility with packages using mappings
  // ending in "/". See https://github.com/nodejs/node/pull/40121 for more info.
  if (flags.length === 0 && nodeMajorVersion >= 17) {
    console.log(`Skipping tests with path mappings ending in "/" since you are running node 17+`)
  } else {
    tests.push(
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from '#pkg/bar.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{
          "type": "module",
          "imports": {
            "#pkg/": "./foo/"
          }
        }`,
        'foo/bar.js': `export default 123`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from 'pkg/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/pkg/subdir/foo.js': `export default 123`,
        'node_modules/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./": "./subdir/"
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from 'pkg/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/pkg/subdir/foo.js': `export default 123`,
        'node_modules/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./": {
              "default": "./subdir/"
            }
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from 'pkg/dir/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/pkg/subdir/foo.js': `export default 123`,
        'node_modules/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./dir/": "./subdir/"
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from 'pkg/dir/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/pkg/subdir/foo.js': `export default 123`,
        'node_modules/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./dir/": {
              "default": "./subdir/"
            }
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from '@scope/pkg/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
        'node_modules/@scope/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./": "./subdir/"
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from '@scope/pkg/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
        'node_modules/@scope/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./": {
              "default": "./subdir/"
            }
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from '@scope/pkg/dir/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
        'node_modules/@scope/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./dir/": "./subdir/"
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=esm'].concat(flags), {
        'in.js': `import abc from '@scope/pkg/dir/foo.js'; if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "module" }`,
        'node_modules/@scope/pkg/subdir/foo.js': `export default 123`,
        'node_modules/@scope/pkg/package.json': `{
          "type": "module",
          "exports": {
            "./dir/": {
              "default": "./subdir/"
            }
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=cjs'].concat(flags), {
        'in.js': `const abc = require('pkg/dir/test'); if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "commonjs" }`,
        'node_modules/pkg/sub/test.js': `module.exports = 123`,
        'node_modules/pkg/package.json': `{
          "exports": {
            "./dir/": "./sub/"
          }
        }`,
      }),
      test(['in.js', '--outfile=node.js', '--format=cjs'].concat(flags), {
        'in.js': `const abc = require('pkg/dir/test'); if (abc !== 123) throw 'fail'`,
        'package.json': `{ "type": "commonjs" }`,
        'node_modules/pkg/sub/test/index.js': `module.exports = 123`,
        'node_modules/pkg/package.json': `{
          "exports": {
            "./dir/": "./sub/"
          }
        }`,
      }),
    )
  }
}

// Top-level await tests
tests.push(
  test(['in.js', '--outdir=out', '--format=esm', '--bundle'], {
    'in.js': `
      function foo() {
        globalThis.tlaTrace.push(2)
        return import('./a.js')
      }

      globalThis.tlaTrace = []
      globalThis.tlaTrace.push(1)
      const it = (await foo()).default
      globalThis.tlaTrace.push(6)
      if (it !== 123 || globalThis.tlaTrace.join(',') !== '1,2,3,4,5,6') throw 'fail'
    `,
    'a.js': `
      globalThis.tlaTrace.push(5)
      export { default } from './b.js'
    `,
    'b.js': `
      globalThis.tlaTrace.push(3)
      export default await Promise.resolve(123)
      globalThis.tlaTrace.push(4)
    `,
    'node.js': `
      import './out/in.js'
    `,
  }),
)

// Test the alias feature
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle', '--alias:foo=./bar/baz'], {
    'in.js': `import "foo"`,
    'node_modules/foo/index.js': `test failure`,
    'bar/baz.js': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--alias:foo=./bar/../baz'], {
    'in.js': `import "foo"`,
    'node_modules/foo/index.js': `test failure`,
    'baz.js': ``,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--alias:@scope=./bar'], {
    'in.js': `import "@scope/foo"`,
    'node_modules/@scope/foo/index.js': `test failure`,
    'bar/foo.js': ``,
  }),
)

// Tests for CSS modules
tests.push(
  test(['in.js', '--outfile=node.js', '--bundle', '--loader:.css=local-css'], {
    'in.js': `
      import * as ns from './styles.css'
      if (ns.buton !== void 0) throw 'fail'
    `,
    'styles.css': `
      .bu\\74 ton { color: red }
    `,
  }, {
    expectedStderr: `▲ [WARNING] Import "buton" will always be undefined because there is no matching export in "styles.css" [import-is-undefined]

    in.js:3:13:
      3 │       if (ns.buton !== void 0) throw 'fail'
        │              ~~~~~
        ╵              button

  Did you mean to import "button" instead?

    styles.css:2:7:
      2 │       .bu\\74 ton { color: red }
        ╵        ~~~~~~~~~

`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as foo_styles from "./foo.css"
      import * as bar_styles from "./bar"
      const { foo } = foo_styles
      const { bar } = bar_styles
      if (foo !== void 0) throw 'fail: foo=' + foo
      if (bar !== void 0) throw 'fail: bar=' + bar
    `,
    'foo.css': `.foo { color: red }`,
    'bar.css': `.bar { color: green }`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle'], {
    'in.js': `
      import * as foo_styles from "./foo.module.css"
      import * as bar_styles from "./bar.module"
      const { foo } = foo_styles
      const { bar } = bar_styles
      if (foo !== 'foo_foo') throw 'fail: foo=' + foo
      if (bar !== 'bar_bar') throw 'fail: bar=' + bar
    `,
    'foo.module.css': `.foo { color: red }`,
    'bar.module.css': `.bar { color: green }`,
  }),
  test(['in.js', '--outfile=node.js', '--bundle', '--loader:.module.css=css'], {
    'in.js': `
      import * as foo_styles from "./foo.module.css"
      import * as bar_styles from "./bar.module"
      const { foo } = foo_styles
      const { bar } = bar_styles
      if (foo !== void 0) throw 'fail: foo=' + foo
      if (bar !== void 0) throw 'fail: bar=' + bar
    `,
    'foo.module.css': `.foo { color: red }`,
    'bar.module.css': `.bar { color: green }`,
  }),
)

// Tests for analyze
tests.push(
  test(['in.js', '--analyze', '--outfile=node.js'], {
    'in.js': `let x = 1 + 2`,
  }, {
    expectedStderr: `
  node.js   15b   100.0%
   └ in.js  15b   100.0%

`,
  }),
  test(['in.js', '--invalid-flag', '--analyze'], {
    'in.js': `let x = 1 + 2`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Invalid build flag: "--invalid-flag"\n\n`,
  }),
  test(['--analyze'], {}, {
    expectedStderr: `${errorIcon} [ERROR] Invalid transform flag: "--analyze"\n\n`,
  }),
)

// Test writing to stdout
tests.push(
  // These should succeed
  testStdout('exports.foo = 123', [], async (build) => {
    const stdout = await build()
    assert.strictEqual(stdout, `exports.foo = 123;\n`)
  }),
  testStdout('exports.foo = 123', ['--bundle', '--format=cjs'], async (build) => {
    const stdout = await build()
    assert.strictEqual(stdout, `// example.js\nexports.foo = 123;\n`)
  }),
  testStdout('exports.foo = 123', ['--sourcemap'], async (build) => {
    const stdout = await build()
    const start = `exports.foo = 123;\n//# sourceMappingURL=data:application/json;base64,`
    assert(stdout.startsWith(start))
    const json = JSON.parse(Buffer.from(stdout.slice(start.length), 'base64').toString())
    assert.strictEqual(json.version, 3)
    assert.deepStrictEqual(json.sources, ['example.js'])
  }),
  testStdout('exports.foo = 123', ['--bundle', '--format=cjs', '--sourcemap'], async (build) => {
    const stdout = await build()
    const start = `// example.js\nexports.foo = 123;\n//# sourceMappingURL=data:application/json;base64,`
    assert(stdout.startsWith(start))
    const json = JSON.parse(Buffer.from(stdout.slice(start.length), 'base64').toString())
    assert.strictEqual(json.version, 3)
    assert.deepStrictEqual(json.sources, ['example.js'])
  }),
  testStdout('stuff', ['--loader:.js=text'], async (build) => {
    const stdout = await build()
    assert.strictEqual(stdout, `module.exports = "stuff";\n`)
  }),

  // These should fail
  testStdout('exports.foo = 123', ['--metafile=graph.json'], async (build) => {
    try { await build() } catch (e) { return }
    throw new Error('Expected build failure for "--metafile"')
  }),
  testStdout('exports.foo = 123', ['--sourcemap=external'], async (build) => {
    try { await build() } catch (e) { return }
    throw new Error('Expected build failure for "--metafile"')
  }),
  testStdout('exports.foo = 123', ['--loader:.js=file'], async (build) => {
    try { await build() } catch (e) { return }
    throw new Error('Expected build failure for "--metafile"')
  }),
)

// Test for a Windows-specific issue where paths starting with "/" could be
// treated as relative paths, leading to inconvenient cross-platform failures:
// https://github.com/evanw/esbuild/issues/822
tests.push(
  test(['in.js', '--bundle'], {
    'in.js': `
      import "/file.js"
    `,
    'file.js': `This file should not be imported on Windows`,
  }, {
    expectedStderr: `${errorIcon} [ERROR] Could not resolve "/file.js"

    in.js:2:13:
      2 │       import "/file.js"
        ╵              ~~~~~~~~~~

`,
  }),
)

// Test that importing a path with the wrong case works ok. This is necessary
// to handle case-insensitive file systems.
if (process.platform === 'darwin' || process.platform === 'win32') {
  tests.push(
    test(['in.js', '--bundle', '--outfile=node.js'], {
      'in.js': `
        import x from "./File1.js"
        import y from "./file2.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      'file1.js': `export default 123`,
      'File2.js': `export default 234`,
    }, {
      expectedStderr: `▲ [WARNING] Use "file1.js" instead of "File1.js" to avoid issues with case-sensitive file systems [different-path-case]

    in.js:2:22:
      2 │         import x from "./File1.js"
        ╵                       ~~~~~~~~~~~~

▲ [WARNING] Use "File2.js" instead of "file2.js" to avoid issues with case-sensitive file systems [different-path-case]

    in.js:3:22:
      3 │         import y from "./file2.js"
        ╵                       ~~~~~~~~~~~~

`,
    }),
    test(['in.js', '--bundle', '--outfile=node.js'], {
      'in.js': `
        import x from "./Dir1/file.js"
        import y from "./dir2/file.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      'dir1/file.js': `export default 123`,
      'Dir2/file.js': `export default 234`,
    }),

    // Warn when importing something inside node_modules
    test(['in.js', '--bundle', '--outfile=node.js'], {
      'in.js': `
        import x from "pkg/File1.js"
        import y from "pkg/file2.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      'node_modules/pkg/file1.js': `export default 123`,
      'node_modules/pkg/File2.js': `export default 234`,
    }, {
      expectedStderr: `▲ [WARNING] Use "node_modules/pkg/file1.js" instead of "node_modules/pkg/File1.js" to avoid issues with case-sensitive file systems [different-path-case]

    in.js:2:22:
      2 │         import x from "pkg/File1.js"
        ╵                       ~~~~~~~~~~~~~~

▲ [WARNING] Use "node_modules/pkg/File2.js" instead of "node_modules/pkg/file2.js" to avoid issues with case-sensitive file systems [different-path-case]

    in.js:3:22:
      3 │         import y from "pkg/file2.js"
        ╵                       ~~~~~~~~~~~~~~

`,
    }),

    // Don't warn when the importer is inside node_modules
    test(['in.js', '--bundle', '--outfile=node.js'], {
      'in.js': `
        import {x, y} from "pkg"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      'node_modules/pkg/index.js': `
        export {default as x} from "./File1.js"
        export {default as y} from "./file2.js"
      `,
      'node_modules/pkg/file1.js': `export default 123`,
      'node_modules/pkg/File2.js': `export default 234`,
    }),
  )
}

// Test glob import behavior
for (const ext of ['.js', '.ts']) {
  tests.push(
    test(['./src/*' + ext, '--outdir=out', '--bundle', '--format=cjs'], {
      'node.js': `
        if (require('./out/a.js') !== 10) throw 'fail: a'
        if (require('./out/b.js') !== 11) throw 'fail: b'
        if (require('./out/c.js') !== 12) throw 'fail: c'
      `,
      ['src/a' + ext]: `module.exports = 10`,
      ['src/b' + ext]: `module.exports = 11`,
      ['src/c' + ext]: `module.exports = 12`,
    }),
    test(['in' + ext, '--outfile=node.js', '--bundle'], {
      ['in' + ext]: `
        for (let i = 0; i < 3; i++) {
          const value = require('./' + i + '${ext}')
          if (value !== i + 10) throw 'fail: ' + i
        }
      `,
      ['0' + ext]: `module.exports = 10`,
      ['1' + ext]: `module.exports = 11`,
      ['2' + ext]: `module.exports = 12`,
    }),
    test(['in' + ext, '--outfile=node.js', '--bundle'], {
      ['in' + ext]: `
        for (let i = 0; i < 3; i++) {
          const value = require(\`./\${i}${ext}\`)
          if (value !== i + 10) throw 'fail: ' + i
        }
      `,
      ['0' + ext]: `module.exports = 10`,
      ['1' + ext]: `module.exports = 11`,
      ['2' + ext]: `module.exports = 12`,
    }),
    test(['in' + ext, '--outfile=node.js', '--bundle'], {
      ['in' + ext]: `
        export let async = async () => {
          for (let i = 0; i < 3; i++) {
            const { default: value } = await import('./' + i + '${ext}')
            if (value !== i + 10) throw 'fail: ' + i
          }
        }
      `,
      ['0' + ext]: `export default 10`,
      ['1' + ext]: `export default 11`,
      ['2' + ext]: `export default 12`,
    }, { async: true }),
    test(['in' + ext, '--outfile=node.js', '--bundle'], {
      ['in' + ext]: `
        export let async = async () => {
          for (let i = 0; i < 3; i++) {
            const { default: value } = await import(\`./\${i}${ext}\`)
            if (value !== i + 10) throw 'fail: ' + i
          }
        }
      `,
      ['0' + ext]: `export default 10`,
      ['1' + ext]: `export default 11`,
      ['2' + ext]: `export default 12`,
    }, { async: true }),
  )
}

// Test "using" declarations
for (const flags of [[], '--supported:async-await=false']) {
  tests.push(
    test(['in.js', '--outfile=node.js', '--supported:using=false'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        const log = []
        {
          using x = { [Symbol.dispose]() { log.push('x') } }
          using y = { [Symbol.dispose]() { log.push('y') } }
          using z1 = null
          using z2 = undefined
          try {
            using no = 0
          } catch {
            log.push('no')
          }
          log.push('z')
        }
        if (log + '' !== 'no,z,y,x') throw 'fail: ' + log
      `,
    }),
    test(['in.js', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.js': `
        Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose')
        export let async = async () => {
          const log = []
          {
            await using x = { [Symbol.asyncDispose]() {
              log.push('x1')
              Promise.resolve().then(() => log.push('x2'))
              return Promise.resolve()
            } }
            await using y = { [Symbol.asyncDispose]() {
              log.push('y1')
              Promise.resolve().then(() => log.push('y2'))
              return Promise.resolve()
            } }
            await using z1 = null
            await using z2 = undefined
            try {
              await using no = 0
            } catch {
              log.push('no')
            }
            log.push('z')
          }
          if (log + '' !== 'no,z,y1,y2,x1,x2') throw 'fail: ' + log
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--supported:using=false'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        const log = []
        for (using x of [
          { [Symbol.dispose]() { log.push('x') } },
          null,
          { [Symbol.dispose]() { log.push('y') } },
          undefined,
        ]) {
          try {
            using no = 0
          } catch {
            log.push('no')
          }
          log.push('z')
        }
        if (log + '' !== 'no,z,x,no,z,no,z,y,no,z') throw 'fail: ' + log
      `,
    }),
    test(['in.js', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose')
        export let async = async () => {
          const log = []
          for (await using x of [
            { [Symbol.dispose]() { log.push('x') } },
            null,
            { [Symbol.asyncDispose]() {
              log.push('y1')
              Promise.resolve().then(() => log.push('y2'))
              return Promise.resolve()
            } },
            undefined,
          ]) {
            try {
              using no = 0
            } catch {
              log.push('no')
            }
            log.push('z')
          }
          if (log + '' !== 'no,z,x,no,z,no,z,y1,y2,no,z') throw 'fail: ' + log
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        export let async = async () => {
          const log = []
          for await (using x of [
            { [Symbol.dispose]() { log.push('x1') } },
            Promise.resolve({ [Symbol.dispose]() { log.push('x2') } }),
            null,
            Promise.resolve(null),
            undefined,
            Promise.resolve(undefined),
          ]) {
            try {
              using no = 0
            } catch {
              log.push('no')
            }
            log.push('z')
          }
          if (log + '' !== 'no,z,x1,no,z,x2,no,z,no,z,no,z,no,z') throw 'fail: ' + log
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose')
        export let async = async () => {
          const log = []
          for await (await using x of [
            { [Symbol.dispose]() { log.push('x1') } },
            Promise.resolve({ [Symbol.dispose]() { log.push('x2') } }),
            { [Symbol.asyncDispose]() { log.push('y1') } },
            Promise.resolve({ [Symbol.asyncDispose]() { log.push('y2') } }),
            null,
            Promise.resolve(null),
            undefined,
            Promise.resolve(undefined),
          ]) {
            try {
              using no = 0
            } catch {
              log.push('no')
            }
            log.push('z')
          }
          if (log + '' !== 'no,z,x1,no,z,x2,no,z,y1,no,z,y2,no,z,no,z,no,z,no,z') throw 'fail: ' + log
        }
      `,
    }, { async: true }),
    test(['in.js', '--outfile=node.js', '--supported:using=false'].concat(flags), {
      'in.js': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        class Foo { [Symbol.dispose]() { throw new Error('x') } }
        try {
          using x = new Foo
          throw new Error('y')
        } catch (err) {
          var result = err
        }
        if (result.name !== 'SuppressedError') throw 'fail: SuppressedError'
        if (result.error.message !== 'x') throw 'fail: x'
        if (result.suppressed.message !== 'y') throw 'fail: y'
        try {
          using x = new Foo
        } catch (err) {
          var result = err
        }
        if (result.message !== 'x') throw 'fail: x (2)'
      `,
    }),
    test(['in.js', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.js': `
        Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose')
        class Foo { [Symbol.asyncDispose]() { throw new Error('x') } }
        export let async = async () => {
          try {
            await using x = new Foo
            throw new Error('y')
          } catch (err) {
            var result = err
          }
          if (result.name !== 'SuppressedError') throw 'fail: SuppressedError'
          if (result.error.message !== 'x') throw 'fail: x'
          if (result.suppressed.message !== 'y') throw 'fail: y'
          try {
            await using x = new Foo
          } catch (err) {
            var result = err
          }
          if (result.message !== 'x') throw 'fail: x (2)'
        }
      `,
    }, { async: true }),

    // From https://github.com/microsoft/TypeScript/pull/58624
    test(['in.ts', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.ts': `
        Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose')
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        export const output: any[] = [];
        export async function main() {
          const promiseDispose = new Promise<void>((resolve) => {
            setTimeout(() => {
              output.push("y dispose promise body");
              resolve();
            }, 0);
          });
          {
            await using x = {
              async [Symbol.asyncDispose]() {
                output.push("x asyncDispose body");
              },
            };
            await using y = {
              [Symbol.dispose]() {
                output.push("y dispose body");
                return promiseDispose;
              },
            };
          }
          output.push("body");
          await promiseDispose;
          return output;
        }
        export let async = async () => {
          const output = await main()
          const expected = [
            "y dispose body",
            "x asyncDispose body",
            "body",
            "y dispose promise body",
          ]
          if (output.join(',') !== expected.join(',')) throw 'fail: ' + output
        }
      `,
    }, { async: true }),
    test(['in.ts', '--outfile=node.js', '--supported:using=false', '--format=esm'].concat(flags), {
      'in.ts': `
        Symbol.dispose ||= Symbol.for('Symbol.dispose')
        export const output: any[] = [];
        export async function main() {
          const interleave = Promise.resolve().then(() => { output.push("interleave"); });
          try {
            await using x = {
              [Symbol.dispose]() {
                output.push("dispose");
                throw null;
              },
            };
          }
          catch {
            output.push("catch");
          }
          await interleave;
          return output;
        }
        export let async = async () => {
          const output = await main()
          const expected = [
            "dispose",
            "interleave",
            "catch",
        ]
          if (output.join(',') !== expected.join(',')) throw 'fail: ' + output
        }
      `,
    }, { async: true }),
  )
}

// End-to-end watch mode tests
tests.push(
  // Validate that the CLI watch mode correctly updates the metafile
  testWatch({ metafile: true }, async ({ infile, outfile, metafile }) => {
    await waitForCondition(
      'initial build',
      20,
      () => fs.writeFile(infile, 'foo()'),
      async () => {
        assert.strictEqual(await fs.readFile(outfile, 'utf8'), 'foo();\n')
        assert.strictEqual(JSON.parse(await fs.readFile(metafile, 'utf8')).inputs[path.basename(infile)].bytes, 5)
      },
    )

    await waitForCondition(
      'subsequent build',
      20,
      () => fs.writeFile(infile, 'foo(123)'),
      async () => {
        assert.strictEqual(await fs.readFile(outfile, 'utf8'), 'foo(123);\n')
        assert.strictEqual(JSON.parse(await fs.readFile(metafile, 'utf8')).inputs[path.basename(infile)].bytes, 8)
      },
    )
  }),

  // Validate that the CLI watch mode correctly updates the mangle cache
  testWatch({ args: ['--mangle-props=.'], mangleCache: true }, async ({ infile, outfile, mangleCache }) => {
    await waitForCondition(
      'initial build',
      20,
      () => fs.writeFile(infile, 'foo()'),
      async () => {
        assert.strictEqual(await fs.readFile(outfile, 'utf8'), 'foo();\n')
        assert.strictEqual(await fs.readFile(mangleCache, 'utf8'), '{}\n')
      },
    )

    await waitForCondition(
      'subsequent build',
      20,
      () => fs.writeFile(infile, 'foo(bar.baz)'),
      async () => {
        assert.strictEqual(await fs.readFile(outfile, 'utf8'), 'foo(bar.a);\n')
        assert.strictEqual(await fs.readFile(mangleCache, 'utf8'), '{\n  "baz": "a"\n}\n')
      },
    )
  }),

  // This tests that watch mode writes to stdout correctly
  testWatchStdout([
    {
      input: 'console.log(1+2)',
      stdout: ['console.log(1 + 2);'],
      stderr: ['[watch] build finished, watching for changes...'],
    },
    {
      input: 'console.log(2+3)',
      stdout: ['console.log(2 + 3);'],
      stderr: ['[watch] build started (change: "in.js")', '[watch] build finished'],
    },
    {
      input: 'console.log(3+4)',
      stdout: ['console.log(3 + 4);'],
      stderr: ['[watch] build started (change: "in.js")', '[watch] build finished'],
    },
  ]),
)

function waitForCondition(what, seconds, mutator, condition) {
  return new Promise(async (resolve, reject) => {
    const start = Date.now()
    let e
    try {
      await mutator()
      while (true) {
        if (Date.now() - start > seconds * 1000) {
          throw new Error(`Timeout of ${seconds} seconds waiting for ${what}` + (e ? `: ${e && e.message || e}` : ''))
        }
        await new Promise(r => setTimeout(r, 50))
        try {
          await condition()
          break
        } catch (err) {
          e = err
        }
      }
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

function test(args, files, options) {
  return async () => {
    const hasBundle = args.includes('--bundle')
    const hasIIFE = args.includes('--format=iife')
    const hasCJS = args.includes('--format=cjs')
    const hasESM = args.includes('--format=esm')
    const formats = hasIIFE ? ['iife'] : hasESM ? ['esm'] : hasCJS || !hasBundle ? ['cjs'] : ['cjs', 'esm']
    const baseExpectedStderr = (options && options.expectedStderr || '')

    // If the test doesn't specify a format, test both formats
    for (const format of formats) {
      const formatArg = `--format=${format}`
      const logLevelArgs = args.some(arg => arg.startsWith('--log-level=')) ? [] : ['--log-level=warning']
      const modifiedArgs = (!hasBundle || args.includes(formatArg) ? args : args.concat(formatArg)).concat(logLevelArgs)
      const thisTestDir = path.join(testDir, '' + testCount++)
      const patchString = str => str.replace('$ABS_PATH_PREFIX$', path.join(thisTestDir, 'x').slice(0, -1))
      const expectedStderr = Array.isArray(baseExpectedStderr) ? baseExpectedStderr.map(patchString) : patchString(baseExpectedStderr)
      await fs.mkdir(thisTestDir, { recursive: true })

      try {
        // Test setup
        for (const file in files) {
          const filePath = path.join(thisTestDir, file)
          const contents = files[file]
          await fs.mkdir(path.dirname(filePath), { recursive: true })

          // Optionally symlink the file if the test requests it
          if (contents.symlink) await fs.symlink(contents.symlink.replace('TEST_DIR_ABS_PATH', thisTestDir), filePath)
          else await fs.writeFile(filePath, contents)
        }

        // Run esbuild
        let stderr
        if (options && options.cwd) {
          // Use the shell to set the working directory instead of using node's
          // "child_process" module. For some reason it looks like node doesn't
          // handle symlinks correctly and some of these tests check esbuild's
          // behavior in the presence of symlinks. Using the shell is the only
          // way I could find to do this correctly.
          const quote = arg => arg.replace(/([#!"$&'()*,:;<=>?@\[\\\]^`{|}])/g, '\\$1')
          const cwd = path.join(thisTestDir, options.cwd)
          const command = ['cd', quote(cwd), '&&', quote(esbuildPath)].concat(modifiedArgs.map(quote)).join(' ')
          stderr = (await execAsync(command, { stdio: 'pipe' })).stderr
        } else {
          stderr = (await execFileAsync(esbuildPath, modifiedArgs, { cwd: thisTestDir, stdio: 'pipe' })).stderr
        }
        if (Array.isArray(expectedStderr)) {
          // An array of possible outputs (due to log output order non-determinism)
          if (!expectedStderr.includes(stderr))
            assert.strictEqual(stderr, expectedStderr[0]);
        } else {
          assert.strictEqual(stderr, expectedStderr);
        }

        // Run the resulting node.js file and make sure it exits cleanly. The
        // use of "pathToFileURL" is a workaround for a problem where node
        // only supports absolute paths on Unix-style systems, not on Windows.
        // See https://github.com/nodejs/node/issues/31710 for more info.
        const nodePath = path.join(thisTestDir, 'node')
        const pjPath = path.join(thisTestDir, 'package.json')
        const pjExists = await fs.stat(pjPath).then(() => true, () => false)
        let testExports
        switch (format) {
          case 'cjs':
          case 'iife':
            if (!pjExists) await fs.writeFile(pjPath, '{"type": "commonjs"}')
            testExports = (await import(url.pathToFileURL(`${nodePath}.js`))).default
            break

          case 'esm':
            if (!pjExists) await fs.writeFile(pjPath, '{"type": "module"}')
            testExports = await import(url.pathToFileURL(`${nodePath}.js`))
            break
        }

        // If this is an async test, run the async part
        if (options && options.async) {
          if (!(testExports.async instanceof Function))
            throw new Error('Expected async instanceof Function')
          await testExports.async()
        }

        // Clean up test output
        removeRecursiveSync(thisTestDir)
      }

      catch (e) {
        if (e && e.stderr !== void 0) {
          try {
            if (Array.isArray(expectedStderr)) {
              // An array of possible outputs (due to log output order non-determinism)
              if (!expectedStderr.includes(e.stderr))
                assert.strictEqual(e.stderr, expectedStderr[0]);
            } else {
              assert.strictEqual(e.stderr, expectedStderr);
            }

            // Clean up test output
            removeRecursiveSync(thisTestDir)
            continue;
          } catch (e2) {
            e = e2;
          }
        }
        console.error(`❌ test failed: ${e && e.message || e}
  dir: ${path.relative(dirname, thisTestDir)}
  args: ${modifiedArgs.join(' ')}
  files: ${Object.entries(files).map(([k, v]) => `\n    ${k}: ${JSON.stringify(v)}`).join('')}
`)
        return false
      }
    }

    return true
  }
}

// There's a feature where bundling without "outfile" or "outdir" writes to stdout instead
function testStdout(input, args, callback) {
  return async () => {
    const thisTestDir = path.join(testDir, '' + testCount++)

    try {
      await fs.mkdir(thisTestDir, { recursive: true })
      const inputFile = path.join(thisTestDir, 'example.js')
      await fs.writeFile(inputFile, input)

      // Run whatever check the caller is doing
      await callback(async () => {
        const { stdout } = await execFileAsync(
          esbuildPath, [inputFile, '--log-level=warning'].concat(args), { cwd: thisTestDir, stdio: 'pipe' })
        return stdout
      })

      // Clean up test output
      removeRecursiveSync(thisTestDir)
    } catch (e) {
      console.error(`❌ test failed: ${e && e.message || e}
  dir: ${path.relative(dirname, thisTestDir)}`)
      return false
    }

    return true
  }
}

function testWatch(options, callback) {
  return async () => {
    const thisTestDir = path.join(testDir, '' + testCount++)
    const infile = path.join(thisTestDir, 'in.js')
    const outdir = path.join(thisTestDir, 'out')
    const outfile = path.join(outdir, path.basename(infile))
    const args = ['--watch=forever', infile, '--outdir=' + outdir, '--color'].concat(options.args || [])
    let metafile
    let mangleCache

    if (options.metafile) {
      metafile = path.join(thisTestDir, 'meta.json')
      args.push('--metafile=' + metafile)
    }

    if (options.mangleCache) {
      mangleCache = path.join(thisTestDir, 'mangle.json')
      args.push('--mangle-cache=' + mangleCache)
    }

    let stderrPromise
    try {
      await fs.mkdir(thisTestDir, { recursive: true })
      const maxSeconds = 60

      // Start the child
      const child = childProcess.spawn(esbuildPath, args, {
        cwd: thisTestDir,
        stdio: ['inherit', 'inherit', 'pipe'],
        timeout: maxSeconds * 1000,
      })

      // Make sure the child is always killed
      try {
        // Buffer stderr in case we need it
        const stderr = []
        child.stderr.on('data', data => stderr.push(data))
        const exitPromise = new Promise((_, reject) => {
          child.on('close', code => reject(new Error(`Child "esbuild" process exited with code ${code}`)))
        })
        stderrPromise = new Promise(resolve => {
          child.stderr.on('end', () => resolve(Buffer.concat(stderr).toString()))
        })

        // Run whatever check the caller is doing
        let timeout
        await Promise.race([
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`Timeout of ${maxSeconds} seconds exceeded`)), maxSeconds * 1000)
          }),
          exitPromise,
          callback({
            infile,
            outfile,
            metafile,
            mangleCache,
          }),
        ])
        clearTimeout(timeout)

        // Clean up test output
        removeRecursiveSync(thisTestDir)
      } finally {
        child.kill()
      }
    } catch (e) {
      let stderr = stderrPromise ? '\n  stderr:' + ('\n' + await stderrPromise).split('\n').join('\n    ') : ''
      console.error(`❌ test failed: ${e && e.message || e}
  dir: ${path.relative(dirname, thisTestDir)}
  args: ${args.join(' ')}` + stderr)
      return false
    }

    return true
  }
}

function testWatchStdout(sequence) {
  return async () => {
    const thisTestDir = path.join(testDir, '' + testCount++)
    const infile = path.join(thisTestDir, 'in.js')
    const args = ['--watch=forever', infile]

    try {
      await fs.mkdir(thisTestDir, { recursive: true })
      await fs.writeFile(infile, sequence[0].input)
      const maxSeconds = 60

      // Start the child
      const child = childProcess.spawn(esbuildPath, args, {
        cwd: thisTestDir,
        stdio: ['inherit', 'pipe', 'pipe'],
        timeout: maxSeconds * 1000,
      })

      // Make sure the child is always killed
      try {
        for (const { input, stdout: expectedStdout, stderr: expectedStderr } of sequence) {
          let totalStdout = ''
          let totalStderr = ''
          let stdoutBuffer = ''
          let stderrBuffer = ''
          const onstdout = data => {
            totalStdout += data
            stdoutBuffer += data
            check()
          }
          const onstderr = data => {
            totalStderr += data
            stderrBuffer += data
            check()
          }
          let check = () => { }

          child.stdout.on('data', onstdout)
          child.stderr.on('data', onstderr)

          await new Promise((resolve, reject) => {
            const seconds = 30
            const timeout = setTimeout(() => reject(new Error(
              `Watch mode + stdout test failed to match expected output after ${seconds} seconds
  input: ${JSON.stringify(input)}
  stdout: ${JSON.stringify(totalStdout)}
  stderr: ${JSON.stringify(totalStderr)}
`)), seconds * 1000)

            check = () => {
              let index

              while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
                const line = stdoutBuffer.slice(0, index)
                stdoutBuffer = stdoutBuffer.slice(index + 1)
                if (line === expectedStdout[0]) expectedStdout.shift()
              }

              while ((index = stderrBuffer.indexOf('\n')) >= 0) {
                const line = stderrBuffer.slice(0, index)
                stderrBuffer = stderrBuffer.slice(index + 1)
                if (line === expectedStderr[0]) expectedStderr.shift()
              }

              if (!expectedStdout.length && !expectedStderr.length) {
                clearTimeout(timeout)
                resolve()
              }
            }

            writeFileAtomic(infile, input)
          })

          child.stdout.off('data', onstdout)
          child.stderr.off('data', onstderr)
        }
      } finally {
        child.kill()
      }
    } catch (e) {
      console.error(`❌ test failed: ${e && e.message || e}
  dir: ${path.relative(dirname, thisTestDir)}
  args: ${args.join(' ')}`)
      return false
    }

    return true
  }
}

async function main() {
  // Create a fresh test directory
  removeRecursiveSync(testDir)
  await fs.mkdir(testDir, { recursive: true })

  // Run tests in batches so they work in CI, which has a limited memory ceiling
  let allTestsPassed = true
  let batch = 32
  for (let i = 0; i < tests.length; i += batch) {
    let promises = []
    for (let test of tests.slice(i, i + batch)) {
      let promise = test()
      promise.then(
        success => { if (!success) allTestsPassed = false },
        () => allTestsPassed = false,
      )
      promises.push(promise)
    }
    await Promise.all(promises)
  }

  if (!allTestsPassed) {
    console.error(`❌ end-to-end tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ end-to-end tests passed`)
    removeRecursiveSync(testDir)
  }
}

main()
