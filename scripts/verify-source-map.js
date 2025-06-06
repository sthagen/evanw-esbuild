const { SourceMapConsumer } = require('source-map')
const { buildBinary, removeRecursiveSync } = require('./esbuild')
const childProcess = require('child_process')
const path = require('path')
const util = require('util')
const url = require('url')
const fs = require('fs').promises

const execFileAsync = util.promisify(childProcess.execFile)

const esbuildPath = buildBinary()
const testDir = path.join(__dirname, '.verify-source-map')
let tempDirCount = 0

const toSearchBundle = {
  a0: 'a.js',
  a1: 'a.js',
  a2: 'a.js',
  b0: 'b-dir/b.js',
  b1: 'b-dir/b.js',
  b2: 'b-dir/b.js',
  c0: 'b-dir/c-dir/c.js',
  c1: 'b-dir/c-dir/c.js',
  c2: 'b-dir/c-dir/c.js',
}

const toSearchNoBundle = {
  a0: 'a.js',
  a1: 'a.js',
  a2: 'a.js',
}

const toSearchNoBundleTS = {
  a0: 'a.ts',
  a1: 'a.ts',
  a2: 'a.ts',
}

const testCaseES6 = {
  'a.js': `
    import {b0} from './b-dir/b'
    function a0() { a1("a0") }
    function a1() { a2("a1") }
    function a2() { b0("a2") }
    a0()
  `,
  'b-dir/b.js': `
    import {c0} from './c-dir/c'
    export function b0() { b1("b0") }
    function b1() { b2("b1") }
    function b2() { c0("b2") }
  `,
  'b-dir/c-dir/c.js': `
    export function c0() { c1("c0") }
    function c1() { c2("c1") }
    function c2() { throw new Error("c2") }
  `,
}

const testCaseCommonJS = {
  'a.js': `
    const {b0} = require('./b-dir/b')
    function a0() { a1("a0") }
    function a1() { a2("a1") }
    function a2() { b0("a2") }
    a0()
  `,
  'b-dir/b.js': `
    const {c0} = require('./c-dir/c')
    exports.b0 = function() { b1("b0") }
    function b1() { b2("b1") }
    function b2() { c0("b2") }
  `,
  'b-dir/c-dir/c.js': `
    exports.c0 = function() { c1("c0") }
    function c1() { c2("c1") }
    function c2() { throw new Error("c2") }
  `,
}

const testCaseDiscontiguous = {
  'a.js': `
    import {b0} from './b-dir/b.js'
    import {c0} from './b-dir/c-dir/c.js'
    function a0() { a1("a0") }
    function a1() { a2("a1") }
    function a2() { b0("a2") }
    a0(b0, c0)
  `,
  'b-dir/b.js': `
    exports.b0 = function() { b1("b0") }
    function b1() { b2("b1") }
    function b2() { c0("b2") }
  `,
  'b-dir/c-dir/c.js': `
    export function c0() { c1("c0") }
    function c1() { c2("c1") }
    function c2() { throw new Error("c2") }
  `,
}

const testCaseTypeScriptRuntime = {
  'a.ts': `
    namespace Foo {
      export var {a, ...b} = foo() // This requires a runtime function to handle
      console.log(a, b)
    }
    function a0() { a1("a0") }
    function a1() { a2("a1") }
    function a2() { throw new Error("a2") }
    a0()
  `,
}

const testCaseStdin = {
  '<stdin>': `#!/usr/bin/env node
    function a0() { a1("a0") }
    function a1() { a2("a1") }
    function a2() { throw new Error("a2") }
    a0()
  `,
}

const testCaseEmptyFile = {
  'entry.js': `
    import './before'
    import {fn} from './re-export'
    import './after'
    fn()
  `,
  're-export.js': `
    // This file will be empty in the generated code, which was causing
    // an off-by-one error with the source index in the source map
    export {default as fn} from './test'
  `,
  'test.js': `
    export default function() {
      console.log("test")
    }
  `,
  'before.js': `
    console.log("before")
  `,
  'after.js': `
    console.log("after")
  `,
}

const toSearchEmptyFile = {
  before: 'before.js',
  test: 'test.js',
  after: 'after.js',
}

const testCaseNonJavaScriptFile = {
  'entry.js': `
    import './before'
    import text from './file.txt'
    import './after'
    console.log(text)
  `,
  'file.txt': `
    This is some text.
  `,
  'before.js': `
    console.log("before")
  `,
  'after.js': `
    console.log("after")
  `,
}

const toSearchNonJavaScriptFile = {
  before: 'before.js',
  after: 'after.js',
}

const testCaseCodeSplitting = {
  'out.ts': `
    import value from './shared'
    console.log("out", value)
  `,
  'other.ts': `
    import value from './shared'
    console.log("other", value)
  `,
  'shared.ts': `
    export default 123
  `,
}

const toSearchCodeSplitting = {
  out: 'out.ts',
}

const testCaseCodeSplittingEmptyFile = {
  'entry1.ts': `
    import './a.ts'
    import './empty.ts'
    import './b.ts'
  `,
  'entry2.ts': `
    import './a.ts'
    import './empty.ts'
    import './b.ts'
  `,
  'a.ts': `'foo'.print()`,
  'empty.ts': `//! @preserve`,
  'b.ts': `'bar'.print()`,
}

const toSearchCodeSplittingEmptyFile = {
  foo: 'a.ts',
  bar: 'b.ts',
}

const testCaseUnicode = {
  'entry.js': `
    import './a'
    import './b'
  `,
  'a.js': `
    console.log('🍕🍕🍕', "a")
  `,
  'b.js': `
    console.log({𐀀: "b"})
  `,
}

const toSearchUnicode = {
  a: 'a.js',
  b: 'b.js',
}

const testCasePartialMappings = {
  // The "mappings" value is "A,Q,I;A,Q,I;A,Q,I;AAMA,QAAQ,IAAI;" which contains
  // partial mappings without original locations. This used to throw things off.
  'entry.js': `console.log(1);
console.log(2);
console.log(3);
console.log("entry");
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKIC` +
    `Aic291cmNlcyI6IFsiZW50cnkuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnNvb` +
    `GUubG9nKDEpXG5cbmNvbnNvbGUubG9nKDIpXG5cbmNvbnNvbGUubG9nKDMpXG5cbmNvbnNv` +
    `bGUubG9nKFwiZW50cnlcIilcbiJdLAogICJtYXBwaW5ncyI6ICJBLFEsSTtBLFEsSTtBLFE` +
    `sSTtBQU1BLFFBQVEsSUFBSTsiLAogICJuYW1lcyI6IFtdCn0=
`,
}

