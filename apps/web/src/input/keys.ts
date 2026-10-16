import type { Gesture } from "../play/types";

export type KeyPress = {
	key: string;
	code: string;
	repeat: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	isComposing: boolean;
	keyCode: number;
};

// Some browsers report a key that an IME consumes with this keyCode and isComposing still false.
const IME_KEY_CODE = 229;

const west: Gesture = { kind: "move", dx: -1, dy: 0 };
const east: Gesture = { kind: "move", dx: 1, dy: 0 };
const north: Gesture = { kind: "move", dx: 0, dy: -1 };
const south: Gesture = { kind: "move", dx: 0, dy: 1 };
const northWest: Gesture = { kind: "move", dx: -1, dy: -1 };
const northEast: Gesture = { kind: "move", dx: 1, dy: -1 };
const southWest: Gesture = { kind: "move", dx: -1, dy: 1 };
const southEast: Gesture = { kind: "move", dx: 1, dy: 1 };
const wait: Gesture = { kind: "wait" };

// By code: the numpad means the same with NumLock on ("4") or off ("ArrowLeft", "Clear").
const byCode: ReadonlyMap<string, Gesture> = new Map<string, Gesture>([
	["Numpad1", southWest],
	["Numpad2", south],
	["Numpad3", southEast],
	["Numpad4", west],
	["Numpad5", wait],
	["Numpad6", east],
	["Numpad7", northWest],
	["Numpad8", north],
	["Numpad9", northEast],
]);

const byKey: ReadonlyMap<string, Gesture> = new Map<string, Gesture>([
	["ArrowLeft", west],
	["ArrowRight", east],
	["ArrowUp", north],
	["ArrowDown", south],
	["h", west],
	["l", east],
	["k", north],
	["j", south],
	["y", northWest],
	["u", northEast],
	["b", southWest],
	["n", southEast],
	[".", wait],
	["e", { kind: "eat" }],
]);

export function gestureOf(press: KeyPress): Gesture | undefined {
	if (press.repeat || press.ctrlKey || press.altKey || press.metaKey)
		return undefined;
	if (press.isComposing || press.keyCode === IME_KEY_CODE) return undefined;
	return byCode.get(press.code) ?? byKey.get(press.key);
}
