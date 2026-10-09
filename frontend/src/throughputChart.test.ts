import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chartShape,
  chartX,
  chartY,
  pointedIndex,
  runs,
  tipLeft,
  VIEW,
} from "./throughputChart.ts";

test("the read seconds are drawn in runs, broken by each gap", () => {
  assert.deepEqual(runs([1, 2, 3]), [[0, 3]]);
  assert.deepEqual(runs([null, 1, 2, null, null, 3, null]), [
    [1, 3],
    [5, 6],
  ]);
  assert.deepEqual(runs([null, null]), []);
  assert.deepEqual(runs([]), []);
  assert.deepEqual(runs([0]), [[0, 1]], "a second nothing moved in is read");
});

test("the seconds span the box, and the scale its height less the room kept", () => {
  assert.equal(chartX(0, 60), 0);
  assert.equal(chartX(59, 60), VIEW.width);
  assert.equal(chartX(0, 1), 0, "one point has nowhere to span");
  assert.equal(chartY(0, 100), VIEW.height - 6);
  assert.equal(chartY(100, 100), 6);
  assert.equal(chartY(50, 100), VIEW.height / 2);
});

test("a run is an area under its line, and a gap breaks both", () => {
  const shape = chartShape([0, 100, null, 50], 100, 50);
  assert.deepEqual(shape.lines, ["M0.0 144.0 L213.3 6.0", "M640.0 75.0"]);
  assert.deepEqual(shape.areas, [
    "M0.0 144.0 L0.0 144.0 L213.3 6.0 L213.3 144.0 Z",
    "M640.0 144.0 L640.0 75.0 L640.0 144.0 Z",
  ]);
  assert.deepEqual(shape.grid, [109.5, 75, 40.5, 6]);
  assert.equal(shape.mean, 75);
});

test("a range that moved nothing gets no average line", () => {
  assert.equal(chartShape([0, 0], 1000, 0).mean, null);
  assert.deepEqual(chartShape([null, null], 1000, 0).lines, []);
});

test("a pointer is on the nearest second, never beside the plot", () => {
  assert.equal(pointedIndex(0, 60, 100), 0);
  assert.equal(pointedIndex(100, 60, 100), 59);
  assert.equal(pointedIndex(50, 61, 100), 30);
  assert.equal(pointedIndex(-20, 60, 100), 0);
  assert.equal(pointedIndex(140, 60, 100), 59);
  assert.equal(pointedIndex(50, 1, 100), 0);
});

test("the tooltip sits over its second but inside the plot", () => {
  assert.equal(tipLeft(0, 60, 400), 34);
  assert.equal(tipLeft(59, 60, 400), 366);
  assert.equal(tipLeft(30, 61, 400), 200);
});
