import { defineModule } from "../../src/core/module/api";

const STAGE = { young: 0, adult: 1, elder: 2 } as const;

// A fake mechanic made of one bulk tick: every row ages one turn, changes stage at its
// thresholds and dies of old age through a deferred kill.
export const age = defineModule({
	name: "age",
	schema: {
		age: {
			turns: "i32",
			adultAt: "i32",
			elderAt: "i32",
			lifespan: "i32",
			stage: "u8",
		},
	},
	config: {},
	setup(b) {
		const years = b.write("age");
		const aging = b.query(["age"]);

		b.tick((ctx) => {
			const rows = aging.slots(ctx);
			const { turns, adultAt, elderAt, lifespan, stage } = years;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const t = (turns[s] ?? 0) + 1;
				turns[s] = t;
				if (t >= (lifespan[s] ?? 0)) ctx.kill(ctx.idOf(s), ctx.idOf(s));
				else if (t >= (elderAt[s] ?? 0)) stage[s] = STAGE.elder;
				else if (t >= (adultAt[s] ?? 0)) stage[s] = STAGE.adult;
			}
		});
	},
});
