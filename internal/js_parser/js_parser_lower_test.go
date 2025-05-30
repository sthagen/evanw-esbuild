package js_parser

import (
	"fmt"
	"testing"

	"github.com/evanw/esbuild/internal/compat"
)

func TestLowerFunctionArgumentScope(t *testing.T) {
	templates := []string{
		"(x = %s) => {\n};\n",
		"(function(x = %s) {\n});\n",
		"function foo(x = %s) {\n}\n",

		"({ [%s]: x }) => {\n};\n",
		"(function({ [%s]: x }) {\n});\n",
		"function foo({ [%s]: x }) {\n}\n",

		"({ x = %s }) => {\n};\n",
		"(function({ x = %s }) {\n});\n",
		"function foo({ x = %s }) {\n}\n",
	}

	for _, template := range templates {
		test := func(before string, after string) {
			expectPrintedTarget(t, 2015, fmt.Sprintf(template, before), fmt.Sprintf(template, after))
		}

		test("a() ?? b", "((_a) => (_a = a()) != null ? _a : b)()")
		test("a()?.b", "((_a) => (_a = a()) == null ? void 0 : _a.b)()")
		test("a?.b?.()", "((_a) => (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.call(a))()")
		test("a.b.c?.()", "((_a) => ((_b) => (_b = (_a = a.b).c) == null ? void 0 : _b.call(_a))())()")
		test("class { static a }", "((_a) => (_a = class {\n}, __publicField(_a, \"a\"), _a))()")
	}
}

func TestLowerArrowFunction(t *testing.T) {
	expectPrintedTarget(t, 5, "function foo(a) { arr.forEach(e => this.foo(e)) }",
		"function foo(a) {\n  var _this = this;\n  arr.forEach(function(e) {\n    return _this.foo(e);\n  });\n}\n")
	expectPrintedTarget(t, 5, "function foo(a) { return () => arguments[0] }",
		"function foo(a) {\n  var _arguments = arguments;\n  return function() {\n    return _arguments[0];\n  };\n}\n")

	expectPrintedTarget(t, 5, "function foo(a) { arr.forEach(function(e) { return this.foo(e) }) }",
		"function foo(a) {\n  arr.forEach(function(e) {\n    return this.foo(e);\n  });\n}\n")
	expectPrintedTarget(t, 5, "function foo(a) { return function() { return arguments[0] } }",
		"function foo(a) {\n  return function() {\n    return arguments[0];\n  };\n}\n")

	// Handling this case isn't implemented yet
	expectPrintedTarget(t, 5, "var foo = () => this",
		"var foo = function() {\n  return this;\n};\n")
}

func TestLowerNullishCoalescing(t *testing.T) {
	expectParseError(t, "a ?? b && c",
		"<stdin>: ERROR: Cannot use \"&&\" with \"??\" without parentheses\n"+
			"NOTE: Expressions of the form \"x ?? y && z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x ?? y) && z\" and \"x ?? (y && z)\" by adding parentheses.\n")
	expectParseError(t, "a ?? b || c",
		"<stdin>: ERROR: Cannot use \"||\" with \"??\" without parentheses\n"+
			"NOTE: Expressions of the form \"x ?? y || z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x ?? y) || z\" and \"x ?? (y || z)\" by adding parentheses.\n")
	expectParseError(t, "a ?? b && c || d",
		"<stdin>: ERROR: Cannot use \"&&\" with \"??\" without parentheses\n"+
			"NOTE: Expressions of the form \"x ?? y && z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x ?? y) && z\" and \"x ?? (y && z)\" by adding parentheses.\n"+
			"<stdin>: ERROR: Cannot use \"||\" with \"??\" without parentheses\n"+
			"NOTE: Expressions of the form \"x ?? y || z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x ?? y) || z\" and \"x ?? (y || z)\" by adding parentheses.\n")
	expectParseError(t, "a ?? b || c && d",
		"<stdin>: ERROR: Cannot use \"||\" with \"??\" without parentheses\n"+
			"NOTE: Expressions of the form \"x ?? y || z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x ?? y) || z\" and \"x ?? (y || z)\" by adding parentheses.\n")
	expectParseError(t, "a && b ?? c",
		"<stdin>: ERROR: Cannot use \"??\" with \"&&\" without parentheses\n"+
			"NOTE: Expressions of the form \"x && y ?? z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x && y) ?? z\" and \"x && (y ?? z)\" by adding parentheses.\n")
	expectParseError(t, "a || b ?? c",
		"<stdin>: ERROR: Cannot use \"??\" with \"||\" without parentheses\n"+
			"NOTE: Expressions of the form \"x || y ?? z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x || y) ?? z\" and \"x || (y ?? z)\" by adding parentheses.\n")
	expectParseError(t, "a && b || c ?? c",
		"<stdin>: ERROR: Cannot use \"??\" with \"||\" without parentheses\n"+
			"NOTE: Expressions of the form \"x || y ?? z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x || y) ?? z\" and \"x || (y ?? z)\" by adding parentheses.\n")
	expectParseError(t, "a || b && c ?? d",
		"<stdin>: ERROR: Cannot use \"??\" with \"||\" without parentheses\n"+
			"NOTE: Expressions of the form \"x || y ?? z\" are not allowed in JavaScript. "+
			"You must disambiguate between \"(x || y) ?? z\" and \"x || (y ?? z)\" by adding parentheses.\n")
	expectPrinted(t, "a ?? b, b && c", "a ?? b, b && c;\n")
	expectPrinted(t, "a ?? b, b || c", "a ?? b, b || c;\n")
	expectPrinted(t, "a && b, b ?? c", "a && b, b ?? c;\n")
	expectPrinted(t, "a || b, b ?? c", "a || b, b ?? c;\n")

	expectPrintedTarget(t, 2020, "a ?? b", "a ?? b;\n")
	expectPrintedTarget(t, 2019, "a ?? b", "a != null ? a : b;\n")
	expectPrintedTarget(t, 2019, "a() ?? b()", "var _a;\n(_a = a()) != null ? _a : b();\n")
	expectPrintedTarget(t, 2019, "function foo() { if (x) { a() ?? b() ?? c() } }",
		"function foo() {\n  var _a, _b;\n  if (x) {\n    (_b = (_a = a()) != null ? _a : b()) != null ? _b : c();\n  }\n}\n")
	expectPrintedTarget(t, 2019, "() => a ?? b", "() => a != null ? a : b;\n")
	expectPrintedTarget(t, 2019, "() => a() ?? b()", "() => {\n  var _a;\n  return (_a = a()) != null ? _a : b();\n};\n")

	// Temporary variables should not come before "use strict"
	expectPrintedTarget(t, 2019, "function f() { /*! @license */ 'use strict'; a = b.c ?? d }",
		"function f() {\n  /*! @license */\n  \"use strict\";\n  var _a;\n  a = (_a = b.c) != null ? _a : d;\n}\n")
}

