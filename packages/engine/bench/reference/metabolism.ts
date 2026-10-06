import { defineModule } from "../../src/core/module/api";

const metabolismConfig = {
	wellFedAbove: 500,
	maxEnergy: 1000,
	storeAbove: 800,
	burnBelow: 200,
	// Energy one unit of fat holds.
	fatEnergy: 50,
	maxStamina: 100,
	baseTemperature: 370,
	// Fat units per tenth of a degree.
	insulation: 16,
	// Mass units per size step, as a shift.
	sizeShift: 6,
	maxSize: 255,
} as const;

// A fake mechanic with a wide row: one bulk tick reads hunger's satiety through its contract
// view and rewrites most fields of the row it iterates.
export const metabolism = defineModule({
	name: "metabolism",
	schema: {
		body: {
			mass: "i32",
			fat: "i32",
			muscle: "i32",
			lean: "i32",
			energy: "i32",
			stamina: "i16",
			temperature: "i16",
			size: "u8",
			rate: "u8",
		},
	},
	config: metabolismConfig,
	setup(b, cfg) {
		const body = b.write("body");
		const satiety = b.read("satiety");
		const bodies = b.query(["body"]);

		b.tick((ctx) => {
			const rows = bodies.slots(ctx);
			const {
				mass,
				fat,
				muscle,
				lean,
				energy,
				stamina,
				temperature,
				size,
				rate,
			} = body;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const fed = satiety ? satiety.value.get(s) : 0;
				const r = rate[s] ?? 0;
				let e = (energy[s] ?? 0) + (fed > cfg.wellFedAbove ? r : -r);
				let f = fat[s] ?? 0;
				if (e > cfg.storeAbove) {
					f++;
					e -= cfg.fatEnergy;
				} else if (e < cfg.burnBelow && f > 0) {
					f--;
					e += cfg.fatEnergy;
				}
				energy[s] = e < 0 ? 0 : e > cfg.maxEnergy ? cfg.maxEnergy : e;
				fat[s] = f;
				const m = (lean[s] ?? 0) + (muscle[s] ?? 0) + f;
				mass[s] = m;
				const st = (stamina[s] ?? 0) + 1;
				stamina[s] = st < cfg.maxStamina ? st : cfg.maxStamina;
				temperature[s] = cfg.baseTemperature + Math.floor(f / cfg.insulation);
				const grown = m >> cfg.sizeShift;
				size[s] = grown < cfg.maxSize ? grown : cfg.maxSize;
			}
		});
	},
});
