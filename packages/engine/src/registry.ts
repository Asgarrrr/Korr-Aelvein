import { fear } from "./modules/fear";
import { flora } from "./modules/flora";
import { hunger } from "./modules/hunger";
import { wander } from "./modules/wander";

export const modules = [hunger, fear, wander, flora] as const;