func TestLowerNullishCoalescingAssign(t *testing.T) {
	expectPrinted(t, "a ??= b", "a ??= b;\n")

	expectPrintedTarget(t, 2019, "a ??= b", "a != null ? a : a = b;\n")
	expectPrintedTarget(t, 2019, "a.b ??= c", "var _a;\n(_a = a.b) != null ? _a : a.b = c;\n")
	expectPrintedTarget(t, 2019, "a().b ??= c", "var _a, _b;\n(_b = (_a = a()).b) != null ? _b : _a.b = c;\n")
	expectPrintedTarget(t, 2019, "a[b] ??= c", "var _a;\n(_a = a[b]) != null ? _a : a[b] = c;\n")
	expectPrintedTarget(t, 2019, "a()[b()] ??= c", "var _a, _b, _c;\n(_c = (_a = a())[_b = b()]) != null ? _c : _a[_b] = c;\n")

	expectPrintedTarget(t, 2019, "class Foo { #x; constructor() { this.#x ??= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    var _a;
    (_a = __privateGet(this, _x)) != null ? _a : __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	expectPrintedTarget(t, 2020, "a ??= b", "a ?? (a = b);\n")
	expectPrintedTarget(t, 2020, "a.b ??= c", "a.b ?? (a.b = c);\n")
	expectPrintedTarget(t, 2020, "a().b ??= c", "var _a;\n(_a = a()).b ?? (_a.b = c);\n")
	expectPrintedTarget(t, 2020, "a[b] ??= c", "a[b] ?? (a[b] = c);\n")
	expectPrintedTarget(t, 2020, "a()[b()] ??= c", "var _a, _b;\n(_a = a())[_b = b()] ?? (_a[_b] = c);\n")

	expectPrintedTarget(t, 2020, "class Foo { #x; constructor() { this.#x ??= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) ?? __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	expectPrintedTarget(t, 2021, "a ??= b", "a ??= b;\n")
	expectPrintedTarget(t, 2021, "a.b ??= c", "a.b ??= c;\n")
	expectPrintedTarget(t, 2021, "a().b ??= c", "a().b ??= c;\n")
	expectPrintedTarget(t, 2021, "a[b] ??= c", "a[b] ??= c;\n")
	expectPrintedTarget(t, 2021, "a()[b()] ??= c", "a()[b()] ??= c;\n")

	expectPrintedTarget(t, 2021, "class Foo { #x; constructor() { this.#x ??= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) ?? __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	// Temporary variables should not come before "use strict"
	expectPrintedTarget(t, 2019, "function f() { /*! @license */ 'use strict'; a.b ??= c.d }",
		"function f() {\n  /*! @license */\n  \"use strict\";\n  var _a;\n  (_a = a.b) != null ? _a : a.b = c.d;\n}\n")
}

func TestLowerLogicalAssign(t *testing.T) {
	expectPrinted(t, "a &&= b", "a &&= b;\n")
	expectPrinted(t, "a ||= b", "a ||= b;\n")

	expectPrintedTarget(t, 2020, "a &&= b", "a && (a = b);\n")
	expectPrintedTarget(t, 2020, "a.b &&= c", "a.b && (a.b = c);\n")
	expectPrintedTarget(t, 2020, "a().b &&= c", "var _a;\n(_a = a()).b && (_a.b = c);\n")
	expectPrintedTarget(t, 2020, "a[b] &&= c", "a[b] && (a[b] = c);\n")
	expectPrintedTarget(t, 2020, "a()[b()] &&= c", "var _a, _b;\n(_a = a())[_b = b()] && (_a[_b] = c);\n")

	expectPrintedTarget(t, 2020, "class Foo { #x; constructor() { this.#x &&= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) && __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	expectPrintedTarget(t, 2021, "a &&= b", "a &&= b;\n")
	expectPrintedTarget(t, 2021, "a.b &&= c", "a.b &&= c;\n")
	expectPrintedTarget(t, 2021, "a().b &&= c", "a().b &&= c;\n")
	expectPrintedTarget(t, 2021, "a[b] &&= c", "a[b] &&= c;\n")
	expectPrintedTarget(t, 2021, "a()[b()] &&= c", "a()[b()] &&= c;\n")

	expectPrintedTarget(t, 2021, "class Foo { #x; constructor() { this.#x &&= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) && __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	expectPrintedTarget(t, 2020, "a ||= b", "a || (a = b);\n")
	expectPrintedTarget(t, 2020, "a.b ||= c", "a.b || (a.b = c);\n")
	expectPrintedTarget(t, 2020, "a().b ||= c", "var _a;\n(_a = a()).b || (_a.b = c);\n")
	expectPrintedTarget(t, 2020, "a[b] ||= c", "a[b] || (a[b] = c);\n")
	expectPrintedTarget(t, 2020, "a()[b()] ||= c", "var _a, _b;\n(_a = a())[_b = b()] || (_a[_b] = c);\n")

	expectPrintedTarget(t, 2020, "class Foo { #x; constructor() { this.#x ||= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) || __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)

	expectPrintedTarget(t, 2021, "a ||= b", "a ||= b;\n")
	expectPrintedTarget(t, 2021, "a.b ||= c", "a.b ||= c;\n")
	expectPrintedTarget(t, 2021, "a().b ||= c", "a().b ||= c;\n")
	expectPrintedTarget(t, 2021, "a[b] ||= c", "a[b] ||= c;\n")
	expectPrintedTarget(t, 2021, "a()[b()] ||= c", "a()[b()] ||= c;\n")

	expectPrintedTarget(t, 2021, "class Foo { #x; constructor() { this.#x ||= 2 } }", `var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x);
    __privateGet(this, _x) || __privateSet(this, _x, 2);
  }
}
_x = new WeakMap();
`)
}

func TestLowerAsyncFunctions(t *testing.T) {
	// Lowered non-arrow functions with argument evaluations should merely use
	// "arguments" rather than allocating a new array when forwarding arguments
	expectPrintedTarget(t, 2015, "async function foo(a, b = couldThrowErrors()) {console.log(a, b);}", `function foo(_0) {
  return __async(this, arguments, function* (a, b = couldThrowErrors()) {
    console.log(a, b);
  });
}
`)
	// Skip forwarding altogether when parameter evaluation obviously cannot throw
	expectPrintedTarget(t, 2015, "async (a, b = 123) => {console.log(a, b);}", `(a, b = 123) => __async(null, null, function* () {
  console.log(a, b);
});
`)
}

func TestLowerClassSideEffectOrder(t *testing.T) {
	// The order of computed property side effects must not change
	expectPrintedTarget(t, 2015, `class Foo {
	[a()]() {}
	[b()];
	[c()] = 1;
	[d()]() {}
	static [e()];
	static [f()] = 1;
	static [g()]() {}
	[h()];
}
`, `var _a, _b, _c, _d, _e, _f;
class Foo {
  constructor() {
    __publicField(this, _f);
    __publicField(this, _e, 1);
    __publicField(this, _a);
  }
  [a()]() {
  }
  [(_f = b(), _e = c(), d())]() {
  }
  static [(_d = e(), _c = f(), _b = g(), _a = h(), _b)]() {
  }
}
__publicField(Foo, _d);
__publicField(Foo, _c, 1);
`)
}

func TestLowerClassInstance(t *testing.T) {
	expectPrintedTarget(t, 2015, "class Foo {}", "class Foo {\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { foo }", "class Foo {\n  constructor() {\n    __publicField(this, \"foo\");\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { foo = null }", "class Foo {\n  constructor() {\n    __publicField(this, \"foo\", null);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { 123 }", "class Foo {\n  constructor() {\n    __publicField(this, 123);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { 123 = null }", "class Foo {\n  constructor() {\n    __publicField(this, 123, null);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { [foo] }", "var _a;\n_a = foo;\nclass Foo {\n  constructor() {\n    __publicField(this, _a);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { [foo] = null }", "var _a;\n_a = foo;\nclass Foo {\n  constructor() {\n    __publicField(this, _a, null);\n  }\n}\n")

	expectPrintedTarget(t, 2015, "(class {})", "(class {\n});\n")
	expectPrintedTarget(t, 2015, "(class { foo })", "(class {\n  constructor() {\n    __publicField(this, \"foo\");\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { foo = null })", "(class {\n  constructor() {\n    __publicField(this, \"foo\", null);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { 123 })", "(class {\n  constructor() {\n    __publicField(this, 123);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { 123 = null })", "(class {\n  constructor() {\n    __publicField(this, 123, null);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { [foo] })", "var _a;\n_a = foo, class {\n  constructor() {\n    __publicField(this, _a);\n  }\n};\n")
	expectPrintedTarget(t, 2015, "(class { [foo] = null })", "var _a;\n_a = foo, class {\n  constructor() {\n    __publicField(this, _a, null);\n  }\n};\n")

	expectPrintedTarget(t, 2015, "class Foo extends Bar {}", `class Foo extends Bar {
}
`)
	expectPrintedTarget(t, 2015, "class Foo extends Bar { bar() {} constructor() { super() } }", `class Foo extends Bar {
  bar() {
  }
  constructor() {
    super();
  }
}
`)
	expectPrintedTarget(t, 2015, "class Foo extends Bar { bar() {} foo }", `class Foo extends Bar {
  constructor() {
    super(...arguments);
    __publicField(this, "foo");
  }
  bar() {
  }
}
`)
	expectPrintedTarget(t, 2015, "class Foo extends Bar { bar() {} foo; constructor() { super() } }", `class Foo extends Bar {
  constructor() {
    super();
    __publicField(this, "foo");
  }
  bar() {
  }
}
`)
	expectPrintedTarget(t, 2015, "class Foo extends Bar { bar() {} foo; constructor({ ...args }) { super() } }", `class Foo extends Bar {
  constructor(_a) {
    var args = __objRest(_a, []);
    super();
    __publicField(this, "foo");
  }
  bar() {
  }
}
`)
}

func TestLowerClassStatic(t *testing.T) {
	expectPrintedTarget(t, 2015, "class Foo { static foo }", "class Foo {\n}\n__publicField(Foo, \"foo\");\n")
	expectPrintedTarget(t, 2015, "class Foo { static foo = null }", "class Foo {\n}\n__publicField(Foo, \"foo\", null);\n")
	expectPrintedTarget(t, 2015, "class Foo { static foo(a, b) {} }", "class Foo {\n  static foo(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static get foo() {} }", "class Foo {\n  static get foo() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static set foo(a) {} }", "class Foo {\n  static set foo(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static 123 }", "class Foo {\n}\n__publicField(Foo, 123);\n")
	expectPrintedTarget(t, 2015, "class Foo { static 123 = null }", "class Foo {\n}\n__publicField(Foo, 123, null);\n")
	expectPrintedTarget(t, 2015, "class Foo { static 123(a, b) {} }", "class Foo {\n  static 123(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static get 123() {} }", "class Foo {\n  static get 123() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static set 123(a) {} }", "class Foo {\n  static set 123(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static [foo] }", "var _a;\n_a = foo;\nclass Foo {\n}\n__publicField(Foo, _a);\n")
	expectPrintedTarget(t, 2015, "class Foo { static [foo] = null }", "var _a;\n_a = foo;\nclass Foo {\n}\n__publicField(Foo, _a, null);\n")
	expectPrintedTarget(t, 2015, "class Foo { static [foo](a, b) {} }", "class Foo {\n  static [foo](a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static get [foo]() {} }", "class Foo {\n  static get [foo]() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static set [foo](a) {} }", "class Foo {\n  static set [foo](a) {\n  }\n}\n")

	expectPrintedTarget(t, 2015, "export default class Foo { static foo }", "export default class Foo {\n}\n__publicField(Foo, \"foo\");\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static foo = null }", "export default class Foo {\n}\n__publicField(Foo, \"foo\", null);\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static foo(a, b) {} }", "export default class Foo {\n  static foo(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static get foo() {} }", "export default class Foo {\n  static get foo() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static set foo(a) {} }", "export default class Foo {\n  static set foo(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static 123 }", "export default class Foo {\n}\n__publicField(Foo, 123);\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static 123 = null }", "export default class Foo {\n}\n__publicField(Foo, 123, null);\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static 123(a, b) {} }", "export default class Foo {\n  static 123(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static get 123() {} }", "export default class Foo {\n  static get 123() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static set 123(a) {} }", "export default class Foo {\n  static set 123(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static [foo] }", "var _a;\n_a = foo;\nexport default class Foo {\n}\n__publicField(Foo, _a);\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static [foo] = null }", "var _a;\n_a = foo;\nexport default class Foo {\n}\n__publicField(Foo, _a, null);\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static [foo](a, b) {} }", "export default class Foo {\n  static [foo](a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static get [foo]() {} }", "export default class Foo {\n  static get [foo]() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class Foo { static set [foo](a) {} }", "export default class Foo {\n  static set [foo](a) {\n  }\n}\n")

	expectPrintedTarget(t, 2015, "export default class { static foo }",
		"export default class stdin_default {\n}\n__publicField(stdin_default, \"foo\");\n")
	expectPrintedTarget(t, 2015, "export default class { static foo = null }",
		"export default class stdin_default {\n}\n__publicField(stdin_default, \"foo\", null);\n")
	expectPrintedTarget(t, 2015, "export default class { static foo(a, b) {} }", "export default class {\n  static foo(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static get foo() {} }", "export default class {\n  static get foo() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static set foo(a) {} }", "export default class {\n  static set foo(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static 123 }",
		"export default class stdin_default {\n}\n__publicField(stdin_default, 123);\n")
	expectPrintedTarget(t, 2015, "export default class { static 123 = null }",
		"export default class stdin_default {\n}\n__publicField(stdin_default, 123, null);\n")
	expectPrintedTarget(t, 2015, "export default class { static 123(a, b) {} }", "export default class {\n  static 123(a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static get 123() {} }", "export default class {\n  static get 123() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static set 123(a) {} }", "export default class {\n  static set 123(a) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static [foo] }",
		"var _a;\n_a = foo;\nexport default class stdin_default {\n}\n__publicField(stdin_default, _a);\n")
	expectPrintedTarget(t, 2015, "export default class { static [foo] = null }",
		"var _a;\n_a = foo;\nexport default class stdin_default {\n}\n__publicField(stdin_default, _a, null);\n")
	expectPrintedTarget(t, 2015, "export default class { static [foo](a, b) {} }", "export default class {\n  static [foo](a, b) {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static get [foo]() {} }", "export default class {\n  static get [foo]() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "export default class { static set [foo](a) {} }", "export default class {\n  static set [foo](a) {\n  }\n}\n")

	expectPrintedTarget(t, 2015, "(class Foo { static foo })", "var _a;\n_a = class {\n}, __publicField(_a, \"foo\"), _a;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static foo = null })", "var _a;\n_a = class {\n}, __publicField(_a, \"foo\", null), _a;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static foo(a, b) {} })", "(class Foo {\n  static foo(a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static get foo() {} })", "(class Foo {\n  static get foo() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static set foo(a) {} })", "(class Foo {\n  static set foo(a) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static 123 })", "var _a;\n_a = class {\n}, __publicField(_a, 123), _a;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static 123 = null })", "var _a;\n_a = class {\n}, __publicField(_a, 123, null), _a;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static 123(a, b) {} })", "(class Foo {\n  static 123(a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static get 123() {} })", "(class Foo {\n  static get 123() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static set 123(a) {} })", "(class Foo {\n  static set 123(a) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static [foo] })", "var _a, _b;\n_a = foo, _b = class {\n}, __publicField(_b, _a), _b;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static [foo] = null })", "var _a, _b;\n_a = foo, _b = class {\n}, __publicField(_b, _a, null), _b;\n")
	expectPrintedTarget(t, 2015, "(class Foo { static [foo](a, b) {} })", "(class Foo {\n  static [foo](a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static get [foo]() {} })", "(class Foo {\n  static get [foo]() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class Foo { static set [foo](a) {} })", "(class Foo {\n  static set [foo](a) {\n  }\n});\n")

	expectPrintedTarget(t, 2015, "(class { static foo })", "var _a;\n_a = class {\n}, __publicField(_a, \"foo\"), _a;\n")
	expectPrintedTarget(t, 2015, "(class { static foo = null })", "var _a;\n_a = class {\n}, __publicField(_a, \"foo\", null), _a;\n")
	expectPrintedTarget(t, 2015, "(class { static foo(a, b) {} })", "(class {\n  static foo(a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static get foo() {} })", "(class {\n  static get foo() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static set foo(a) {} })", "(class {\n  static set foo(a) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static 123 })", "var _a;\n_a = class {\n}, __publicField(_a, 123), _a;\n")
	expectPrintedTarget(t, 2015, "(class { static 123 = null })", "var _a;\n_a = class {\n}, __publicField(_a, 123, null), _a;\n")
	expectPrintedTarget(t, 2015, "(class { static 123(a, b) {} })", "(class {\n  static 123(a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static get 123() {} })", "(class {\n  static get 123() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static set 123(a) {} })", "(class {\n  static set 123(a) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static [foo] })", "var _a, _b;\n_a = foo, _b = class {\n}, __publicField(_b, _a), _b;\n")
	expectPrintedTarget(t, 2015, "(class { static [foo] = null })", "var _a, _b;\n_a = foo, _b = class {\n}, __publicField(_b, _a, null), _b;\n")
	expectPrintedTarget(t, 2015, "(class { static [foo](a, b) {} })", "(class {\n  static [foo](a, b) {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static get [foo]() {} })", "(class {\n  static get [foo]() {\n  }\n});\n")
	expectPrintedTarget(t, 2015, "(class { static set [foo](a) {} })", "(class {\n  static set [foo](a) {\n  }\n});\n")

	expectPrintedTarget(t, 2015, "(class {})", "(class {\n});\n")
	expectPrintedTarget(t, 2015, "class Foo {}", "class Foo {\n}\n")
	expectPrintedTarget(t, 2015, "(class Foo {})", "(class Foo {\n});\n")

	// Static field with initializers that access the class expression name must
	// still work when they are pulled outside of the class body
	expectPrintedTarget(t, 2015, `
		let Bar = class Foo {
			static foo = 123
			static bar = Foo.foo
		}
	`, `var _a;
let Bar = (_a = class {
}, __publicField(_a, "foo", 123), __publicField(_a, "bar", _a.foo), _a);
`)

	// Generated IIFEs for static class blocks should be appropriately annotated
	expectPrintedTarget(t, 2015, "class Foo { static { try {} finally { impureCall() } } }",
		"class Foo {\n}\n(() => {\n  try {\n  } finally {\n    impureCall();\n  }\n})();\n")
	expectPrintedTarget(t, 2015, "(class Foo { static { try {} finally { impureCall() } } })",
		"var _a;\n_a = class {\n}, (() => {\n  try {\n  } finally {\n    impureCall();\n  }\n})(), _a;\n")
	expectPrintedTarget(t, 2015, "class Foo { static { try {} finally { /* @__PURE__ */ pureCall() } } }",
		"class Foo {\n}\n/* @__PURE__ */ (() => {\n  try {\n  } finally {\n    /* @__PURE__ */ pureCall();\n  }\n})();\n")
	expectPrintedTarget(t, 2015, "(class Foo { static { try {} finally { /* @__PURE__ */ pureCall() } } })",
		"var _a;\n_a = class {\n}, /* @__PURE__ */ (() => {\n  try {\n  } finally {\n    /* @__PURE__ */ pureCall();\n  }\n})(), _a;\n")
}

func TestLowerClassStaticThis(t *testing.T) {
	expectPrinted(t, "class Foo { x = this }", "class Foo {\n  x = this;\n}\n")
	expectPrinted(t, "class Foo { static x = this }", "class Foo {\n  static x = this;\n}\n")
	expectPrinted(t, "class Foo { static x = () => this }", "class Foo {\n  static x = () => this;\n}\n")
	expectPrinted(t, "class Foo { static x = function() { return this } }", "class Foo {\n  static x = function() {\n    return this;\n  };\n}\n")
	expectPrinted(t, "class Foo { static [this.x] }", "class Foo {\n  static [this.x];\n}\n")
	expectPrinted(t, "class Foo { static x = class { y = this } }", "class Foo {\n  static x = class {\n    y = this;\n  };\n}\n")
	expectPrinted(t, "class Foo { static x = class { [this.y] } }", "class Foo {\n  static x = class {\n    [this.y];\n  };\n}\n")
	expectPrinted(t, "class Foo { static x = class extends this {} }", "class Foo {\n  static x = class extends this {\n  };\n}\n")

	expectPrinted(t, "x = class Foo { x = this }", "x = class Foo {\n  x = this;\n};\n")
	expectPrinted(t, "x = class Foo { static x = this }", "x = class Foo {\n  static x = this;\n};\n")
	expectPrinted(t, "x = class Foo { static x = () => this }", "x = class Foo {\n  static x = () => this;\n};\n")
	expectPrinted(t, "x = class Foo { static x = function() { return this } }", "x = class Foo {\n  static x = function() {\n    return this;\n  };\n};\n")
	expectPrinted(t, "x = class Foo { static [this.x] }", "x = class Foo {\n  static [this.x];\n};\n")
	expectPrinted(t, "x = class Foo { static x = class { y = this } }", "x = class Foo {\n  static x = class {\n    y = this;\n  };\n};\n")
	expectPrinted(t, "x = class Foo { static x = class { [this.y] } }", "x = class Foo {\n  static x = class {\n    [this.y];\n  };\n};\n")
	expectPrinted(t, "x = class Foo { static x = class extends this {} }", "x = class Foo {\n  static x = class extends this {\n  };\n};\n")

	expectPrinted(t, "x = class { x = this }", "x = class {\n  x = this;\n};\n")
	expectPrinted(t, "x = class { static x = this }", "x = class {\n  static x = this;\n};\n")
	expectPrinted(t, "x = class { static x = () => this }", "x = class {\n  static x = () => this;\n};\n")
	expectPrinted(t, "x = class { static x = function() { return this } }", "x = class {\n  static x = function() {\n    return this;\n  };\n};\n")
	expectPrinted(t, "x = class { static [this.x] }", "x = class {\n  static [this.x];\n};\n")
	expectPrinted(t, "x = class { static x = class { y = this } }", "x = class {\n  static x = class {\n    y = this;\n  };\n};\n")
	expectPrinted(t, "x = class { static x = class { [this.y] } }", "x = class {\n  static x = class {\n    [this.y];\n  };\n};\n")
	expectPrinted(t, "x = class { static x = class extends this {} }", "x = class {\n  static x = class extends this {\n  };\n};\n")

	expectPrintedTarget(t, 2015, "class Foo { x = this }",
		"class Foo {\n  constructor() {\n    __publicField(this, \"x\", this);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { [this.x] }",
		"var _a;\n_a = this.x;\nclass Foo {\n  constructor() {\n    __publicField(this, _a);\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = this }",
		"const _Foo = class _Foo {\n};\n__publicField(_Foo, \"x\", _Foo);\nlet Foo = _Foo;\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = () => this }",
		"const _Foo = class _Foo {\n};\n__publicField(_Foo, \"x\", () => _Foo);\nlet Foo = _Foo;\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = function() { return this } }",
		"class Foo {\n}\n__publicField(Foo, \"x\", function() {\n  return this;\n});\n")
	expectPrintedTarget(t, 2015, "class Foo { static [this.x] }",
		"var _a;\n_a = this.x;\nclass Foo {\n}\n__publicField(Foo, _a);\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = class { y = this } }",
		"class Foo {\n}\n__publicField(Foo, \"x\", class {\n  constructor() {\n    __publicField(this, \"y\", this);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = class { [this.y] } }",
		"var _a;\nconst _Foo = class _Foo {\n};\n__publicField(_Foo, \"x\", (_a = _Foo.y, class {\n  constructor() {\n    __publicField(this, _a);\n  }\n}));\nlet Foo = _Foo;\n")
	expectPrintedTarget(t, 2015, "class Foo { static x = class extends this {} }",
		"const _Foo = class _Foo {\n};\n__publicField(_Foo, \"x\", class extends _Foo {\n});\nlet Foo = _Foo;\n")

	expectPrintedTarget(t, 2015, "x = class Foo { x = this }",
		"x = class Foo {\n  constructor() {\n    __publicField(this, \"x\", this);\n  }\n};\n")
	expectPrintedTarget(t, 2015, "x = class Foo { [this.x] }",
		"var _a;\nx = (_a = this.x, class Foo {\n  constructor() {\n    __publicField(this, _a);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = this }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", _a), _a);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = () => this }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", () => _a), _a);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = function() { return this } }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", function() {\n  return this;\n}), _a);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static [this.x] }",
		"var _a, _b;\nx = (_a = this.x, _b = class {\n}, __publicField(_b, _a), _b);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = class { y = this } }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", class {\n  constructor() {\n    __publicField(this, \"y\", this);\n  }\n}), _a);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = class { [this.y] } }",
		"var _a, _b;\nx = (_b = class {\n}, __publicField(_b, \"x\", (_a = _b.y, class {\n  constructor() {\n    __publicField(this, _a);\n  }\n})), _b);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = class extends this {} }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", class extends _a {\n}), _a);\n")

	expectPrintedTarget(t, 2015, "x = class { x = this }",
		"x = class {\n  constructor() {\n    __publicField(this, \"x\", this);\n  }\n};\n")
	expectPrintedTarget(t, 2015, "x = class { [this.x] }",
		"var _a;\nx = (_a = this.x, class {\n  constructor() {\n    __publicField(this, _a);\n  }\n});\n")
	expectPrintedTarget(t, 2015, "x = class { static x = this }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", _a), _a);\n")
	expectPrintedTarget(t, 2015, "x = class { static x = () => this }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", () => _a), _a);\n")
	expectPrintedTarget(t, 2015, "x = class { static x = function() { return this } }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", function() {\n  return this;\n}), _a);\n")
	expectPrintedTarget(t, 2015, "x = class { static [this.x] }",
		"var _a, _b;\nx = (_a = this.x, _b = class {\n}, __publicField(_b, _a), _b);\n")
	expectPrintedTarget(t, 2015, "x = class { static x = class { y = this } }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", class {\n  constructor() {\n    __publicField(this, \"y\", this);\n  }\n}), _a);\n")
	expectPrintedTarget(t, 2015, "x = class { static x = class { [this.y] } }",
		"var _a, _b;\nx = (_b = class {\n}, __publicField(_b, \"x\", (_a = _b.y, class {\n  constructor() {\n    __publicField(this, _a);\n  }\n})), _b);\n")
	expectPrintedTarget(t, 2015, "x = class Foo { static x = class extends this {} }",
		"var _a;\nx = (_a = class {\n}, __publicField(_a, \"x\", class extends _a {\n}), _a);\n")
}

func TestLowerClassStaticBlocks(t *testing.T) {
	expectPrintedTarget(t, 2015, "class Foo { static {} }", "class Foo {\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static {} x() {} }", "class Foo {\n  x() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { x() {} static {} }", "class Foo {\n  x() {\n  }\n}\n")
	expectPrintedTarget(t, 2015, "class Foo { static { x } static {} static { y } }", "class Foo {\n}\nx;\ny;\n")

	expectPrintedMangleTarget(t, 2015, "class Foo { static {} }", "class Foo {\n}\n")
	expectPrintedMangleTarget(t, 2015, "class Foo { static {} x() {} }", "class Foo {\n  x() {\n  }\n}\n")
	expectPrintedMangleTarget(t, 2015, "class Foo { x() {} static {} }", "class Foo {\n  x() {\n  }\n}\n")
	expectPrintedMangleTarget(t, 2015, "class Foo { static { x } static {} static { y } }", "class Foo {\n}\nx, y;\n")
}

func TestLowerOptionalChain(t *testing.T) {
	expectPrintedTarget(t, 2019, "a?.b.c", "a == null ? void 0 : a.b.c;\n")
	expectPrintedTarget(t, 2019, "(a?.b).c", "(a == null ? void 0 : a.b).c;\n")
	expectPrintedTarget(t, 2019, "a.b?.c", "var _a;\n(_a = a.b) == null ? void 0 : _a.c;\n")
	expectPrintedTarget(t, 2019, "this?.x", "this == null ? void 0 : this.x;\n")

	expectPrintedTarget(t, 2019, "a?.[b][c]", "a == null ? void 0 : a[b][c];\n")
	expectPrintedTarget(t, 2019, "(a?.[b])[c]", "(a == null ? void 0 : a[b])[c];\n")
	expectPrintedTarget(t, 2019, "a[b]?.[c]", "var _a;\n(_a = a[b]) == null ? void 0 : _a[c];\n")
	expectPrintedTarget(t, 2019, "this?.[x]", "this == null ? void 0 : this[x];\n")

	expectPrintedTarget(t, 2019, "a?.(b)(c)", "a == null ? void 0 : a(b)(c);\n")
	expectPrintedTarget(t, 2019, "(a?.(b))(c)", "(a == null ? void 0 : a(b))(c);\n")
	expectPrintedTarget(t, 2019, "a(b)?.(c)", "var _a;\n(_a = a(b)) == null ? void 0 : _a(c);\n")
	expectPrintedTarget(t, 2019, "this?.(x)", "this == null ? void 0 : this(x);\n")

	expectPrintedTarget(t, 2019, "delete a?.b.c", "a == null ? true : delete a.b.c;\n")
	expectPrintedTarget(t, 2019, "delete a?.[b][c]", "a == null ? true : delete a[b][c];\n")
	expectPrintedTarget(t, 2019, "delete a?.(b)(c)", "a == null ? true : delete a(b)(c);\n")

	expectPrintedTarget(t, 2019, "delete (a?.b).c", "delete (a == null ? void 0 : a.b).c;\n")
	expectPrintedTarget(t, 2019, "delete (a?.[b])[c]", "delete (a == null ? void 0 : a[b])[c];\n")
	expectPrintedTarget(t, 2019, "delete (a?.(b))(c)", "delete (a == null ? void 0 : a(b))(c);\n")

	expectPrintedTarget(t, 2019, "(delete a?.b).c", "(a == null ? true : delete a.b).c;\n")
	expectPrintedTarget(t, 2019, "(delete a?.[b])[c]", "(a == null ? true : delete a[b])[c];\n")
	expectPrintedTarget(t, 2019, "(delete a?.(b))(c)", "(a == null ? true : delete a(b))(c);\n")

	expectPrintedTarget(t, 2019, "null?.x", "")
	expectPrintedTarget(t, 2019, "null?.[x]", "")
	expectPrintedTarget(t, 2019, "null?.(x)", "")

	expectPrintedTarget(t, 2019, "delete null?.x", "")
	expectPrintedTarget(t, 2019, "delete null?.[x]", "")
	expectPrintedTarget(t, 2019, "delete null?.(x)", "")

	expectPrintedTarget(t, 2019, "undefined?.x", "")
	expectPrintedTarget(t, 2019, "undefined?.[x]", "")
	expectPrintedTarget(t, 2019, "undefined?.(x)", "")

	expectPrintedTarget(t, 2019, "delete undefined?.x", "")
	expectPrintedTarget(t, 2019, "delete undefined?.[x]", "")
	expectPrintedTarget(t, 2019, "delete undefined?.(x)", "")

	expectPrintedMangleTarget(t, 2019, "(foo(), null)?.x; y = (bar(), null)?.x", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2019, "(foo(), null)?.[x]; y = (bar(), null)?.[x]", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2019, "(foo(), null)?.(x); y = (bar(), null)?.(x)", "foo(), y = (bar(), void 0);\n")

	expectPrintedMangleTarget(t, 2019, "(foo(), void 0)?.x; y = (bar(), void 0)?.x", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2019, "(foo(), void 0)?.[x]; y = (bar(), void 0)?.[x]", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2019, "(foo(), void 0)?.(x); y = (bar(), void 0)?.(x)", "foo(), y = (bar(), void 0);\n")

	expectPrintedTarget(t, 2020, "x?.y", "x?.y;\n")
	expectPrintedTarget(t, 2020, "x?.[y]", "x?.[y];\n")
	expectPrintedTarget(t, 2020, "x?.(y)", "x?.(y);\n")

	expectPrintedTarget(t, 2020, "null?.x", "")
	expectPrintedTarget(t, 2020, "null?.[x]", "")
	expectPrintedTarget(t, 2020, "null?.(x)", "")

	expectPrintedTarget(t, 2020, "undefined?.x", "")
	expectPrintedTarget(t, 2020, "undefined?.[x]", "")
	expectPrintedTarget(t, 2020, "undefined?.(x)", "")

	expectPrintedTarget(t, 2020, "(foo(), null)?.x", "(foo(), null)?.x;\n")
	expectPrintedTarget(t, 2020, "(foo(), null)?.[x]", "(foo(), null)?.[x];\n")
	expectPrintedTarget(t, 2020, "(foo(), null)?.(x)", "(foo(), null)?.(x);\n")

	expectPrintedTarget(t, 2020, "(foo(), void 0)?.x", "(foo(), void 0)?.x;\n")
	expectPrintedTarget(t, 2020, "(foo(), void 0)?.[x]", "(foo(), void 0)?.[x];\n")
	expectPrintedTarget(t, 2020, "(foo(), void 0)?.(x)", "(foo(), void 0)?.(x);\n")

	expectPrintedMangleTarget(t, 2020, "(foo(), null)?.x; y = (bar(), null)?.x", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2020, "(foo(), null)?.[x]; y = (bar(), null)?.[x]", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2020, "(foo(), null)?.(x); y = (bar(), null)?.(x)", "foo(), y = (bar(), void 0);\n")

	expectPrintedMangleTarget(t, 2020, "(foo(), void 0)?.x; y = (bar(), void 0)?.x", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2020, "(foo(), void 0)?.[x]; y = (bar(), void 0)?.[x]", "foo(), y = (bar(), void 0);\n")
	expectPrintedMangleTarget(t, 2020, "(foo(), void 0)?.(x); y = (bar(), void 0)?.(x)", "foo(), y = (bar(), void 0);\n")

	expectPrintedTarget(t, 2019, "a?.b()", "a == null ? void 0 : a.b();\n")
	expectPrintedTarget(t, 2019, "a?.[b]()", "a == null ? void 0 : a[b]();\n")
	expectPrintedTarget(t, 2019, "a?.b.c()", "a == null ? void 0 : a.b.c();\n")
	expectPrintedTarget(t, 2019, "a?.b[c]()", "a == null ? void 0 : a.b[c]();\n")
	expectPrintedTarget(t, 2019, "a()?.b()", "var _a;\n(_a = a()) == null ? void 0 : _a.b();\n")
	expectPrintedTarget(t, 2019, "a()?.[b]()", "var _a;\n(_a = a()) == null ? void 0 : _a[b]();\n")

	expectPrintedTarget(t, 2019, "(a?.b)()", "(a == null ? void 0 : a.b).call(a);\n")
	expectPrintedTarget(t, 2019, "(a?.[b])()", "(a == null ? void 0 : a[b]).call(a);\n")
	expectPrintedTarget(t, 2019, "(a?.b.c)()", "var _a;\n(a == null ? void 0 : (_a = a.b).c).call(_a);\n")
	expectPrintedTarget(t, 2019, "(a?.b[c])()", "var _a;\n(a == null ? void 0 : (_a = a.b)[c]).call(_a);\n")
	expectPrintedTarget(t, 2019, "(a()?.b)()", "var _a;\n((_a = a()) == null ? void 0 : _a.b).call(_a);\n")
	expectPrintedTarget(t, 2019, "(a()?.[b])()", "var _a;\n((_a = a()) == null ? void 0 : _a[b]).call(_a);\n")

	// Check multiple levels of nesting
	expectPrintedTarget(t, 2019, "a?.b?.c?.d", `var _a, _b;
(_b = (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.c) == null ? void 0 : _b.d;
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.[c]?.[d]", `var _a, _b;
(_b = (_a = a == null ? void 0 : a[b]) == null ? void 0 : _a[c]) == null ? void 0 : _b[d];
`)
	expectPrintedTarget(t, 2019, "a?.(b)?.(c)?.(d)", `var _a, _b;
(_b = (_a = a == null ? void 0 : a(b)) == null ? void 0 : _a(c)) == null ? void 0 : _b(d);
`)

	// Check the need to use ".call()"
	expectPrintedTarget(t, 2019, "a.b?.(c)", `var _a;
(_a = a.b) == null ? void 0 : _a.call(a, c);
`)
	expectPrintedTarget(t, 2019, "a[b]?.(c)", `var _a;
(_a = a[b]) == null ? void 0 : _a.call(a, c);
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c)", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c);
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c).d", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c).d;
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c).d()", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c).d();
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c)['d']", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c)["d"];
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c)['d']()", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c)["d"]();
`)
	expectPrintedTarget(t, 2019, "a?.[b]?.(c).d['e'](f)['g'].h(i)", `var _a;
