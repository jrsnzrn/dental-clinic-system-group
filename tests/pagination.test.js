import test from "node:test";
import assert from "node:assert/strict";
import { getPage } from "../src/utils/pagination.js";

const records = Array.from({ length: 53 }, (_, index) => ({ id: index + 1 }));

test("all records remain accessible in pages of 20 with no duplication", () => {
  const pages = [1, 2, 3].map(page => getPage(records, page));
  assert.deepEqual(pages.map(page => page.items.length), [20, 20, 13]);
  assert.deepEqual(pages.flatMap(page => page.items), records);
  assert.equal(pages[1].startIndex, 20);
  assert.equal(pages[2].endIndex, 53);
});

test("empty and filtered lists clamp pages without hiding remaining records", () => {
  assert.deepEqual(getPage([], 5).items, []);
  assert.equal(getPage([], 5).page, 1);
  const filtered = records.filter(record => record.id > 50);
  assert.deepEqual(getPage(filtered, 3).items.map(record => record.id), [51, 52, 53]);
  assert.equal(getPage(filtered, 3).page, 1);
});

test("negative, nonnumeric, and out-of-range page requests stay within valid pages", () => {
  assert.equal(getPage(records, -5).page, 1);
  assert.equal(getPage(records, "invalid").page, 1);
  assert.equal(getPage(records, 500).page, 3);
  assert.equal(getPage(records.slice(0, 20), 1).pageCount, 1);
});
