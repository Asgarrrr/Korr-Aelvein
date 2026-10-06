import { defineModule } from "../../core/module/api";
import { schema } from "./schema";

// No setup: boldness is placed from the species range.
export const temperament = defineModule({
	name: "temperament",
	schema,
	config: {},
	setup() {},
});
