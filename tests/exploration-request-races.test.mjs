import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test("exploration isolates location from recommendations and invalidates pending origins", async () => {
  const page = await readFile(new URL("../app/explore/page.tsx", import.meta.url), "utf8");

  assert.match(page, /locationCoordinatorRef = useRef<RequestCoordinator/);
  assert.match(page, /recommendationCoordinatorRef = useRef<RequestCoordinator/);

  const supersedeSearch = section(page, "const supersedeRecommendation", "const selectAreaOrigin");
  assert.match(supersedeSearch, /recommendationCoordinator\(\)\.begin\(\)/);
  assert.match(supersedeSearch, /setState\(\{ status: "idle" \}\)/);

  const selectArea = section(page, "const selectAreaOrigin", "const chooseCurrentLocation");
  assert.match(selectArea, /locationCoordinator\(\)\.begin\(\)/);
  assert.match(selectArea, /setLocating\(false\)/);
  assert.match(selectArea, /supersedeRecommendation\(\)/);

  const locate = section(page, "const chooseCurrentLocation", "const runSearch");
  assert.match(locate, /locationCoordinator\(\)\.begin\(\)/);
  assert.doesNotMatch(locate, /recommendationCoordinator\(\)\.begin\(\)/);
  assert.match(locate, /supersedeRecommendation\(\)/);

  const search = section(page, "const runSearch", "const submit");
  assert.match(search, /recommendationCoordinator\(\)\.begin\(\)/);
});