const testCasePartialMappingsPercentEscape = {
  // The "mappings" value is "A,Q,I;A,Q,I;A,Q,I;AAMA,QAAQ,IAAI;" which contains
  // partial mappings without original locations. This used to throw things off.
  'entry.js': `console.log(1);
console.log(2);
console.log(3);
console.log("entry");
//# sourceMappingURL=data:,%7B%22version%22%3A3%2C%22sources%22%3A%5B%22entr` +
    `y.js%22%5D%2C%22sourcesContent%22%3A%5B%22console.log(1)%5Cn%5Cnconsole` +
    `.log(2)%5Cn%5Cnconsole.log(3)%5Cn%5Cnconsole.log(%5C%22entry%5C%22)%5Cn` +
    `%22%5D%2C%22mappings%22%3A%22A%2CQ%2CI%3BA%2CQ%2CI%3BA%2CQ%2CI%3BAAMA%2` +
    `CQAAQ%2CIAAI%3B%22%2C%22names%22%3A%5B%5D%7D
`,
}

const toSearchPartialMappings = {
  entry: 'entry.js',
}

const testCaseComplex = {
  // "fuse.js" is included because it has a nested source map of some complexity.
  // "react" is included after that because it's a big blob of code and helps
  // make sure stuff after a nested source map works ok.
  'entry.js': `
    import Fuse from 'fuse.js'
    import * as React from 'react'
    console.log(Fuse, React)
  `,
}

const toSearchComplex = {
  '[object Array]': 'webpack:///src/helpers/is_array.js',
  'Score average:': 'webpack:///src/index.js',
  '0123456789': '../../node_modules/object-assign/index.js',
  'forceUpdate': '../../node_modules/react/cjs/react.production.min.js',
};

const testCaseDynamicImport = {
  'entry.js': `
    const then = (x) => console.log("imported", x);
    console.log([import("./ext/a.js").then(then), import("./ext/ab.js").then(then), import("./ext/abc.js").then(then)]);
    console.log([import("./ext/abc.js").then(then), import("./ext/ab.js").then(then), import("./ext/a.js").then(then)]);
  `,
  'ext/a.js': `
    export default 'a'
  `,
  'ext/ab.js': `
    export default 'ab'
  `,
  'ext/abc.js': `
    export default 'abc'
  `,
}

const toSearchDynamicImport = {
  './ext/a.js': 'entry.js',
  './ext/ab.js': 'entry.js',
  './ext/abc.js': 'entry.js',
};

const toSearchBundleCSS = {
  a0: 'a.css',
  a1: 'a.css',
  a2: 'a.css',
  b0: 'b-dir/b.css',
  b1: 'b-dir/b.css',
  b2: 'b-dir/b.css',
  c0: 'b-dir/c-dir/c.css',
  c1: 'b-dir/c-dir/c.css',
  c2: 'b-dir/c-dir/c.css',
}

const testCaseBundleCSS = {
  'entry.css': `
    @import "a.css";
  `,
  'a.css': `
    @import "b-dir/b.css";
    a:nth-child(0):after { content: "a0"; }
    a:nth-child(1):after { content: "a1"; }
    a:nth-child(2):after { content: "a2"; }
  `,
  'b-dir/b.css': `
    @import "c-dir/c.css";
    b:nth-child(0):after { content: "b0"; }
    b:nth-child(1):after { content: "b1"; }
    b:nth-child(2):after { content: "b2"; }
  `,
  'b-dir/c-dir/c.css': `
    c:nth-child(0):after { content: "c0"; }
    c:nth-child(1):after { content: "c1"; }
    c:nth-child(2):after { content: "c2"; }
  `,
}

const testCaseJSXRuntime = {
  'entry.jsx': `
    import { A0, A1, A2 } from './a.jsx';
    console.log(<A0><A1/><A2/></A0>)
  `,
  'a.jsx': `
    import {jsx} from './b-dir/b'
    import {Fragment} from './b-dir/c-dir/c'
    export function A0() { return <Fragment id="A0"><>a0</></Fragment> }
    export function A1() { return <div {...jsx} data-testid="A1">a1</div> }
    export function A2() { return <A1 id="A2"><a/><b/></A1> }
  `,
  'b-dir/b.js': `
    export const jsx = {id: 'jsx'}
  `,
  'b-dir/c-dir/c.jsx': `
    exports.Fragment = function() { return <></> }
  `,
}

const toSearchJSXRuntime = {
  A0: 'a.jsx',
  A1: 'a.jsx',
  A2: 'a.jsx',
  jsx: 'b-dir/b.js',
}

const testCaseNames = {
  'entry.js': `
    import "./nested1"

    // Test regular name positions
    var /**/foo = /**/foo || 0
    function /**/fn(/**/bar) {}
    class /**/cls {}
    keep(fn, cls) // Make sure these aren't removed

    // Test property mangling name positions
    var { /**/mangle_: bar } = foo
    var { /**/'mangle_': bar } = foo
    foo./**/mangle_ = 1
    foo[/**/'mangle_']
    foo = { /**/mangle_: 0 }
    foo = { /**/'mangle_': 0 }
    foo = class { /**/mangle_ = 0 }
    foo = class { /**/'mangle_' = 0 }
    foo = /**/'mangle_' in bar
  `,
  'nested1.js': `
    import { foo } from './nested2'
    foo(bar)
  `,
  'nested2.jsx': `
    export let /**/foo = /**/bar => /**/bar()
  `
}

const testCaseMissingSourcesContent = {
  'foo.js': `// foo.ts
var foo = { bar: "bar" };
console.log({ foo });
//# sourceMappingURL=maps/foo.js.map
`,
  'maps/foo.js.map': `{
  "version": 3,
  "sources": ["src/foo.ts"],
  "mappings": ";AAGA,IAAM,MAAW,EAAE,KAAK,MAAM;AAC9B,QAAQ,IAAI,EAAE,IAAI,CAAC;",
  "names": []
}
`,
  'maps/src/foo.ts': `interface Foo {
  bar: string
}
const foo: Foo = { bar: 'bar' }
console.log({ foo })
`,
}

