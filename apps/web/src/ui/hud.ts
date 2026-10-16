import type { Play } from "../play/types";
import { connectingText, noticeTexts } from "../theme";

export function hud(element: { textContent: string | null }) {
	return {
		show({ play }: { play: Play }): void {
			const lines: string[] = [];
			if (play.snapshot) {
				const { hp, satiety } = play.snapshot.player;
				lines.push(`hp ${hp}  satiety ${satiety}`);
			}
			if (play.status === "connecting") lines.push(connectingText);
			if (play.notice) lines.push(noticeTexts[play.notice]);
			element.textContent = lines.join("\n");
		},
	};
}
