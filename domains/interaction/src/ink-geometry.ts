import type { EraserStyle, InkStroke, ScenePoint } from "@foldthink/surface";

function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
export function inkWidthAtPressure(stroke: InkStroke, pressure: number): number {
  return stroke.style.width * (0.45 + unit(pressure) * 0.55);
}

export function inkOpacityAtPressure(stroke: InkStroke, pressure: number): number {
  return stroke.style.minimumOpacity +
    (stroke.style.maximumOpacity - stroke.style.minimumOpacity) * unit(pressure);
}

export function eraserWidthAtPressure(style: EraserStyle, pressure: number): number {
  return style.minimumWidth + (style.maximumWidth - style.minimumWidth) * unit(pressure);
}

function pointSegmentDistanceSquared(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const nearestX = start.x + projection * dx;
  const nearestY = start.y + projection * dy;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function orientation(left: ScenePoint, middle: ScenePoint, right: ScenePoint): number {
  return (middle.x - left.x) * (right.y - left.y) -
    (middle.y - left.y) * (right.x - left.x);
}

function segmentsIntersect(
  leftStart: ScenePoint,
  leftEnd: ScenePoint,
  rightStart: ScenePoint,
  rightEnd: ScenePoint,
): boolean {
  const first = orientation(leftStart, leftEnd, rightStart);
  const second = orientation(leftStart, leftEnd, rightEnd);
  const third = orientation(rightStart, rightEnd, leftStart);
  const fourth = orientation(rightStart, rightEnd, leftEnd);
  const epsilon = 1e-9;
  if (((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon)) &&
      ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))) {
    return true;
  }
  return Math.abs(first) <= epsilon && pointSegmentDistanceSquared(rightStart, leftStart, leftEnd) <= epsilon ||
    Math.abs(second) <= epsilon && pointSegmentDistanceSquared(rightEnd, leftStart, leftEnd) <= epsilon ||
    Math.abs(third) <= epsilon && pointSegmentDistanceSquared(leftStart, rightStart, rightEnd) <= epsilon ||
    Math.abs(fourth) <= epsilon && pointSegmentDistanceSquared(leftEnd, rightStart, rightEnd) <= epsilon;
}

export function segmentDistanceSquared(
  leftStart: ScenePoint,
  leftEnd: ScenePoint,
  rightStart: ScenePoint,
  rightEnd: ScenePoint,
): number {
  if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(leftStart, rightStart, rightEnd),
    pointSegmentDistanceSquared(leftEnd, rightStart, rightEnd),
    pointSegmentDistanceSquared(rightStart, leftStart, leftEnd),
    pointSegmentDistanceSquared(rightEnd, leftStart, leftEnd),
  );
}
