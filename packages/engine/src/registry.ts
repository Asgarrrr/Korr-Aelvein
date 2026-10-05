import { flora } from "./modules/flora";
import { hunger } from "./modules/hunger";
import { wander } from "./modules/wander";

export const modules = [hunger, wander, flora] as const;
