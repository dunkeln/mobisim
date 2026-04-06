export type Vec3Tuple = [number, number, number];

export type CameraConfig = {
	position: Vec3Tuple;
	target: Vec3Tuple;
	distance: number;
	fov: number;
};