const toSearchMissingSourcesContent = {
  bar: 'maps/src/foo.ts',
}

// The "null" should be filled in by the contents of "bar.ts"
const testCaseNullSourcesContent = {
  'entry.js': `import './foo.js'\n`,
  'foo.ts': `import './bar.ts'\nconsole.log("foo")`,
  'bar.ts': `console.log("bar")\n`,
  'foo.js': `(() => {
  // bar.ts
  console.log("bar");

  // foo.ts
  console.log("foo");
})();
//# sourceMappingURL=foo.js.map
`,
  'foo.js.map': `{
  "version": 3,
  "sources": ["bar.ts", "foo.ts"],
  "sourcesContent": [null, "import './bar.ts'\\nconsole.log(\\"foo\\")"],
  "mappings": ";;AAAA,UAAQ,IAAI,KAAK;;;ACCjB,UAAQ,IAAI,KAAK;",
  "names": []
}
`,
}

const toSearchNullSourcesContent = {
  bar: 'bar.ts',
}

const testCaseFileNameWithSpaces = {
  'file name with spaces.js': `console . log ( "test" )`,
}

const toSearchFileNameWithSpaces = {
  test: 'file name with spaces.js',
}

const testCaseAbsoluteSourceMappingURL = {
  'entry.js': `console.log("test");
//# sourceMappingURL={ABSOLUTE_FILE_URL}/entry.js.map
`,
  'entry.js.map': `{
  "version": 3,
  "sources": ["input.js"],
  "sourcesContent": ["console . log ( \\\"test\\\" )"],
  "mappings": "AAAA,QAAU,IAAM,MAAO;",
  "names": []
}
`,
}

const toSearchAbsoluteSourceMappingURL = {
  test: 'input.js',
}

const testCaseAbsoluteSourcesURL = {
  'entry.js': `console.log("test");
//# sourceMappingURL=entry.js.map
`,
  'entry.js.map': `{
  "version": 3,
  "sources": ["{ABSOLUTE_FILE_URL}/input.js"],
  "sourcesContent": ["console . log ( \\\"test\\\" )"],
  "mappings": "AAAA,QAAU,IAAM,MAAO;",
  "names": []
}
`,
}

const toSearchAbsoluteSourcesURL = {
  test: 'input.js',
}

// This test case was generated using the "shadow-cljs" tool by someone who has
// no idea how to write Clojure code (i.e. me). See the following GitHub issue
// for more details: https://github.com/evanw/esbuild/issues/3439
//
// Note that the mappings in the Clojure output strangely seem to be really
// buggy. Many sub-expressions with two operands map the operands switched,
// strings are way off, and there's even one mapping that's floating off in
// space past the end of the line. This appears to just be bad output from the
// Clojure tooling itself though, and not a problem with esbuild.
//
// For the example code below, I manually edited the mapping for the "done"
// string to line up correctly so that this test can pass (it was off by
// five lines).
const testCaseIndexSourceMap = {
  'entry.js': `
    import './app.main.js'
    console.log('testing')
  `,
  'app.main.js': `export const $APP = {};
export const shadow$provide = {};
export const $jscomp = {};
/*

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/
console.log(function $app$lib$log_many$$($G__6268$jscomp$1_i$jscomp$282$$, $collection$$) {
  return $G__6268$jscomp$1_i$jscomp$282$$ < $collection$$.length ? (console.` +
    `log($collection$$.at($G__6268$jscomp$1_i$jscomp$282$$)), $G__6268$jscom` +
    `p$1_i$jscomp$282$$ += 1, $app$lib$log_many$$.$cljs$core$IFn$_invoke$ari` +
    `ty$2$ ? $app$lib$log_many$$.$cljs$core$IFn$_invoke$arity$2$($G__6268$js` +
    `comp$1_i$jscomp$282$$, $collection$$) : $app$lib$log_many$$.call(null, ` +
    `$G__6268$jscomp$1_i$jscomp$282$$, $collection$$)) : "done";
}(0, Object.keys(console)));
export const render = {}.render;

//# sourceMappingURL=app.main.js.map`,
  'app.main.js.map': `{"version":3,"file":"app.main.js","sections":[{"offset` +
    `":{"line":3,"column":0},"map":{"version":3,"file":"app.main.js","lineCo` +
    `unt":10,"mappings":"A;;;;;AAGMA,OAAAA,CAAAA,GAAAA,CCDAC,QAAAA,oBAAAA,CA` +
    `AUC,gCAAVD,EAAYE,aAAZF,CAAYE;AAAlB,SACSD,gCADT,GACWC,aAAUA,CAAAA,MADrB,` +
    `IAGYH,OAAAA,CAAAA,GAAAA,CAAgBG,aAAAA,CAAAA,EAAAA,CAAWD,gCAAXC,CAAhBH,CA` +
    `CN,EAAUE,gCAAV,IAAaA,CAAb,EAAAE,mBAAAC,CAAAA,+BAAA,GAAAD,mBAAAC,CAAAA,+` +
    `BAAA,CAAAC,gCAAA,EAAkBH,aAAlB,CAAA,GAAAI,mBAAAA,CAAAA,IAAAA,CAAAA,IAAAA` +
    `,EAAAD,gCAAAC,EAAkBJ,aAAlBI,CAJN,IAKI,MALJ;AAAkBJ,CDCD,CAACF,CAAD,EAAgB` +
    `O,MAAOC,CAAAA,IAAP,CAAiBT,OAAjB,CAAhB,CAAXA,CAAAA;AEFN,sBFDkBU,EECaC,CA` +
    `AAA,MAA/B;;","sources":["app/app.cljs","app/lib.cljs","shadow/module/ap` +
    `p.main/append.js"],"sourcesContent":["(ns app.app\\n  (:require [app.li` +
    `b :as lib]))\\n\\n(.log js/console (lib/log-many 0 (.keys js/Object js/` +
    `console)))\\n","(ns app.lib)\\n\\n(defn log-many [i collection]\\n  (if` +
    ` (< i (.-length collection))\\n    (do\\n      (.log js/console (.at co` +
    `llection i))\\n      (log-many (+ i 1) collection))\\n    \\"done\\"))` +
    `\\n","\\nshadow$export(\\"render\\",app.app.render);"],"names":["js/con` +
    `sole","app.lib/log-many","i","collection","app.lib.log_manycljs$core$IF` +
    `n$_invoke$arity$2","cljs$core$IFn$_invoke$arity$2","G__6268","G__6269",` +
    `"Object","js/Object","app.apprender","render"],"x_google_ignoreList":[2` +
    `]}}]}`,
}

