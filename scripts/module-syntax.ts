import { SyntaxKind } from "typescript/unstable/ast";
import * as tsScanner from "typescript/unstable/ast/scanner";

// Ways around the module boundary, each with samples it must catch. Rules read text rebuilt
// from TypeScript tokens: `comments` holds only comments; `keys` blanks literals except
// computed keys, for `obj["constructor"]`; `bare` blanks every literal and drops import,
// export and type aliases; `top` keeps only module-scope tokens outside parentheses.
type Scope = "comments" | "keys" | "bare" | "top";
// `<T>x` casts start an expression; generic arguments such as `Set<Int32Array>` do not.
const CAST_START = "(?:^|[=(,:?!&|>{};+\\-*/%[]|\\breturn)\\s*";
// A global, not a property that happens to share its name: `cfg.eval` is fine.
const GLOBAL = "(?<!\\.\\s*)\\b";
const INTRINSIC =
	"(?:Math|Number|Object|Array|JSON|String|Symbol|Function|Promise|Date|RegExp|Map|Set|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)";
export const FORBIDDEN: readonly {
	what: string;
	scope: Scope;
	pattern: RegExp;
	samples: readonly string[];
}[] = [
	{
		what: "a TypeScript suppression comment",
		scope: "comments",
		pattern: /@ts-(?:ignore|expect-error|nocheck)/,
		samples: ["// @ts-ignore", "// @ts-expect-error", "// @ts-nocheck"],
	},
	{
		what: "an `as` cast other than `as const`",
		scope: "bare",
		pattern: /\bas\s+(?!const\b)/,
		samples: [
			"const a = view as Uint8Array;",
			"f(x as unknown as Slot);",
			"const a = view as Readonly<Record<string, number[]>>;",
			'const b = [/"/, o as { x: number }, ""];',
		],
	},
	{
		what: "an angle-bracket cast or generic arrow",
		scope: "bare",
		pattern: new RegExp(`${CAST_START}<\\s*[A-Za-z_$]`, "m"),
		samples: [
			"const a = <Int32Array>view;",
			"f(1, <any>x);",
			"return <T>(x: T) => x;",
		],
	},
	{
		what: "reflection through Object",
		scope: "bare",
		pattern:
			/\bObject\s*\.\s*(?:values|entries|keys|getOwnProperty\w*|getPrototypeOf|setPrototypeOf|assign|definePropert\w*)\b/,
		samples: [
			"Object.values(ctx);",
			"Object.entries(view);",
			"Object.keys(view);",
			"Object.getOwnPropertyNames(ctx);",
			"Object.getOwnPropertyDescriptor(ctx, 'x');",
			"Object.getPrototypeOf(view);",
			"Object.setPrototypeOf(view, null);",
			"Object.assign(out, view);",
			"Object.defineProperty(view, 'get', {});",
		],
	},
	{
		what: "Reflect",
		scope: "bare",
		pattern: /\bReflect\b/,
		samples: [
			"Reflect.get(view, 0);",
			"const r = Reflect;",
			"const a = [/a\\//, Reflect.ownKeys(Math)];",
		],
	},
	{
		what: "globalThis",
		scope: "bare",
		pattern: /\bglobalThis\b/,
		samples: ["globalThis.x = 1;"],
	},
	{
		what: "__proto__",
		scope: "keys",
		pattern: /__proto__/,
		samples: ["view.__proto__.get = f;", 'view["__proto__"];'],
	},
	{
		what: "a constructor lookup",
		scope: "keys",
		pattern: /(?:\.\s*|\[\s*["'`])constructor\b/,
		samples: ["ctx.constructor;", 'view["constructor"];'],
	},
	{
		what: "a dynamic import",
		scope: "keys",
		pattern: /\bimport\s*\(/,
		samples: [
			'await import("../../core/engine");',
			'type E = typeof import("x");',
		],
	},
	{
		what: "a write to a built-in object",
		scope: "bare",
		pattern: new RegExp(
			`${GLOBAL}${INTRINSIC}\\s*\\.\\s*(?:prototype\\b|[\\w$]+\\s*(?:\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=))`,
		),
		samples: [
			"Math.floor = f;",
			"Array.prototype.push = f;",
			"Int32Array.prototype.fill = f;",
			"JSON.parse = f;",
			"Number.EPSILON += 1;",
			"Map.groupBy ??= f;",
			"const p = Object.prototype;",
		],
	},
	{
		what: "code built from strings",
		scope: "bare",
		pattern: new RegExp(`${GLOBAL}(?:Function\\s*\\(|eval\\b)`),
		samples: [
			"const f = Function('return 1');",
			"new Function('x', 'return x');",
			"eval('1');",
			"const e = eval;",
		],
	},
	{
		what: "a Proxy",
		scope: "bare",
		pattern: /\bnew\s+Proxy\b/,
		samples: ["const p = new Proxy(view, {});"],
	},
	{
		what: "module-scope state (`let` outside a function)",
		scope: "top",
		pattern: /\blet\b/,
		samples: ["let counter = 0;", "export let total = 0;"],
	},
	{
		what: "`var`, which hoists out of its block",
		scope: "bare",
		pattern: /\bvar\b/,
		samples: ["var cache = [];", "function f() { var x = 1; return x; }"],
	},
];
// Template interpolation opener, spelled so this file's own strings hold no placeholder.
const OPEN = "$" + "{";
// Checked one at a time: a stray brace in one sample must not hide a miss in the next.
export const ALLOWED_SAMPLES = [
	"export const schema = { wary: {} } as const;",
	'import { fear as afraid } from "./fear";',
	"export { afraid as fear };",
	"// view as any, Reflect.get, Object.keys, globalThis, x.constructor, import(, let x",
	"/* Object.assign(view) as unknown; Math.floor = f; eval */",
	'const message = "use it as is: Reflect, globalThis, eval";',
	`const text = \`${OPEN}a} as ${OPEN}b} and Reflect\`;`,
	"const seen = new Set<Int32Array>();",
	"function first<T>(list: readonly T[]): T | undefined { let x = list[0]; return x; }",
	"if (a < b && c > d) return;",
	`const nested = \`x ${OPEN}\`y ${OPEN}z}\`} as any\`;`,
	`const late = \`${OPEN}(() => { let z = 1; return z; })()}\`;`,
	"const x = 1; export { x as y };",
	'const message = "see obj.constructor and __proto__";',
	"for (let i = 0; i < 3; i++) console.log(i);",
	"type F = <T>(x: T) => T;",
	"type Upper<T> = { [K in keyof T as Uppercase<K & string>]: T[K] };",
	"const ratio = a / b / c;",
	"const m = Math.max(a, b) >= 2 && Number.isInteger(x) && Math.PI === y;",
	'const word = "let it be";',
	"const y = cfg.eval;",
	"cfg.Function(1);",
	"state.Map.size = 1;",
	"const MyArray = { size: 1 }; MyArray.size = 2;",
];

// createScanner ships in the JS of this unstable entry point but not in its .d.ts.
const { createScanner } = tsScanner as unknown as {
	createScanner(
		skipTrivia: boolean,
		variant: number,
		text: string,
	): tsScanner.Scanner;
};
const STANDARD = 0;
// After one of these, `/` divides; anywhere else it opens a regular expression.
const ENDS_EXPRESSION = new Set<SyntaxKind>([
	SyntaxKind.Identifier,
	SyntaxKind.NumericLiteral,
	SyntaxKind.BigIntLiteral,
	SyntaxKind.StringLiteral,
	SyntaxKind.NoSubstitutionTemplateLiteral,
	SyntaxKind.TemplateTail,
	SyntaxKind.RegularExpressionLiteral,
	SyntaxKind.CloseParenToken,
	SyntaxKind.CloseBracketToken,
	SyntaxKind.CloseBraceToken,
	SyntaxKind.PlusPlusToken,
	SyntaxKind.MinusMinusToken,
	SyntaxKind.ThisKeyword,
	SyntaxKind.SuperKeyword,
	SyntaxKind.TrueKeyword,
	SyntaxKind.FalseKeyword,
	SyntaxKind.NullKeyword,
]);
const LITERAL = new Set<SyntaxKind>([
	SyntaxKind.StringLiteral,
	SyntaxKind.NoSubstitutionTemplateLiteral,
	SyntaxKind.RegularExpressionLiteral,
]);
// Template pieces keep their expressions as code: only the text between is blanked.
const TEMPLATE_BARE = new Map<SyntaxKind, string>([
	[SyntaxKind.TemplateHead, '"" + ('],
	[SyntaxKind.TemplateMiddle, ') + "" + ('],
	[SyntaxKind.TemplateTail, ') + ""'],
]);
const TRIVIA = new Set<SyntaxKind>([
	SyntaxKind.WhitespaceTrivia,
	SyntaxKind.ShebangTrivia,
	SyntaxKind.ConflictMarkerTrivia,
]);

const tokenize = (source: string): Record<Scope, string> => {
	const scanner = createScanner(false, STANDARD, source);
	const comments: string[] = [];
	let keys = "";
	let bare = "";
	let top = "";
	let gap = "";
	let depth = 0;
	let parens = 0;
	let previous = SyntaxKind.Unknown;
	const templates: number[] = [];
	for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; ) {
		if (kind === SyntaxKind.NewLineTrivia) gap = "\n";
		else if (
			kind === SyntaxKind.SingleLineCommentTrivia ||
			kind === SyntaxKind.MultiLineCommentTrivia
		)
			comments.push(scanner.getTokenText());
		else if (!TRIVIA.has(kind)) {
			if (
				(kind === SyntaxKind.SlashToken ||
					kind === SyntaxKind.SlashEqualsToken) &&
				!ENDS_EXPRESSION.has(previous)
			)
				kind = scanner.reScanSlashToken();
			else if (kind === SyntaxKind.GreaterThanToken)
				kind = scanner.reScanGreaterToken();
			else if (
				kind === SyntaxKind.CloseBraceToken &&
				templates.at(-1) === depth
			) {
				kind = scanner.reScanTemplateToken(false);
				if (kind === SyntaxKind.TemplateTail) templates.pop();
			}
			if (kind === SyntaxKind.TemplateHead) templates.push(depth);
			else if (kind === SyntaxKind.OpenBraceToken) depth++;
			else if (kind === SyntaxKind.CloseBraceToken) depth--;
			else if (kind === SyntaxKind.OpenParenToken) parens++;
			else if (kind === SyntaxKind.CloseParenToken) parens--;
			const text = scanner.getTokenText();
			const blank = LITERAL.has(kind)
				? '""'
				: (TEMPLATE_BARE.get(kind) ?? text);
			const sep = gap || " ";
			keys += sep + (previous === SyntaxKind.OpenBracketToken ? text : blank);
			bare += sep + blank;
			if (depth === 0 && parens === 0 && kind !== SyntaxKind.CloseBraceToken)
				top += sep + blank;
			gap = "";
			previous = kind;
		}
		kind = scanner.scan();
	}
	// Statements whose `as` and `<T>` are not casts: import and export aliases, type aliases.
	const aliases =
		/(?<=^|[;}])\s*(?:import|export)\b[^;]*?\bfrom\s*""\s*;?|(?<=^|[;}])\s*export\s*\{[^}]*\}\s*;?|\btype\s+[\w$]+\s*(?:<[^=;]*>)?\s*=[^;]*;?/gm;
	return {
		comments: comments.join("\n"),
		keys,
		bare: bare.replace(aliases, ""),
		top,
	};
};

export const forbiddenIn = (source: string) => {
	const text = tokenize(source);
	return FORBIDDEN.filter(({ scope, pattern }) =>
		pattern.test(text[scope]),
	).map(({ what }) => what);
};
