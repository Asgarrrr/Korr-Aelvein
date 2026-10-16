import {
	InstancedMesh,
	Matrix4,
	MeshLambertNodeMaterial,
	type Object3D,
	PlaneGeometry,
} from "three/webgpu";
import { palette, sizes } from "../theme";

type Tiles = InstancedMesh<PlaneGeometry, MeshLambertNodeMaterial>;

export function floor(parent: Object3D) {
	let tiles: Tiles | undefined;
	let built = { width: 0, height: 0 };
	return {
		draw(width: number, height: number): void {
			if (tiles && built.width === width && built.height === height) return;
			if (tiles) {
				parent.remove(tiles);
				tiles.geometry.dispose();
				tiles.material.dispose();
				tiles.dispose();
			}
			const geometry = new PlaneGeometry(sizes.tile, sizes.tile);
			geometry.rotateX(-Math.PI / 2);
			tiles = new InstancedMesh(
				geometry,
				new MeshLambertNodeMaterial({ color: palette.floor }),
				width * height,
			);
			const matrix = new Matrix4();
			for (let y = 0; y < height; y++)
				for (let x = 0; x < width; x++)
					tiles.setMatrixAt(y * width + x, matrix.makeTranslation(x, 0, y));
			parent.add(tiles);
			built = { width, height };
		},
	};
}