const toSearchIndexSourceMap = {
  'done': 'app/lib.cljs',
}

// This case covers a crash when esbuild would generate an invalid source map
// containing a mapping with an index of a source that's out of bounds of the
// "sources" array. This happened when generating the namespace exports chunk
// which in this case is triggered by "export * as it from". For more
// information, see: https://github.com/evanw/esbuild/issues/4080
const testCaseNullMappingIssue4080 = {
  'foo.js': `// foo.js
here.is.some.code = "foo!";
//# sourceMappingURL=foo.js.map
`,
  'foo.js.map': `{
  "version": 3,
  "sources": ["./src/foo.js"],
  "sourcesContent": ["here\\n  .is\\n  .some\\n  .code\\n  = 'foo!'\\n"],
  "mappings": ";AAAA,KACG,GACA,KACA,OACC;",
  "names": []
}`,
  'bar.js': `// bar.js
here.is.some.more.code = "bar!";
//# sourceMappingURL=bar.js.map
`,
  'bar.js.map': `{
  "version": 3,
  "sources": ["./src/bar.js"],
  "sourcesContent": ["here\\n  .is.some.more\\n  .code\\n  = 'bar!'\\n"],
  "mappings": ";AAAA,KACG,GAAG,KAAK,KACR,OACC;",
  "names": []
}`,
  'core.js': `// core.js
import "./bar.js";

// lib.js
var value = "lib!";
export {
  value
};
//# sourceMappingURL=core.js.map
`,
  'core.js.map': `{
  "version": 3,
  "sources": ["./src/core.js", "./src/lib.js"],
  "sourcesContent": ["import './bar.js'\\nexport { value } from './lib.js'\\n", "export const value = 'lib!'\\n"],
  "mappings": ";AAAA,OAAO;;;ACAA,IAAM,QAAQ;",
  "names": []
}`,
  'entry.js': `import './foo.js'
export * as it from './core.js'
`,
}

const toSearchNullMappingIssue4080 = {
  'foo!': 'src/foo.js',
  'bar!': 'src/bar.js',
  'lib!': 'src/lib.js',
}

const testCaseNestedFoldersIssue4070 = {
  'src/main.js': `import { appConfig } from "./app/app.config";
appConfig("foo");
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKIC` +
    `Aic291cmNlcyI6IFsibWFpbi5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0I` +
    `HsgYXBwQ29uZmlnIH0gZnJvbSBcIi4vYXBwL2FwcC5jb25maWdcIjtcbmFwcENvbmZpZyhc` +
    `ImZvb1wiKTsiXSwKICAibWFwcGluZ3MiOiAiQUFBQSxTQUFTLGlCQUFpQjtBQUMxQixVQUF` +
    `VLEtBQUs7IiwKICAibmFtZXMiOiBbXQp9Cg==`,
  'src/app/app.config.js': `export const appConfig = (x) => console.log(x, "bar");
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKIC` +
    `Aic291cmNlcyI6IFsiYXBwLmNvbmZpZy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZ` +
    `Xhwb3J0IGNvbnN0IGFwcENvbmZpZyA9IHggPT4gY29uc29sZS5sb2coeCwgXCJiYXJcIik7` +
    `Il0sCiAgIm1hcHBpbmdzIjogIkFBQU8sYUFBTSxZQUFZLE9BQUssUUFBUSxJQUFJLEdBQUc` +
    `sS0FBSzsiLAogICJuYW1lcyI6IFtdCn0K`,
}

const toSearchNestedFoldersIssue4070 = {
  'foo': 'src/main.js',
  'bar': 'src/app/app.config.js',
}

// This test checks what happens when you use absolute paths in inlined source
// maps. This is done two ways, first using a "file://" URL and second using
// an actual absolute path.
//
// Only the first way is supposed to be valid, at least according to the formal
// specification (https://tc39.es/ecma426/) which says that each source is "a
// string that is a (potentially relative) URL".
//
// However, for a long time source maps was poorly-specified. The old source map
// specification (https://sourcemaps.info/spec.html) only says "sources" is "a
// list of original sources used by the mappings entry".
//
// So it makes sense that software which predates the formal specification of
// source maps might fill in the sources array with absolute file paths instead
// of URLs. So we test for that here to make sure esbuild works either way.
//
// Windows paths make this complicated. Here are all five possible combinations
// of absolute paths for the file "folder/file.js":
//
// - Unix URL: "file:///folder/file.js"
// - Unix path: "/folder/file.js"
// - Windows URL: "file:///C:/folder/file.js"
// - Windows path v1: "C:/folder/file.js" (not covered here)
// - Windows path v2: "C:\folder\file.js"
//
const rootDir = path.dirname(process.cwd().split(path.sep).slice(0, 2).join(path.sep))
const pathIssue4075 = path.join(rootDir, 'out', 'src', 'styles')
const urlIssue4075 = url.pathToFileURL(pathIssue4075)
const urlIssue4075Encoded = encodeURIComponent(JSON.stringify(urlIssue4075 + '1.scss'))
const pathIssue4075Encoded = encodeURIComponent(JSON.stringify(pathIssue4075 + '2.scss'))
const testCaseAbsolutePathIssue4075 = {
  'entry.css': `
    @import "./styles1.css";
    @import "./styles2.css";
  `,
  'styles1.css': `/* You can add global styles to this file, and also import other style files */
* {
  content: "foo";
}

/*# sourceMappingURL=data:application/json;charset=utf-8,%7B%22version%22:3,` +
    `%22sourceRoot%22:%22%22,%22sources%22:%5B${urlIssue4075Encoded}%5D,%22n` +
    `ames%22:%5B%5D,%22mappings%22:%22AAAA;AACA;EACE,SAAS%22,%22file%22:%22o` +
    `ut%22,%22sourcesContent%22:%5B%22/*%20You%20can%20add%20global%20styles` +
    `%20to%20this%20file,%20and%20also%20import%20other%20style%20files%20%2` +
    `A/%5Cn*%20%7B%5Cn%20%20content:%20%5C%22foo%5C%22%5Cn%7D%5Cn%22%5D%7D */`,
  'styles2.css': `/* You can add global styles to this file, and also import other style files */
* {
  content: "bar";
}

/*# sourceMappingURL=data:application/json;charset=utf-8,%7B%22version%22:3,` +
    `%22sourceRoot%22:%22%22,%22sources%22:%5B${pathIssue4075Encoded}%5D,%22` +
    `names%22:%5B%5D,%22mappings%22:%22AAAA;AACA;EACE,SAAS%22,%22file%22:%22` +
    `out%22,%22sourcesContent%22:%5B%22/*%20You%20can%20add%20global%20style` +
    `s%20to%20this%20file,%20and%20also%20import%20other%20style%20files%20%` +
    `2A/%5Cn*%20%7B%5Cn%20%20content:%20%5C%22bar%5C%22%5Cn%7D%5Cn%22%5D%7D */`,
}

