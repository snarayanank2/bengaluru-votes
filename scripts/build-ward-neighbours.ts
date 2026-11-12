#!/usr/bin/env tsx
/**
 * Regenerate data/ward-neighbours.json from data/gba.geojson
 * (`npm run build:ward-neighbours`). Run it whenever the ward boundaries
 * change and commit the result; tests/unit/ward-neighbours.test.ts fails when
 * the file is stale. Method: src/lib/ward-adjacency.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { computeWardNeighbours } from '../src/lib/ward-adjacency';

const geojson = JSON.parse(readFileSync('data/gba.geojson', 'utf8'));
const neighbours = computeWardNeighbours(geojson.features);
writeFileSync('data/ward-neighbours.json', JSON.stringify(neighbours) + '\n');
console.log(`build-ward-neighbours: wrote ${Object.keys(neighbours).length} wards`);
