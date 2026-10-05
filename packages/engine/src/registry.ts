import { fear } from "./modules/fear";
import { fire } from "./modules/fire";
import { flora } from "./modules/flora";
import { hunger } from "./modules/hunger";
import { wander } from "./modules/wander";

// Fire ticks before fear, so fear's danger marks this round's burning cells.
export const modules = [hunger, fire, fear, wander, flora] as const;