(_a = a == null ? void 0 : a[b]) == null ? void 0 : _a.call(a, c).d["e"](f)["g"].h(i);
`)
	expectPrintedTarget(t, 2019, "123?.[b]?.(c)", `var _a;
(_a = 123 == null ? void 0 : 123[b]) == null ? void 0 : _a.call(123, c);
`)
	expectPrintedTarget(t, 2019, "a?.[b][c]?.(d)", `var _a, _b;
(_b = a == null ? void 0 : (_a = a[b])[c]) == null ? void 0 : _b.call(_a, d);
`)
	expectPrintedTarget(t, 2019, "a[b][c]?.(d)", `var _a, _b;
(_b = (_a = a[b])[c]) == null ? void 0 : _b.call(_a, d);
`)

	// Check that direct eval status is not propagated through optional chaining
	expectPrintedTarget(t, 2019, "eval?.(x)", "eval == null ? void 0 : (0, eval)(x);\n")
	expectPrintedMangleTarget(t, 2019, "(1 ? eval : 0)?.(x)", "eval == null || (0, eval)(x);\n")

	// Check super property access
	expectPrintedTarget(t, 2019, "class Foo extends Bar { foo() { super.bar?.() } }", `class Foo extends Bar {
  foo() {
    var _a;
    (_a = super.bar) == null ? void 0 : _a.call(this);
  }
}
`)
	expectPrintedTarget(t, 2019, "class Foo extends Bar { foo() { super['bar']?.() } }", `class Foo extends Bar {
  foo() {
    var _a;
    (_a = super["bar"]) == null ? void 0 : _a.call(this);
  }
}
`)

	expectPrintedTarget(t, 2020, "(x?.y)``", "(x?.y)``;\n")
	expectPrintedTarget(t, 2019, "(x?.y)``", "var _a;\n(x == null ? void 0 : x.y).call(x, _a || (_a = __template([\"\"])));\n")
	expectPrintedTarget(t, 5, "(x?.y)``", "var _a;\n(x == null ? void 0 : x.y).call(x, _a || (_a = __template([\"\"])));\n")

	// Temporary variables should not come before "use strict"
	expectPrintedTarget(t, 2019, "function f() { /*! @license */ 'use strict'; a.b?.c() }",
		"function f() {\n  /*! @license */\n  \"use strict\";\n  var _a;\n  (_a = a.b) == null ? void 0 : _a.c();\n}\n")
}

func TestLowerOptionalCatchBinding(t *testing.T) {
	expectPrintedTarget(t, 2019, "try {} catch {}", "try {\n} catch {\n}\n")
	expectPrintedTarget(t, 2018, "try {} catch {}", "try {\n} catch (e) {\n}\n")
}

func TestLowerBigInt(t *testing.T) {
	expectPrintedTarget(t, 2019, "x = 0n", "x = /* @__PURE__ */ BigInt(\"0\");\n")
	expectPrintedTarget(t, 2020, "x = 0n", "x = 0n;\n")

	expectPrintedTarget(t, 2019, "x = 0b100101n", "x = /* @__PURE__ */ BigInt(\"0b100101\");\n")
	expectPrintedTarget(t, 2019, "x = 0B100101n", "x = /* @__PURE__ */ BigInt(\"0B100101\");\n")
	expectPrintedTarget(t, 2019, "x = 0o76543210n", "x = /* @__PURE__ */ BigInt(\"0o76543210\");\n")
	expectPrintedTarget(t, 2019, "x = 0O76543210n", "x = /* @__PURE__ */ BigInt(\"0O76543210\");\n")
	expectPrintedTarget(t, 2019, "x = 0xFEDCBA9876543210n", "x = /* @__PURE__ */ BigInt(\"0xFEDCBA9876543210\");\n")
	expectPrintedTarget(t, 2019, "x = 0XFEDCBA9876543210n", "x = /* @__PURE__ */ BigInt(\"0XFEDCBA9876543210\");\n")
	expectPrintedTarget(t, 2019, "x = 0xb0ba_cafe_f00dn", "x = /* @__PURE__ */ BigInt(\"0xb0bacafef00d\");\n")
	expectPrintedTarget(t, 2019, "x = 0xB0BA_CAFE_F00Dn", "x = /* @__PURE__ */ BigInt(\"0xB0BACAFEF00D\");\n")
	expectPrintedTarget(t, 2019, "x = 102030405060708090807060504030201n", "x = /* @__PURE__ */ BigInt(\"102030405060708090807060504030201\");\n")

	expectPrintedTarget(t, 2019, "x = {0b100101n: 0}", "x = { \"37\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0B100101n: 0}", "x = { \"37\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0o76543210n: 0}", "x = { \"16434824\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0O76543210n: 0}", "x = { \"16434824\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0xFEDCBA9876543210n: 0}", "x = { \"18364758544493064720\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0XFEDCBA9876543210n: 0}", "x = { \"18364758544493064720\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0xb0ba_cafe_f00dn: 0}", "x = { \"194316316110861\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {0xB0BA_CAFE_F00Dn: 0}", "x = { \"194316316110861\": 0 };\n")
	expectPrintedTarget(t, 2019, "x = {102030405060708090807060504030201n: 0}", "x = { \"102030405060708090807060504030201\": 0 };\n")

	expectPrintedTarget(t, 2019, "({0b100101n: x} = y)", "({ \"37\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0B100101n: x} = y)", "({ \"37\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0o76543210n: x} = y)", "({ \"16434824\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0O76543210n: x} = y)", "({ \"16434824\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0xFEDCBA9876543210n: x} = y)", "({ \"18364758544493064720\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0XFEDCBA9876543210n: x} = y)", "({ \"18364758544493064720\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0xb0ba_cafe_f00dn: x} = y)", "({ \"194316316110861\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({0xB0BA_CAFE_F00Dn: x} = y)", "({ \"194316316110861\": x } = y);\n")
	expectPrintedTarget(t, 2019, "({102030405060708090807060504030201n: x} = y)", "({ \"102030405060708090807060504030201\": x } = y);\n")

	expectPrintedMangleTarget(t, 2019, "x = {0b100101n: 0}", "x = { 37: 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0B100101n: 0}", "x = { 37: 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0o76543210n: 0}", "x = { 16434824: 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0O76543210n: 0}", "x = { 16434824: 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0xFEDCBA9876543210n: 0}", "x = { \"18364758544493064720\": 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0XFEDCBA9876543210n: 0}", "x = { \"18364758544493064720\": 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0xb0ba_cafe_f00dn: 0}", "x = { \"194316316110861\": 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {0xB0BA_CAFE_F00Dn: 0}", "x = { \"194316316110861\": 0 };\n")
	expectPrintedMangleTarget(t, 2019, "x = {102030405060708090807060504030201n: 0}", "x = { \"102030405060708090807060504030201\": 0 };\n")

	expectPrintedMangleTarget(t, 2019, "({0b100101n: x} = y)", "({ 37: x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0B100101n: x} = y)", "({ 37: x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0o76543210n: x} = y)", "({ 16434824: x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0O76543210n: x} = y)", "({ 16434824: x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0xFEDCBA9876543210n: x} = y)", "({ \"18364758544493064720\": x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0XFEDCBA9876543210n: x} = y)", "({ \"18364758544493064720\": x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0xb0ba_cafe_f00dn: x} = y)", "({ \"194316316110861\": x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({0xB0BA_CAFE_F00Dn: x} = y)", "({ \"194316316110861\": x } = y);\n")
	expectPrintedMangleTarget(t, 2019, "({102030405060708090807060504030201n: x} = y)", "({ \"102030405060708090807060504030201\": x } = y);\n")
}

func TestLowerExportStarAs(t *testing.T) {
	expectPrintedTarget(t, 2020, "export * as ns from 'path'", "export * as ns from \"path\";\n")
	expectPrintedTarget(t, 2019, "export * as ns from 'path'", "import * as ns from \"path\";\nexport { ns };\n")
}

func TestAsyncGeneratorFns(t *testing.T) {
	err := ""
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait, "async function gen() {}", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait, "(async function () {});", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait, "({ async foo() {} });", err)

	err = "<stdin>: ERROR: Transforming generator functions to the configured target environment is not supported yet\n"
	expectParseErrorWithUnsupportedFeatures(t, compat.Generator, "function* gen() {}", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.Generator, "(function* () {});", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.Generator, "({ *foo() {} });", err)

	err = "<stdin>: ERROR: Transforming async functions to the configured target environment is not supported yet\n"
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait|compat.Generator, "async function gen() {}", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait|compat.Generator, "(async function () {});", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait|compat.Generator, "({ async foo() {} });", err)

	err = ""
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncGenerator, "async function* gen() {}", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncGenerator, "(async function* () {});", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncGenerator, "({ async *foo() {} });", err)
}

func TestForAwait(t *testing.T) {
	err := ""
	expectParseErrorWithUnsupportedFeatures(t, compat.AsyncAwait, "async function gen() { for await (x of y) ; }", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.Generator, "async function gen() { for await (x of y) ; }", err)

	// This is ok because for-await can be lowered to await
	expectParseErrorWithUnsupportedFeatures(t, compat.ForAwait|compat.Generator, "async function gen() { for await (x of y) ; }", err)

	// This is ok because for-await can be lowered to yield
	expectParseErrorWithUnsupportedFeatures(t, compat.ForAwait|compat.AsyncAwait, "async function gen() { for await (x of y) ; }", err)

	// This is not ok because for-await can't be lowered
	err =
		"<stdin>: ERROR: Transforming async functions to the configured target environment is not supported yet\n" +
			"<stdin>: ERROR: Transforming for-await loops to the configured target environment is not supported yet\n"
	expectParseErrorWithUnsupportedFeatures(t, compat.ForAwait|compat.AsyncAwait|compat.Generator, "async function gen() { for await (x of y) ; }", err)

	// Can't use for-await at the top-level without top-level await
	err = "<stdin>: ERROR: Top-level await is not available in the configured target environment\n"
	expectParseErrorWithUnsupportedFeatures(t, compat.TopLevelAwait, "for await (x of y) ;", err)
	expectParseErrorWithUnsupportedFeatures(t, compat.TopLevelAwait, "if (true) for await (x of y) ;", err)
	expectPrintedWithUnsupportedFeatures(t, compat.TopLevelAwait, "if (false) for await (x of y) ;", "if (false) for (x of y) ;\n")
	expectParseErrorWithUnsupportedFeatures(t, compat.TopLevelAwait, "with (x) y; if (false) for await (x of y) ;",
		"<stdin>: ERROR: With statements cannot be used in an ECMAScript module\n"+
			"<stdin>: NOTE: This file is considered to be an ECMAScript module because of the top-level \"await\" keyword here:\n")
}

func TestLowerAutoAccessors(t *testing.T) {
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { accessor x }",
		"class Foo {\n  #x;\n  get x() {\n    return this.#x;\n  }\n  set x(_) {\n    this.#x = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { accessor [x] }",
		"var _a;\nclass Foo {\n  #a;\n  get [_a = x]() {\n    return this.#a;\n  }\n  set [_a](_) {\n    this.#a = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { accessor x = null }",
		"class Foo {\n  #x = null;\n  get x() {\n    return this.#x;\n  }\n  set x(_) {\n    this.#x = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { accessor [x] = null }",
		"var _a;\nclass Foo {\n  #a = null;\n  get [_a = x]() {\n    return this.#a;\n  }\n  set [_a](_) {\n    this.#a = _;\n  }\n}\n")

	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { static accessor x }",
		"class Foo {\n  static #x;\n  static get x() {\n    return this.#x;\n  }\n  static set x(_) {\n    this.#x = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { static accessor [x] }",
		"var _a;\nclass Foo {\n  static #a;\n  static get [_a = x]() {\n    return this.#a;\n  }\n  static set [_a](_) {\n    this.#a = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { static accessor x = null }",
		"class Foo {\n  static #x = null;\n  static get x() {\n    return this.#x;\n  }\n  static set x(_) {\n    this.#x = _;\n  }\n}\n")
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators, "class Foo { static accessor [x] = null }",
		"var _a;\nclass Foo {\n  static #a = null;\n  static get [_a = x]() {\n    return this.#a;\n  }\n  static set [_a](_) {\n    this.#a = _;\n  }\n}\n")

	// Test various combinations of flags
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassPrivateField, "class Foo { accessor x = null }",
		`var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x, null);
  }
  get x() {
    return __privateGet(this, _x);
  }
  set x(_) {
    __privateSet(this, _x, _);
  }
}
_x = new WeakMap();
`)
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassPrivateStaticField, "class Foo { static accessor x = null }",
		`var _x;