const toSearchAbsolutePathIssue4075 = {
  foo: path.relative(path.join(testDir, '(this test)'), pathIssue4075 + '1.scss').replaceAll('\\', '/'),
  bar: path.relative(path.join(testDir, '(this test)'), pathIssue4075 + '2.scss').replaceAll('\\', '/'),
}

const testCaseMissingSourcesIssue4104 = {
  'entry.js': `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.js';

bootstrapApplication(AppComponent)
  .catch((err) => console.error(err));`,
  'app.component.html': `<div>`,
  'app.js': `import { __decorate } from "tslib";
import __NG_CLI_RESOURCE__0 from "./app.component.html";
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
let AppComponent = class AppComponent {
    title = 'ng19-sourcemap-repro';
    onClick() {
        debugger;
    }
};
AppComponent = __decorate([
    Component({
        selector: 'app-root',
        imports: [RouterOutlet],
        template: __NG_CLI_RESOURCE__0,
    })
], AppComponent);
export { AppComponent };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIj` +
    `oiYXBwLmNvbXBvbmVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFwcC5jb` +
    `21wb25lbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxPQUFPLEVBQUUs` +
    `U0FBUyxFQUFFLE1BQU0sZUFBZSxDQUFDO0FBQzFDLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUF` +
    `BTSxpQkFBaUIsQ0FBQztBQU94QyxJQUFNLFlBQVksR0FBbEIsTUFBTSxZQUFZO0lBQ3ZCLE` +
    `tBQUssR0FBRyxzQkFBc0IsQ0FBQztJQUUvQixPQUFPO1FBQ0wsUUFBUSxDQUFDO0lBQ1gsQ` +
    `0FBQztDQUNGLENBQUE7QUFOWSxZQUFZO0lBTHhCLFNBQVMsQ0FBQztRQUNULFFBQVEsRUFB` +
    `RSxVQUFVO1FBQ3BCLE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQztRQUN2Qiw4QkFBbUM7S0F` +
    `DcEMsQ0FBQztHQUNXLFlBQVksQ0FNeEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgey` +
    `BDb21wb25lbnQgfSBmcm9tICdAYW5ndWxhci9jb3JlJztcbmltcG9ydCB7IFJvdXRlck91d` +
    `GxldCB9IGZyb20gJ0Bhbmd1bGFyL3JvdXRlcic7XG5cbkBDb21wb25lbnQoe1xuICBzZWxl` +
    `Y3RvcjogJ2FwcC1yb290JyxcbiAgaW1wb3J0czogW1JvdXRlck91dGxldF0sXG4gIHRlbXB` +
    `sYXRlVXJsOiAnLi9hcHAuY29tcG9uZW50Lmh0bWwnLFxufSlcbmV4cG9ydCBjbGFzcyBBcH` +
    `BDb21wb25lbnQge1xuICB0aXRsZSA9ICduZzE5LXNvdXJjZW1hcC1yZXBybyc7XG5cbiAgb` +
    `25DbGljaygpIHtcbiAgICBkZWJ1Z2dlcjtcbiAgfVxufVxuIl19`,
}

const toSearchMissingSourcesIssue4104 = {
  '@angular/platform-browser': 'entry.js',
  '@angular/core': 'app.component.ts',
  'ng19-sourcemap-repro': 'app.component.ts',
  'app-root': 'app.component.ts',
}

const testCaseDefineWithObjectIssue4169 = {
  'entry.js': `console.log(OBJECT, ARRAY);`,
}

const toSearchDefineWithObjectIssue4169 = {
  'test object': '<define:OBJECT>',
  'test array': '<define:ARRAY>',
}

