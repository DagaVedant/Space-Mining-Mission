export type CollisionGrid = ReadonlyArray<ReadonlyArray<boolean>>;

export function moveOnGrid(
  x: number,
  y: number,
  dx: number,
  dy: number,
  grid: CollisionGrid,
): { x: number; y: number } {
  const targetX = x + dx;
  const targetY = y + dy;

  if (
    targetY < 0 ||
    targetY >= grid.length ||
    targetX < 0 ||
    targetX >= grid[targetY].length
  ) {
    return { x, y };
  }

  if (grid[targetY][targetX]) {
    return { x, y };
  }

  return { x: targetX, y: targetY };
}
