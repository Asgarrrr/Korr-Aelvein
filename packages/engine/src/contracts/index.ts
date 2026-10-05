export interface Contracts {
	readonly satiety: { readonly value: "i32" };
	readonly diet: { readonly eats: "u8" };
	readonly edible: { readonly nutrition: "i16"; readonly class: "u8" };
}

export interface CellContracts {
	readonly fire: { readonly left: "u8"; readonly source: "entity" };
}