async function check(kind, testCase, toSearch, { outfile, flags, entryPoints, crlf, followUpFlags = [], checkFirstChunk }) {
  let failed = 0

  try {
    const recordCheck = (success, message) => {
      if (!success) {
        failed++
        console.error(`❌ [${kind}] ${message}`)
      }
    }

    const tempDir = path.join(testDir, `${kind}-${tempDirCount++}`)
    await fs.mkdir(tempDir, { recursive: true })

    for (const name in testCase) {
      if (name !== '<stdin>') {
        const tempPath = path.join(tempDir, name)
        let code = testCase[name]

        // Make it possible to test absolute "file://" URLs
        code = code.replace('{ABSOLUTE_FILE_URL}', url.pathToFileURL(tempDir).href)

        await fs.mkdir(path.dirname(tempPath), { recursive: true })
        if (crlf) code = code.replace(/\n/g, '\r\n')
        await fs.writeFile(tempPath, code)
      }
    }

    if (outfile && !flags.some(flag => flag.startsWith('--outdir='))) flags.push('--outfile=' + outfile)
    const args = ['--sourcemap', '--log-level=warning'].concat(flags)
    const isStdin = '<stdin>' in testCase
    let stdout = ''

    await new Promise((resolve, reject) => {
      args.unshift(...entryPoints)
      const child = childProcess.spawn(esbuildPath, args, { cwd: tempDir, stdio: ['pipe', 'pipe', 'inherit'] })
      if (isStdin) child.stdin.write(testCase['<stdin>'])
      child.stdin.end()
      child.stdout.on('data', chunk => stdout += chunk.toString())
      child.stdout.on('end', resolve)
      child.on('error', reject)
    })

    let outCode
    let outCodeMap

    // Optionally check the first chunk when splitting
    if (checkFirstChunk && flags.includes('--splitting')) {
      const entries = await fs.readdir(tempDir)
      for (const entry of entries.sort()) {
        if (entry.startsWith('chunk-')) {
          outfile = entry
          break
        }
      }
    }

    if (isStdin) {
      outCode = stdout
      recordCheck(outCode.includes(`# sourceMappingURL=data:application/json;base64,`), `stdin must contain source map`)
      outCodeMap = Buffer.from(outCode.slice(outCode.indexOf('base64,') + 'base64,'.length).trim(), 'base64').toString()
    }

    else {
      outCode = await fs.readFile(path.join(tempDir, outfile), 'utf8')
      recordCheck(outCode.includes(`# sourceMappingURL=${encodeURIComponent(outfile)}.map`), `${outfile} file must link to ${outfile}.map`)
      outCodeMap = await fs.readFile(path.join(tempDir, `${outfile}.map`), 'utf8')
    }

    // Check the mapping of various key locations back to the original source
    const checkMap = (out, map) => {
      for (const id in toSearch) {
        const outIndex = out.indexOf(`"${id}"`)
        if (outIndex < 0) throw new Error(`Failed to find "${id}" in output`)
        const outLines = out.slice(0, outIndex).split('\n')
        const outLine = outLines.length
        const outLastLine = outLines[outLines.length - 1]
        let outColumn = outLastLine.length
        const { source, line, column } = map.originalPositionFor({ line: outLine, column: outColumn })

        const inSource = isStdin ? '<stdin>' : toSearch[id]
        recordCheck(decodeURI(source) === inSource, `expected source: ${inSource}, observed source: ${source}`)

        const inCode = map.sourceContentFor(source)
        if (inCode === null) throw new Error(`Got null for source content for "${source}"`)
        let inIndex = inCode.indexOf(`"${id}"`)
        if (inIndex < 0) inIndex = inCode.indexOf(`'${id}'`)
        if (inIndex < 0) throw new Error(`Failed to find "${id}" in input`)
        const inLines = inCode.slice(0, inIndex).split('\n')
        const inLine = inLines.length
        const inLastLine = inLines[inLines.length - 1]
        let inColumn = inLastLine.length

        const expected = JSON.stringify({ source, line: inLine, column: inColumn })
        const observed = JSON.stringify({ source, line, column })
        recordCheck(expected === observed, `expected original position: ${expected}, observed original position: ${observed}`)

        // Also check the reverse mapping
        const positions = map.allGeneratedPositionsFor({ source, line: inLine, column: inColumn })
        recordCheck(positions.length > 0, `expected generated positions: 1, observed generated positions: ${positions.length}`)
        let found = false
        for (const { line, column } of positions) {
          if (line === outLine && column === outColumn) {
            found = true
            break
          }
        }
        const expectedPosition = JSON.stringify({ line: outLine, column: outColumn })
        const observedPositions = JSON.stringify(positions)
        recordCheck(found, `expected generated position: ${expectedPosition}, observed generated positions: ${observedPositions}`)
      }
    }

    const sources = JSON.parse(outCodeMap).sources
    for (let source of sources) {
      if (sources.filter(s => s === source).length > 1) {
        throw new Error(`Duplicate source ${JSON.stringify(source)} found in source map`)
      }
    }

    const outMap = await new SourceMapConsumer(outCodeMap)
    checkMap(outCode, outMap)

    // Check that every generated location has an associated original position.
    // This only works when not bundling because bundling includes runtime code.
    if (flags.indexOf('--bundle') < 0) {
      // The last line doesn't have a source map entry, but that should be ok.
      const outLines = outCode.trimRight().split('\n');

      for (let outLine = 0; outLine < outLines.length; outLine++) {
        if (outLines[outLine].startsWith('#!') || outLines[outLine].startsWith('//')) {
          // Ignore the hashbang line and the source map comment itself
          continue;
        }

        for (let outColumn = 0; outColumn <= outLines[outLine].length; outColumn++) {
          const { line, column } = outMap.originalPositionFor({ line: outLine + 1, column: outColumn })
          recordCheck(line !== null && column !== null, `missing location for line ${outLine} and column ${outColumn}`)
        }
      }
    }

    // Bundle again to test nested source map chaining
    for (let order of [0, 1, 2]) {
      const infile = isStdin ? `stdout.js` : outfile
      const outfile2 = 'nested.' + infile
      const nestedEntry = path.join(tempDir, `nested-entry.${infile}`)
      if (isStdin) await fs.writeFile(path.join(tempDir, infile), outCode)
      await fs.writeFile(path.join(tempDir, `extra.${infile}`), `console.log('extra')`)
      const importKeyword = path.extname(infile) === '.css' ? '@import' : 'import'
      await fs.writeFile(nestedEntry,
        order === 1 ? `${importKeyword} './${infile}'; ${importKeyword} './extra.${infile}'` :
          order === 2 ? `${importKeyword} './extra.${infile}'; ${importKeyword} './${infile}'` :
            `${importKeyword} './${infile}'`)
      await execFileAsync(esbuildPath, [
        nestedEntry,
        '--bundle',
        '--outfile=' + path.join(tempDir, outfile2),
        '--sourcemap',
        '--format=esm',
      ].concat(followUpFlags), { cwd: testDir })

      const out2Code = await fs.readFile(path.join(tempDir, outfile2), 'utf8')
      recordCheck(out2Code.includes(`# sourceMappingURL=${encodeURIComponent(outfile2)}.map`), `${outfile2} file must link to ${outfile2}.map`)
      const out2CodeMap = await fs.readFile(path.join(tempDir, `${outfile2}.map`), 'utf8')

      const out2Map = await new SourceMapConsumer(out2CodeMap)
      checkMap(out2Code, out2Map)
    }

    if (!failed) removeRecursiveSync(tempDir)
  }

  catch (e) {
    console.error(`❌ [${kind}] ${e && e.message || e}`)
    failed++
  }

  return failed
}

