import { expect, test } from "bun:test";
import { gestureOf, type KeyPress } from "../../src/input/keys";

function press(key: string, code = "", rest: Partial<KeyPress> = {}): KeyPress {
	return {
		key,
		code,
		repeat: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		isComposing: false,
		keyCode: 0,
		...rest,
	};
}

test.each([
	["repeat", { repeat: true }],
	["Ctrl", { ctrlKey: true }],
	["Alt", { altKey: true }],
	["Meta", { metaKey: true }],
	["IME composition", { isComposing: true }],
	["IME keyCode 229", { keyCode: 229 }],
] as const)("a bound key with %s gives no gesture", (_, rest) => {
	for (const [key, code] of [
		["h", "KeyH"],
		["4", "Numpad4"],
	] as const) {
		expect(gestureOf(press(key, code))).toBeDefined();
		expect(gestureOf(press(key, code, rest))).toBeUndefined();
	}
});

test("Shift + the AZERTY key that types '.' waits", () => {
	expect(gestureOf(press(".", "Comma"))).toEqual({ kind: "wait" });
});

test.each([
	["Numpad4", "4", "ArrowLeft", { kind: "move", dx: -1, dy: 0 }],
	["Numpad7", "7", "Home", { kind: "move", dx: -1, dy: -1 }],
	["Numpad5", "5", "Clear", { kind: "wait" }],
] as const)(
	"%s gives the same gesture with NumLock on or off",
	(code, on, off, gesture) => {
		expect(gestureOf(press(on, code))).toEqual(gesture);
		expect(gestureOf(press(off, code))).toEqual(gesture);
	},
);

test("vi keys, arrows and the numpad name the same directions, y growing down", () => {
	const by = (keys: string[], codes: string[] = []) =>
		keys.map((key, i) => gestureOf(press(key, codes[i])));
	const vi = by(["h", "l", "k", "j", "y", "u", "b", "n"]);
	expect(vi.slice(0, 4)).toEqual(
		by(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]),
	);
	expect(vi).toEqual(
		by(
			["4", "6", "8", "2", "7", "9", "1", "3"],
			[
				"Numpad4",
				"Numpad6",
				"Numpad8",
				"Numpad2",
				"Numpad7",
				"Numpad9",
				"Numpad1",
				"Numpad3",
			],
		),
	);
	expect(gestureOf(press("k"))).toEqual({ kind: "move", dx: 0, dy: -1 });
});

test.each([
	["h", -1, 0],
	["l", 1, 0],
	["k", 0, -1],
	["j", 0, 1],
	["y", -1, -1],
	["u", 1, -1],
	["b", -1, 1],
	["n", 1, 1],
] as const)("vi key %s moves by (%d, %d)", (key, dx, dy) => {
	expect(gestureOf(press(key))).toEqual({ kind: "move", dx, dy });
});

test("e eats; an unbound key or a key named like an Object property gives nothing", () => {
	expect(gestureOf(press("e", "KeyE"))).toEqual({ kind: "eat" });
	expect(gestureOf(press("q", "KeyQ"))).toBeUndefined();
	expect(gestureOf(press("constructor"))).toBeUndefined();
});