class Foo {
  static get x() {
    return __privateGet(this, _x);
  }
  static set x(_) {
    __privateSet(this, _x, _);
  }
}
_x = new WeakMap();
__privateAdd(Foo, _x, null);
`)
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassField|compat.ClassPrivateField, "class Foo { accessor x = null }",
		`var _x;
class Foo {
  constructor() {
    __privateAdd(this, _x, null);
  }
  get x() {
    return __privateGet(this, _x);
  }
  set x(_) {
    __privateSet(this, _x, _);
  }
}
_x = new WeakMap();
`)
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassStaticField|compat.ClassPrivateStaticField, "class Foo { static accessor x = null }",
		`var _x;
class Foo {
  static get x() {
    return __privateGet(this, _x);
  }
  static set x(_) {
    __privateSet(this, _x, _);
  }
}
_x = new WeakMap();
__privateAdd(Foo, _x, null);
`)
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassField|compat.ClassPrivateField, "class Foo { accessor x = 1; static accessor y = 2 }",
		`var _x, _y;
class Foo {
  constructor() {
    __privateAdd(this, _x, 1);
  }
  get x() {
    return __privateGet(this, _x);
  }
  set x(_) {
    __privateSet(this, _x, _);
  }
  static get y() {
    return __privateGet(this, _y);
  }
  static set y(_) {
    __privateSet(this, _y, _);
  }
}
_x = new WeakMap();
_y = new WeakMap();
__privateAdd(Foo, _y, 2);
`)
	expectPrintedWithUnsupportedFeatures(t, compat.Decorators|compat.ClassStaticField|compat.ClassPrivateStaticField, "class Foo { accessor x = 1; static accessor y = 2 }",
		`var _y;
class Foo {
  #x = 1;
  get x() {
    return this.#x;
  }
  set x(_) {
    this.#x = _;
  }
  static get y() {
    return __privateGet(this, _y);
  }
  static set y(_) {
    __privateSet(this, _y, _);
  }
}
_y = new WeakMap();
__privateAdd(Foo, _y, 2);
`)
}