async function checkNames(kind, testCase, { outfile, flags, entryPoints, crlf }) {
  let failed = 0

  try {
    const recordCheck = (success, message) => {
      if (!success) {
        failed++
        console.error(`❌ [${kind}] ${message}`)
      }
    }

    const tempDir = path.join(testDir, `${kind}-${tempDirCount++}`)
    await fs.mkdir(tempDir, { recursive: true })

    for (const name in testCase) {
      const tempPath = path.join(tempDir, name)
      let code = testCase[name]
      await fs.mkdir(path.dirname(tempPath), { recursive: true })
      if (crlf) code = code.replace(/\n/g, '\r\n')
      await fs.writeFile(tempPath, code)
    }

    if (outfile) flags.push('--outfile=' + outfile)
    const args = ['--sourcemap', '--log-level=warning'].concat(flags)
    let stdout = ''

    await new Promise((resolve, reject) => {
      args.unshift(...entryPoints)
      const child = childProcess.spawn(esbuildPath, args, { cwd: tempDir, stdio: ['pipe', 'pipe', 'inherit'] })
      child.stdin.end()
      child.stdout.on('data', chunk => stdout += chunk.toString())
      child.stdout.on('end', resolve)
      child.on('error', reject)
    })

    const outCode = await fs.readFile(path.join(tempDir, outfile), 'utf8')
    recordCheck(outCode.includes(`# sourceMappingURL=${encodeURIComponent(outfile)}.map`), `${outfile} file must link to ${outfile}.map`)
    const outCodeMap = await fs.readFile(path.join(tempDir, `${outfile}.map`), 'utf8')

    // Check the mapping of various key locations back to the original source
    const checkMap = (out, map) => {
      const undoQuotes = x => `'"`.includes(x[0]) ? (0, eval)(x) : x.startsWith('(') ? x.slice(1, -1) : x
      const generatedLines = out.split(/\r\n|\r|\n/g)

      for (let i = 0; i < map.sources.length; i++) {
        const source = map.sources[i]
        const content = map.sourcesContent[i];
        let index = 0

        // The names for us to check are prefixed by "/**/" right before to mark them
        const parts = content.split(/(\/\*\*\/(?:\w+|'\w+'|"\w+"))/g)

        for (let j = 1; j < parts.length; j += 2) {
          const expectedName = undoQuotes(parts[j].slice(4))
          index += parts[j - 1].length

          const prefixLines = content.slice(0, index + 4).split(/\r\n|\r|\n/g)
          const line = prefixLines.length
          const column = prefixLines[prefixLines.length - 1].length
          index += parts[j].length

          // There may be multiple mappings if the expression is spread across
          // multiple lines. Check each one to see if any pass the checks.
          const allGenerated = map.allGeneratedPositionsFor({ source, line, column })
          for (let i = 0; i < allGenerated.length; i++) {
            const canSkip = i + 1 < allGenerated.length // Don't skip the last one
            const generated = allGenerated[i]
            const original = map.originalPositionFor(generated)
            if (canSkip && (original.source !== source || original.line !== line || original.column !== column)) continue
            recordCheck(original.source === source && original.line === line && original.column === column,
              `\n` +
              `\n  original position:               ${JSON.stringify({ source, line, column })}` +
              `\n  maps to generated position:      ${JSON.stringify(generated)}` +
              `\n  which maps to original position: ${JSON.stringify(original)}` +
              `\n`)

            if (original.source === source && original.line === line && original.column === column) {
              const generatedContentAfter = generatedLines[generated.line - 1].slice(generated.column)
              const matchAfter = /^(?:\w+|'\w+'|"\w+"|\(\w+\))/.exec(generatedContentAfter)
              if (canSkip && matchAfter === null) continue
              recordCheck(matchAfter !== null, `expected the identifier ${JSON.stringify(expectedName)} starting on line ${generated.line} here: ${generatedContentAfter.slice(0, 100)}`)

              if (matchAfter !== null) {
                const observedName = undoQuotes(matchAfter[0])
                if (canSkip && expectedName !== (original.name || observedName)) continue
                recordCheck(expectedName === (original.name || observedName),
                  `\n` +
                  `\n  generated position: ${JSON.stringify(generated)}` +
                  `\n  original position:  ${JSON.stringify(original)}` +
                  `\n` +
                  `\n  original name:  ${JSON.stringify(expectedName)}` +
                  `\n  generated name: ${JSON.stringify(observedName)}` +
                  `\n  mapping name:   ${JSON.stringify(original.name)}` +
                  `\n`)
              }
            }

            break
          }
        }
      }
    }

    const outMap = await new SourceMapConsumer(outCodeMap)
    checkMap(outCode, outMap)

    // Bundle again to test nested source map chaining
    for (let order of [0, 1, 2]) {
      const infile = outfile
      const outfile2 = 'nested.' + infile
      const nestedEntry = path.join(tempDir, `nested-entry.${infile}`)
      await fs.writeFile(path.join(tempDir, `extra.${infile}`), `console.log('extra')`)
      await fs.writeFile(nestedEntry,
        order === 1 ? `import './${infile}'; import './extra.${infile}'` :
          order === 2 ? `import './extra.${infile}'; import './${infile}'` :
            `import './${infile}'`)
      await execFileAsync(esbuildPath, [
        nestedEntry,
        '--bundle',
        '--outfile=' + path.join(tempDir, outfile2),
        '--sourcemap',
      ], { cwd: testDir })

      const out2Code = await fs.readFile(path.join(tempDir, outfile2), 'utf8')
      recordCheck(out2Code.includes(`# sourceMappingURL=${encodeURIComponent(outfile2)}.map`), `${outfile2} file must link to ${outfile2}.map`)
      const out2CodeMap = await fs.readFile(path.join(tempDir, `${outfile2}.map`), 'utf8')

      const out2Map = await new SourceMapConsumer(out2CodeMap)
      checkMap(out2Code, out2Map)
    }

    if (!failed) removeRecursiveSync(tempDir)
  }

  catch (e) {
    console.error(`❌ [${kind}] ${e && e.message || e}`)
    failed++
  }

  return failed
}

async function main() {
  const promises = []
  for (const crlf of [false, true]) {
    for (const minify of [false, true]) {
      const flags = minify ? ['--minify'] : []
      const suffix = (crlf ? '-crlf' : '') + (minify ? '-min' : '')
      promises.push(
        check('commonjs' + suffix, testCaseCommonJS, toSearchBundle, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['a.js'],
          crlf,
        }),
        check('es6' + suffix, testCaseES6, toSearchBundle, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['a.js'],
          crlf,
        }),
        check('discontiguous' + suffix, testCaseDiscontiguous, toSearchBundle, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['a.js'],
          crlf,
        }),
        check('ts' + suffix, testCaseTypeScriptRuntime, toSearchNoBundleTS, {
          outfile: 'out.js',
          flags,
          entryPoints: ['a.ts'],
          crlf,
        }),
        check('stdin-stdout' + suffix, testCaseStdin, toSearchNoBundle, {
          flags: flags.concat('--sourcefile=<stdin>'),
          entryPoints: [],
          crlf,
        }),
        check('empty' + suffix, testCaseEmptyFile, toSearchEmptyFile, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('non-js' + suffix, testCaseNonJavaScriptFile, toSearchNonJavaScriptFile, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('splitting' + suffix, testCaseCodeSplitting, toSearchCodeSplitting, {
          outfile: 'out.js',
          flags: flags.concat('--outdir=.', '--bundle', '--splitting', '--format=esm'),
          entryPoints: ['out.ts', 'other.ts'],
          crlf,
        }),
        check('unicode' + suffix, testCaseUnicode, toSearchUnicode, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--charset=utf8'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('unicode-globalName' + suffix, testCaseUnicode, toSearchUnicode, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--global-name=πππ', '--charset=utf8'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('dummy' + suffix, testCasePartialMappings, toSearchPartialMappings, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('dummy' + suffix, testCasePartialMappingsPercentEscape, toSearchPartialMappings, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('banner-footer' + suffix, testCaseES6, toSearchBundle, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--banner:js="/* LICENSE abc */"', '--footer:js="/* end of file banner */"'),
          entryPoints: ['a.js'],
          crlf,
        }),
        check('complex' + suffix, testCaseComplex, toSearchComplex, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--define:process.env.NODE_ENV="production"'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('dynamic-import' + suffix, testCaseDynamicImport, toSearchDynamicImport, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--external:./ext/*', '--format=esm'),
          entryPoints: ['entry.js'],
          crlf,
          followUpFlags: ['--external:./ext/*', '--format=esm'],
        }),
        check('dynamic-require' + suffix, testCaseDynamicImport, toSearchDynamicImport, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--external:./ext/*', '--format=cjs'),
          entryPoints: ['entry.js'],
          crlf,
          followUpFlags: ['--external:./ext/*', '--format=cjs'],
        }),
        check('bundle-css' + suffix, testCaseBundleCSS, toSearchBundleCSS, {
          outfile: 'out.css',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.css'],
          crlf,
        }),
        check('jsx-runtime' + suffix, testCaseJSXRuntime, toSearchJSXRuntime, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--jsx=automatic', '--external:react/jsx-runtime'),
          entryPoints: ['entry.jsx'],
          crlf,
        }),
        check('jsx-dev-runtime' + suffix, testCaseJSXRuntime, toSearchJSXRuntime, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--jsx=automatic', '--jsx-dev', '--external:react/jsx-dev-runtime'),
          entryPoints: ['entry.jsx'],
          crlf,
        }),
        check('file-name-with-spaces' + suffix, testCaseFileNameWithSpaces, toSearchFileNameWithSpaces, {
          outfile: 'output name with spaces.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['file name with spaces.js'],
          crlf,
        }),
        check('absolute-source-mapping-url' + suffix, testCaseAbsoluteSourceMappingURL, toSearchAbsoluteSourceMappingURL, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('absolute-sources-url' + suffix, testCaseAbsoluteSourcesURL, toSearchAbsoluteSourcesURL, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('indexed-source-map' + suffix, testCaseIndexSourceMap, toSearchIndexSourceMap, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('issue-4070' + suffix, testCaseNestedFoldersIssue4070, toSearchNestedFoldersIssue4070, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['src/main.js'],
          crlf,
        }),
        check('issue-4075' + suffix, testCaseAbsolutePathIssue4075, toSearchAbsolutePathIssue4075, {
          outfile: 'out.css',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.css'],
          crlf,
        }),
        check('issue-4080' + suffix, testCaseNullMappingIssue4080, toSearchNullMappingIssue4080, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--format=esm'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        check('issue-4104' + suffix, testCaseMissingSourcesIssue4104, toSearchMissingSourcesIssue4104, {
          outfile: 'out.js',
          flags: flags.concat('--format=esm', '--sourcemap', '--bundle', '--loader:.html=text', '--packages=external'),
          entryPoints: ['entry.js'],
          crlf,
          followUpFlags: ['--packages=external'],
        }),
        check('issue-4169' + suffix, testCaseDefineWithObjectIssue4169, toSearchDefineWithObjectIssue4169, {
          outfile: 'out.js',
          flags: flags.concat('--format=esm', '--sourcemap', '--bundle', '--define:OBJECT={"test object":1}', '--define:ARRAY=["test array"]'),
          entryPoints: ['entry.js'],
          crlf,
        }),

        // Checks for the "names" field
        checkNames('names' + suffix, testCaseNames, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        checkNames('names-mangle' + suffix, testCaseNames, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--mangle-props=^mangle_$'),
          entryPoints: ['entry.js'],
          crlf,
        }),
        checkNames('names-mangle-quoted' + suffix, testCaseNames, {
          outfile: 'out.js',
          flags: flags.concat('--bundle', '--mangle-props=^mangle_$', '--mangle-quoted'),
          entryPoints: ['entry.js'],
          crlf,
        }),

        // Checks for loading missing "sourcesContent" in nested source maps
        check('missing-sources-content' + suffix, testCaseMissingSourcesContent, toSearchMissingSourcesContent, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['foo.js'],
          crlf,
        }),

        // Checks for null entries in "sourcesContent" in nested source maps
        check('null-sources-content' + suffix, testCaseNullSourcesContent, toSearchNullSourcesContent, {
          outfile: 'out.js',
          flags: flags.concat('--bundle'),
          entryPoints: ['foo.js'],
          crlf,
        }),

        // This checks for issues with files in a bundle that don't emit source maps
        check('splitting-empty' + suffix, testCaseCodeSplittingEmptyFile, toSearchCodeSplittingEmptyFile, {
          flags: flags.concat('--outdir=.', '--bundle', '--splitting', '--format=esm'),
          entryPoints: ['entry1.ts', 'entry2.ts'],
          crlf,
          checkFirstChunk: true,
        }),
      )
    }
  }

  const failed = (await Promise.all(promises)).reduce((a, b) => a + b, 0)
  if (failed > 0) {
    console.error(`❌ verify source map failed`)
    process.exit(1)
  } else {
    console.log(`✅ verify source map passed`)
    removeRecursiveSync(testDir)
  }
}

main().catch(e => setTimeout(() => { throw e }))
